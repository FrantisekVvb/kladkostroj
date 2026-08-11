(function () {
  const appRoot = document.querySelector(".app-root");
  const stage = document.getElementById("stage");
  const ropeLayer = document.getElementById("rope-layer");
  const btnMove = document.getElementById("tool-move");
  const btnPencil = document.getElementById("tool-pencil");
  const btnRun = document.getElementById("tool-run");
  const btnErase = document.getElementById("tool-erase");
  const btnUndo = document.getElementById("tool-undo");
  const btnReset = document.getElementById("tool-reset");
  const btnForces = document.getElementById("toggle-forces");
  const stockTray = document.getElementById("stock-tray");
  const stockSlotFixed = document.getElementById("stock-slot-fixed");
  const stockSlotFree = document.getElementById("stock-slot-free");
  const stockSlotWeights = document.getElementById("stock-slot-weights");
  const stockSlotWinch = document.getElementById("stock-slot-winch");
  const stockTemplateFixed = document.getElementById("stock-template-fixed");
  const stockTemplateFree = document.getElementById("stock-template-free");

  const EDGE_ROTATION = {
    top: 0,
    right: 90,
    bottom: 180,
    left: -90,
  };

  /** Geometrie kol z originálních SVG (viewBox). */
  const WHEEL = {
    fixed: {
      vbW: 276,
      cx: 137.839,
      cy: 176.404,
      /** Vnější obrys kola (výplň + polovina tahu). */
      grooveR: (265.089 - 10.5898) / 2 + 21.18 / 2,
    },
    free: {
      vbW: 282,
      cx: 140.789,
      cy: 292.717,
      grooveR: (266.329 - 15.2495) / 2 + 30.4992 / 2,
    },
  };

  const CLOSE_SNAP_RADIUS = 28;
  const END_GRAB_RADIUS = 24;
  /** Maximální obepnutí — max ~půl + kousek; celý závit ani „přes kladku“ ne. */
  const MAX_WRAP_TRAVEL = Math.PI + 0.4;
  /** Minimální obepnutí — jen proti ostrému „V“ zlomu (ne proti platným krátkým obloukům). */
  const MIN_WRAP_TRAVEL = 0.35;

  /** Konec volné tyčky u modré kladky (SVG souřadnice). */
  const FREE_ROD_TIP = { x: 143.473, y: 15.2496 };

  /** Závěs závaží — střed horního kroužku. */
  const WEIGHT = {
    vbW: 280,
    vbH: 269,
    hookX: 138,
    hookY: 50,
  };

  let tool = "move";
  /** @type {{ el: SVGPathElement, points: {x:number,y:number}[], closed: boolean }[]} */
  let ropes = [];
  let snapMarker = null;
  /** @type {{ el: SVGCircleElement, rope: typeof ropes[0], which: "start"|"end" }[]} */
  let endHandles = [];
  /** @type {{ el: HTMLElement, snap: WeightSnap, vel: {x:number,y:number}, dragging: boolean }[]} */
  let weights = [];
  /** @type {{ el: HTMLElement, kind: "fixed"|"free", id: string, vel: {x:number,y:number} }[]} */
  let pulleys = [];
  let pulleySeq = 0;
  let weightSeq = 0;
  /** @type {{ el: HTMLElement, snap: object, dragging: boolean, winding: boolean }[]} */
  let winches = [];
  let winchSeq = 0;

  const WEIGHT_SVG = `<svg width="280" height="269" viewBox="0 0 280 269" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="138" cy="50" r="45" stroke="#858585" stroke-width="10"/><path d="M267.34 269H12.3699C6.00343 269 1.2579 263.13 2.59185 256.905L43.3061 66.9047C44.2941 62.294 48.3688 59 53.0842 59H222.101C226.732 59 230.757 62.1791 231.829 66.6838L277.068 256.684C278.564 262.968 273.799 269 267.34 269Z" fill="#858585"/></svg>`;

  const WINCH_SVG = `<svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="72" width="104" height="20" rx="4" fill="#4B5563"/><rect x="20" y="30" width="14" height="46" rx="2" fill="#374151"/><rect x="86" y="30" width="14" height="46" rx="2" fill="#374151"/><g class="winch-drum"><circle cx="60" cy="48" r="24" fill="#9CA3AF" stroke="#1F2937" stroke-width="5"/><circle cx="60" cy="48" r="9" fill="#1F2937"/><path d="M60 28v40M40 48h40" stroke="#6B7280" stroke-width="3" stroke-linecap="round"/></g><circle cx="60" cy="12" r="8" stroke="#858585" stroke-width="5"/><circle cx="60" cy="12" r="2.5" fill="#858585"/></svg>`;

  const WINCH = {
    vbW: 120,
    hookX: 60,
    hookY: 12,
  };

  const GRAVITY = 520;
  const WEIGHT_MASS = 1;
  /** Konvence: tíha jednoho závaží = 100 N. */
  const WEIGHT_FORCE_N = 100;
  /** Naviják táhne max. 150 N. */
  const WINCH_MAX_FORCE_N = 150;
  const WEIGHT_FORCE = WEIGHT_MASS * GRAVITY;
  const WINCH_MAX_FORCE =
    (WINCH_MAX_FORCE_N / WEIGHT_FORCE_N) * WEIGHT_FORCE;
  /** Rychlost navíjení (zkrácení lana) v px/s. */
  const WINCH_REEL_SPEED = 90;
  /** Hmotnost modré kladky — zanedbatelná. */
  const PULLEY_MASS = 0;
  const SETTLE_MS = 100;
  let running = false;
  let settling = false;
  let settleStartTime = 0;
  let physicsFrame = null;
  let lastPhysicsTime = 0;
  let forceLayer = null;
  const FORCE_ARROW_MIN = 28;
  const FORCE_ARROW_MAX = 200;
  const FORCE_ARROW_UNIT_LEN = 68;
  /** @type {boolean} */
  let showForces = false;

  const HISTORY_MAX = 40;
  /** @type {object[]} */
  let historyStack = [];
  /** @type {object | null} */
  let actionBaseline = null;
  /** @type {object | null} */
  let preRunSnapshot = null;
  let historySuspended = false;

  function updateClearEnabled() {
    /* dříve Smazat lano — ponecháno kvůli voláním po změnách scény */
  }

  function updateHistoryButtons() {
    if (btnUndo) btnUndo.disabled = historyStack.length === 0;
    if (btnReset) btnReset.disabled = preRunSnapshot == null;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function serializeWeightSnap(snap) {
    if (!snap || snap.type === "free") return { type: "free" };
    if (snap.type === "rod") {
      const pulley = findPulleyByEl(snap.pulley);
      return { type: "rod", pulleyId: pulley?.id || null };
    }
    if (snap.type === "rope") {
      const idx = ropes.indexOf(snap.rope);
      return {
        type: "rope",
        ropeIndex: idx,
        which: snap.which,
      };
    }
    if (snap.type === "weight") {
      return {
        type: "weight",
        weightId: snap.weight?.el?.id || null,
        placement: snap.placement || "hang",
      };
    }
    return { type: "free" };
  }

  function captureScene() {
    return {
      pulleySeq,
      weightSeq,
      winchSeq,
      pulleys: pulleys.map((p) => ({
        id: p.id,
        kind: p.kind,
        left: p.el.style.left || "",
        top: p.el.style.top || "",
        transform: p.el.style.transform || "",
        edge: p.el.dataset.edge || null,
        along:
          p.el.dataset.along != null && p.el.dataset.along !== ""
            ? parseFloat(p.el.dataset.along)
            : null,
      })),
      weights: weights.map((w) => ({
        id: w.el.id,
        left: w.el.style.left || "",
        top: w.el.style.top || "",
        snap: serializeWeightSnap(w.snap),
      })),
      winches: winches.map((w) => ({
        id: w.el.id,
        left: w.el.style.left || "",
        top: w.el.style.top || "",
        snap: serializeWinchSnap(w.snap),
      })),
      ropes: ropes.map((r) => ({
        points: r.points.map((p) => ({ x: p.x, y: p.y })),
        closed: !!r.closed,
        edgeSnap: cloneJson(r.edgeSnap || { start: null, end: null }),
        wrapIds: (r.wrapIds || []).slice(),
        d: r.el.getAttribute("d") || "",
      })),
    };
  }

  function serializeWinchSnap(snap) {
    if (!snap || snap.type === "free") return { type: "free" };
    if (snap.type === "rope") {
      return {
        type: "rope",
        ropeIndex: ropes.indexOf(snap.rope),
        which: snap.which,
      };
    }
    return { type: "free" };
  }

  function scenesEqual(a, b) {
    if (!a || !b) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function beginUserAction() {
    if (historySuspended || running) return;
    actionBaseline = captureScene();
  }

  function endUserAction() {
    if (historySuspended || running || !actionBaseline) {
      actionBaseline = null;
      return;
    }
    const now = captureScene();
    if (!scenesEqual(actionBaseline, now)) {
      historyStack.push(actionBaseline);
      if (historyStack.length > HISTORY_MAX) historyStack.shift();
    }
    actionBaseline = null;
    updateHistoryButtons();
    updateClearEnabled();
  }

  function cancelUserAction() {
    actionBaseline = null;
  }

  function clearSceneObjects() {
    for (const rope of ropes.slice()) {
      rope.el.remove();
    }
    ropes = [];
    for (const weight of weights.slice()) {
      weight.el.remove();
    }
    weights = [];
    for (const winch of winches.slice()) {
      winch.el.remove();
    }
    winches = [];
    for (const pulley of pulleys.slice()) {
      pulley.el.remove();
    }
    pulleys = [];
    clearEndHandles();
    hideSnapMarker();
    clearForceArrows();
  }

  function restoreWeightSnap(weight, snapData) {
    if (!snapData || snapData.type === "free") {
      weight.snap = { type: "free" };
      return;
    }
    if (snapData.type === "rod") {
      const pulley = findPulleyById(snapData.pulleyId);
      weight.snap = pulley
        ? { type: "rod", pulley: pulley.el }
        : { type: "free" };
      return;
    }
    if (snapData.type === "rope") {
      const rope = ropes[snapData.ropeIndex];
      weight.snap =
        rope && snapData.which
          ? { type: "rope", rope, which: snapData.which }
          : { type: "free" };
      return;
    }
    if (snapData.type === "weight") {
      const support = weights.find((w) => w.el.id === snapData.weightId);
      weight.snap = support
        ? {
            type: "weight",
            weight: support,
            placement: snapData.placement || "hang",
          }
        : { type: "free" };
    }
  }

  function restoreScene(snap) {
    if (!snap) return;
    clearSceneObjects();
    pulleySeq = snap.pulleySeq || 0;
    weightSeq = snap.weightSeq || 0;
    winchSeq = snap.winchSeq || 0;

    for (const ps of snap.pulleys || []) {
      const pulley = createPulleyInstance(ps.kind, { id: ps.id });
      if (!pulley) continue;
      const el = pulley.el;
      el.style.left = ps.left || "0px";
      el.style.top = ps.top || "0px";
      el.style.transform = ps.transform || "";
      if (ps.edge) el.dataset.edge = ps.edge;
      if (ps.along != null && !Number.isNaN(ps.along)) {
        el.dataset.along = String(ps.along);
      }
      if (ps.kind === "free") {
        enableFreeDrag(el);
      } else {
        enableFixedEdgeDrag(el, {
          edge: ps.edge || "top",
          along: ps.along != null ? ps.along : 0,
          skipApply: true,
        });
      }
    }

    for (const rs of snap.ropes || []) {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.classList.add("rope-path");
      el.setAttribute("d", rs.d || pointsToPolyline(rs.points || []));
      if (rs.closed) el.dataset.closed = "true";
      ropeLayer.appendChild(el);
      ropes.push({
        el,
        points: (rs.points || []).map((p) => ({ x: p.x, y: p.y })),
        closed: !!rs.closed,
        edgeSnap: cloneJson(rs.edgeSnap || { start: null, end: null }),
        wrapIds: (rs.wrapIds || []).slice(),
      });
    }

    for (const ws of snap.weights || []) {
      const weight = createWeightInstance({ id: ws.id });
      weight.el.style.left = ws.left || "0px";
      weight.el.style.top = ws.top || "0px";
    }

    for (const ws of snap.winches || []) {
      const winch = createWinchInstance({ id: ws.id });
      winch.el.style.left = ws.left || "0px";
      winch.el.style.top = ws.top || "0px";
    }

    for (let i = 0; i < (snap.weights || []).length; i += 1) {
      restoreWeightSnap(weights[i], snap.weights[i].snap);
    }
    for (let i = 0; i < (snap.winches || []).length; i += 1) {
      restoreWinchSnap(winches[i], snap.winches[i].snap);
    }

    rebuildAllRopes();
    syncAllWeightsToSnap();
    syncAllWinchesToSnap();
    syncRopeEndHandles();
    updateForceArrows();
    updateClearEnabled();
  }

  function restoreWinchSnap(winch, snapData) {
    if (!snapData || snapData.type === "free") {
      winch.snap = { type: "free" };
      return;
    }
    if (snapData.type === "rope") {
      const rope = ropes[snapData.ropeIndex];
      winch.snap =
        rope && snapData.which
          ? { type: "rope", rope, which: snapData.which }
          : { type: "free" };
    }
  }

  function undoLastStep() {
    if (!historyStack.length) return;
    if (running) {
      stopSimulation();
      if (tool === "run") {
        tool = "move";
        applyToolChrome("move");
      }
    }
    const snap = historyStack.pop();
    historySuspended = true;
    actionBaseline = null;
    restoreScene(snap);
    historySuspended = false;
    updateHistoryButtons();
  }

  function resetToPreRun() {
    if (!preRunSnapshot) return;
    if (running) stopSimulation();
    if (tool === "run") {
      tool = "move";
      applyToolChrome("move");
    }
    historySuspended = true;
    actionBaseline = null;
    historyStack = [];
    restoreScene(cloneJson(preRunSnapshot));
    historySuspended = false;
    updateHistoryButtons();
  }

  function syncRopeCount() {
    ropes = ropes.filter((r) => r.el.isConnected);
    updateClearEnabled();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function stageSize() {
    const rect = stage.getBoundingClientRect();
    return { width: rect.width, height: rect.height, rect };
  }

  function ensureRopeEdgeSnap(rope) {
    if (!rope.edgeSnap) rope.edgeSnap = { start: null, end: null };
  }

  function clampEdgeAlong(edge, along) {
    const { width, height } = stageSize();
    if (edge === "top" || edge === "bottom") {
      return clamp(along, 0, width);
    }
    return clamp(along, 0, height);
  }

  /** Střed (osa) červené pevné kladky ve stage souřadnicích. */
  function getFixedPulleyCenterWorld(pulleyId) {
    const wheels = collectWheels().filter((w) => w.kind === "fixed");
    const w = pulleyId
      ? wheels.find((x) => x.id === pulleyId)
      : wheels[0];
    if (!w) return null;
    return { x: w.cx, y: w.cy, pulleyId: w.id };
  }

  function edgePointFromSnap(snap) {
    if (!snap) return null;
    if (snap.type === "fixedCenter") {
      const c = getFixedPulleyCenterWorld(snap.pulleyId);
      return c ? { x: c.x, y: c.y } : { x: 0, y: 0 };
    }
    const { width, height } = stageSize();
    const along = snap.along;
    if (snap.edge === "top") return { x: along, y: 0 };
    if (snap.edge === "bottom") return { x: along, y: height };
    if (snap.edge === "left") return { x: 0, y: along };
    return { x: width, y: along };
  }

  function findEdgeSnapTarget(p) {
    const { width, height } = stageSize();
    const candidates = [
      {
        edge: "top",
        d: p.y,
        along: clamp(p.x, 0, width),
        point: { x: clamp(p.x, 0, width), y: 0 },
      },
      {
        edge: "bottom",
        d: height - p.y,
        along: clamp(p.x, 0, width),
        point: { x: clamp(p.x, 0, width), y: height },
      },
      {
        edge: "left",
        d: p.x,
        along: clamp(p.y, 0, height),
        point: { x: 0, y: clamp(p.y, 0, height) },
      },
      {
        edge: "right",
        d: width - p.x,
        along: clamp(p.y, 0, height),
        point: { x: width, y: clamp(p.y, 0, height) },
      },
    ];
    candidates.sort((a, b) => a.d - b.d);
    const best = candidates[0];
    if (best.d <= CLOSE_SNAP_RADIUS) {
      return {
        type: "edge",
        edge: best.edge,
        along: best.along,
        point: best.point,
      };
    }
    return null;
  }

  /** Přichycení ke středu červené kladky. */
  function findFixedCenterSnapTarget(p) {
    let best = null;
    for (const wheel of collectWheels()) {
      if (wheel.kind !== "fixed") continue;
      const center = { x: wheel.cx, y: wheel.cy };
      const d = dist(p, center);
      if (d > CLOSE_SNAP_RADIUS) continue;
      if (!best || d < best.d) {
        best = {
          type: "fixedCenter",
          pulleyId: wheel.id,
          point: center,
          d,
        };
      }
    }
    return best;
  }

  /**
   * Kotva pro konec lana: střed červené kladky má přednost před okrajem,
   * pokud je blíž (kladka sedí u horního okraje).
   */
  function findAnchorSnapTarget(p) {
    const center = findFixedCenterSnapTarget(p);
    const edge = findEdgeSnapTarget(p);
    if (center && edge) {
      const edgeD = edge.edge === "top" || edge.edge === "bottom"
        ? Math.abs(p.y - edge.point.y)
        : Math.abs(p.x - edge.point.x);
      return center.d <= edgeD ? center : edge;
    }
    return center || edge;
  }

  function normalizeEndSnap(snap) {
    if (!snap) return null;
    if (snap.type === "fixedCenter") {
      return { type: "fixedCenter", pulleyId: snap.pulleyId || null };
    }
    if (snap.edge) {
      return {
        type: "edge",
        edge: snap.edge,
        along: clampEdgeAlong(snap.edge, snap.along),
      };
    }
    return null;
  }

  function isRopeEndOnEdge(rope, which) {
    ensureRopeEdgeSnap(rope);
    return rope.edgeSnap[which] != null;
  }

  function getRopeEndPoint(rope, which) {
    ensureRopeEdgeSnap(rope);
    const snap = rope.edgeSnap[which];
    if (snap) {
      const pt = edgePointFromSnap(snap);
      if (pt) return pt;
    }
    return which === "start"
      ? rope.points[0]
      : rope.points[rope.points.length - 1];
  }

  function syncRopeEdgePoint(rope, which) {
    ensureRopeEdgeSnap(rope);
    const snap = rope.edgeSnap[which];
    if (!snap) return;
    const pt = edgePointFromSnap(snap);
    if (!pt) return;
    if (which === "start") rope.points[0] = pt;
    else rope.points[rope.points.length - 1] = pt;
  }

  function syncRopeEdgePoints(rope) {
    syncRopeEdgePoint(rope, "start");
    syncRopeEdgePoint(rope, "end");
  }

  function syncAllRopeEdgePoints() {
    for (const rope of ropes) syncRopeEdgePoints(rope);
  }

  function outerEdgeSnaps(a, aWhich, b, bWhich) {
    ensureRopeEdgeSnap(a);
    ensureRopeEdgeSnap(b);
    const pick = (rope, which) => rope.edgeSnap[which];

    if (aWhich === "end" && bWhich === "start") {
      return { start: pick(a, "start"), end: pick(b, "end") };
    }
    if (aWhich === "end" && bWhich === "end") {
      return { start: pick(a, "start"), end: pick(b, "start") };
    }
    if (aWhich === "start" && bWhich === "start") {
      return { start: pick(a, "end"), end: pick(b, "end") };
    }
    return { start: pick(a, "end"), end: pick(b, "end") };
  }

  function applyToolChrome(next) {
    if (appRoot) appRoot.dataset.tool = next;
    stage.dataset.tool = next;
    btnMove.classList.toggle("is-active", next === "move");
    btnPencil.classList.toggle("is-active", next === "pencil");
    btnRun.classList.toggle("is-active", next === "run");
    btnRun.classList.toggle("is-run", next === "run");
    if (btnErase) {
      btnErase.classList.toggle("is-active", next === "erase");
      btnErase.setAttribute("aria-pressed", String(next === "erase"));
    }
    btnMove.setAttribute("aria-pressed", String(next === "move"));
    btnPencil.setAttribute("aria-pressed", String(next === "pencil"));
    btnRun.setAttribute("aria-pressed", String(next === "run"));
    btnMove.setAttribute("aria-selected", String(next === "move"));
    btnPencil.setAttribute("aria-selected", String(next === "pencil"));
    btnRun.setAttribute("aria-selected", String(next === "run"));
    btnRun.textContent = next === "run" ? "Zastavit" : "Spustit";
  }

  function setTool(next) {
    if (running && next !== "run") stopSimulation();

    tool = next;
    applyToolChrome(next);

    if (next === "run") startSimulation();
    else syncRopeEndHandles();
  }

  function isDocked(el) {
    return !!(
      el &&
      (el.classList.contains("is-docked") ||
        el.classList.contains("is-stock-template"))
    );
  }

  function isStockTemplate(el) {
    return !!(el && el.classList.contains("is-stock-template"));
  }

  function isOverStock(clientX, clientY) {
    if (!stockTray) return false;
    const r = stockTray.getBoundingClientRect();
    return (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    );
  }

  function setStockDropTarget(active) {
    if (stockTray) stockTray.classList.toggle("is-drop-target", !!active);
  }

  function findPulleyByEl(el) {
    return pulleys.find((p) => p.el === el) || null;
  }

  function findPulleyById(id) {
    return pulleys.find((p) => p.id === id) || null;
  }

  function placeElUnderPointer(el, clientX, clientY, offsetX, offsetY) {
    const { rect } = stageSize();
    const w = el.offsetWidth || 70;
    const h = el.offsetHeight || 70;
    const ox = offsetX != null ? offsetX : w * 0.5;
    const oy = offsetY != null ? offsetY : h * 0.4;
    el.style.left = `${clientX - rect.left - ox}px`;
    el.style.top = `${clientY - rect.top - oy}px`;
    return { offsetX: ox, offsetY: oy };
  }

  function createPulleyInstance(kind, opts = {}) {
    const template =
      kind === "fixed" ? stockTemplateFixed : stockTemplateFree;
    if (!template) return null;
    const el = template.cloneNode(true);
    el.classList.remove("is-stock-template", "is-docked", "is-dragging");
    el.removeAttribute("id");
    const id = opts.id || `pulley-${kind}-${++pulleySeq}`;
    if (opts.id) {
      const m = String(opts.id).match(/(\d+)$/);
      if (m) pulleySeq = Math.max(pulleySeq, parseInt(m[1], 10));
    }
    el.dataset.pulleyId = id;
    el.dataset.kind = kind;
    el.setAttribute(
      "aria-label",
      kind === "fixed" ? "Pevná kladka" : "Volná kladka"
    );
    const pulley = { el, kind, id, vel: { x: 0, y: 0 } };
    pulleys.push(pulley);
    stage.appendChild(el);
    return pulley;
  }

  function destroyPulley(pulleyOrEl) {
    const pulley =
      typeof pulleyOrEl === "object" && pulleyOrEl?.el
        ? pulleyOrEl
        : findPulleyByEl(pulleyOrEl);
    if (!pulley) return;
    const id = pulley.id;
    for (const weight of weights) {
      if (weight.snap.type === "rod" && weight.snap.pulley === pulley.el) {
        weight.snap = { type: "free" };
      }
    }
    for (const rope of ropes) {
      if (rope.wrapIds) {
        rope.wrapIds = rope.wrapIds.filter((wid) => wid !== id);
      }
      // legacy wrapKinds cleanup not needed
      if (rope.edgeSnap) {
        for (const which of ["start", "end"]) {
          const snap = rope.edgeSnap[which];
          if (snap?.type === "fixedCenter" && snap.pulleyId === id) {
            rope.edgeSnap[which] = null;
          }
        }
      }
    }
    pulley.el.remove();
    pulleys = pulleys.filter((p) => p !== pulley);
    rebuildAllRopes();
    syncAllWeightsToSnap();
    updateForceArrows();
  }

  function returnPulleyToStock(el) {
    destroyPulley(el);
  }

  function createWeightInstance(opts = {}) {
    const el = document.createElement("div");
    el.className = "weight";
    const id = opts.id || `weight-${++weightSeq}`;
    if (opts.id) {
      const m = String(opts.id).match(/(\d+)$/);
      if (m) weightSeq = Math.max(weightSeq, parseInt(m[1], 10));
    }
    el.id = id;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "Závaží");
    el.innerHTML = WEIGHT_SVG;
    stage.appendChild(el);
    const weight = {
      el,
      snap: { type: "free" },
      vel: { x: 0, y: 0 },
      dragging: false,
    };
    weights.push(weight);
    enableWeightDrag(weight);
    return weight;
  }

  function destroyWeight(weight) {
    if (!weight) return;
    detachWeightsFrom(weight);
    weight.el.remove();
    weights = weights.filter((w) => w !== weight);
    updateForceArrows();
  }

  function returnWeightToStock(weight) {
    destroyWeight(weight);
  }

  function createWinchInstance(opts = {}) {
    const el = document.createElement("div");
    el.className = "winch";
    const id = opts.id || `winch-${++winchSeq}`;
    if (opts.id) {
      const m = String(opts.id).match(/(\d+)$/);
      if (m) winchSeq = Math.max(winchSeq, parseInt(m[1], 10));
    }
    el.id = id;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "Naviják");
    el.innerHTML = WINCH_SVG;
    stage.appendChild(el);
    const winch = {
      el,
      snap: { type: "free" },
      dragging: false,
      winding: false,
    };
    winches.push(winch);
    enableWinchDrag(winch);
    return winch;
  }

  function destroyWinch(winch) {
    if (!winch) return;
    winch.el.remove();
    winches = winches.filter((w) => w !== winch);
    updateForceArrows();
  }

  function returnWinchToStock(winch) {
    destroyWinch(winch);
  }

  function getWinchHookOffset(winch) {
    const svg = winch.el.querySelector("svg");
    const scale =
      (svg && svg.getBoundingClientRect().width) / WINCH.vbW ||
      winch.el.offsetWidth / WINCH.vbW;
    return { x: WINCH.hookX * scale, y: WINCH.hookY * scale };
  }

  function getWinchHookWorld(winch) {
    const left = parseFloat(winch.el.style.left) || 0;
    const top = parseFloat(winch.el.style.top) || 0;
    const off = getWinchHookOffset(winch);
    return { x: left + off.x, y: top + off.y };
  }

  function placeWinchAtHook(winch, point) {
    const { width, height } = stageSize();
    const off = getWinchHookOffset(winch);
    const w = winch.el.offsetWidth || 78;
    const h = winch.el.offsetHeight || 65;
    const left = clamp(point.x - off.x, 0, Math.max(0, width - w));
    const top = clamp(point.y - off.y, 0, Math.max(0, height - h));
    winch.el.style.left = `${left}px`;
    winch.el.style.top = `${top}px`;
  }

  function winchOnRopeEnd(rope, which) {
    return winches.find(
      (w) =>
        w.snap.type === "rope" &&
        w.snap.rope === rope &&
        w.snap.which === which
    );
  }

  function isRopeEndTaken(rope, which, excludeWeight, excludeWinch) {
    if (isRopeEndTakenByWeight(rope, which, excludeWeight)) return true;
    return winches.some(
      (w) =>
        w !== excludeWinch &&
        w.snap.type === "rope" &&
        w.snap.rope === rope &&
        w.snap.which === which
    );
  }

  function setWinchWinding(winch, on) {
    winch.winding = !!on;
    winch.el.classList.toggle("is-winding", !!on);
  }

  function syncWinchToSnap(winch) {
    if (winch.dragging || isDocked(winch.el)) return;
    if (winch.snap.type !== "rope") {
      setWinchWinding(winch, false);
      return;
    }
    const rope = winch.snap.rope;
    if (!rope?.el?.isConnected) {
      winch.snap = { type: "free" };
      setWinchWinding(winch, false);
      return;
    }
    let pt;
    if (running && rope.sim) {
      pt =
        winch.snap.which === "start" ? rope.sim.startPt : rope.sim.endPt;
    } else {
      pt = getRopeEndPoint(rope, winch.snap.which);
    }
    // Naviják je kotva — přichytí lano k sobě, ne naopak
    // (sync během sim řeší getRopeSimEndpoint)
    if (!running) placeWinchAtHook(winch, pt);
  }

  function syncAllWinchesToSnap() {
    for (const winch of winches) syncWinchToSnap(winch);
  }

  function ensureStockTemplatesInSlots() {
    if (stockTemplateFixed && stockSlotFixed && !stockSlotFixed.contains(stockTemplateFixed)) {
      stockSlotFixed.appendChild(stockTemplateFixed);
    }
    if (stockTemplateFree && stockSlotFree && !stockSlotFree.contains(stockTemplateFree)) {
      stockSlotFree.appendChild(stockTemplateFree);
    }
  }

  function ensureWeightStockTemplate() {
    if (!stockSlotWeights) return null;
    let tpl = document.getElementById("stock-template-weight");
    if (tpl) return tpl;
    tpl = document.createElement("div");
    tpl.className = "weight is-stock-template";
    tpl.id = "stock-template-weight";
    tpl.setAttribute("role", "img");
    tpl.setAttribute("aria-label", "Závaží — vytáhnout ze zásobníku");
    tpl.innerHTML = WEIGHT_SVG;
    stockSlotWeights.appendChild(tpl);
    return tpl;
  }

  function ensureWinchStockTemplate() {
    if (!stockSlotWinch) return null;
    let tpl = document.getElementById("stock-template-winch");
    if (tpl) return tpl;
    tpl = document.createElement("div");
    tpl.className = "winch is-stock-template";
    tpl.id = "stock-template-winch";
    tpl.setAttribute("role", "img");
    tpl.setAttribute("aria-label", "Naviják — vytáhnout ze zásobníku");
    tpl.innerHTML = WINCH_SVG;
    stockSlotWinch.appendChild(tpl);
    return tpl;
  }

  function syncRopeViewBox() {
    const { width, height } = stageSize();
    ropeLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    ropeLayer.setAttribute("width", String(width));
    ropeLayer.setAttribute("height", String(height));
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function pointsToPolyline(points) {
    if (!points.length) return "";
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
  }

  /** Ramer–Douglas–Peucker */
  function simplify(points, epsilon) {
    if (points.length < 3) return points.slice();

    let maxDist = 0;
    let index = 0;
    const first = points[0];
    const last = points[points.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const lenSq = dx * dx + dy * dy;

    for (let i = 1; i < points.length - 1; i += 1) {
      const p = points[i];
      let d;
      if (lenSq < 1e-8) {
        d = dist(p, first);
      } else {
        const t = clamp(
          ((p.x - first.x) * dx + (p.y - first.y) * dy) / lenSq,
          0,
          1
        );
        d = Math.hypot(p.x - (first.x + t * dx), p.y - (first.y + t * dy));
      }
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }

    if (maxDist > epsilon) {
      const left = simplify(points.slice(0, index + 1), epsilon);
      const right = simplify(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function getWheelWorld(el, kind) {
    const meta = WHEEL[kind];
    const svg = el.querySelector("svg");
    const stageRect = stage.getBoundingClientRect();
    const ctm = svg.getScreenCTM();

    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = meta.cx;
      pt.y = meta.cy;
      const screen = pt.matrixTransform(ctm);
      const scale = Math.hypot(ctm.a, ctm.b);
      return {
        cx: screen.x - stageRect.left,
        cy: screen.y - stageRect.top,
        r: meta.grooveR * scale,
      };
    }

    const scale =
      (svg.getBoundingClientRect().width || el.offsetWidth) / meta.vbW;
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    return {
      cx: left + meta.cx * scale,
      cy: top + meta.cy * scale,
      r: meta.grooveR * scale,
    };
  }

  function collectWheels() {
    const wheels = [];
    for (const pulley of pulleys) {
      if (!pulley.el.isConnected || isDocked(pulley.el)) continue;
      wheels.push({
        ...getWheelWorld(pulley.el, pulley.kind),
        kind: pulley.kind,
        id: pulley.id,
        el: pulley.el,
      });
    }
    return wheels;
  }

  function pointOnCircle(wheel, angle) {
    return {
      x: wheel.cx + wheel.r * Math.cos(angle),
      y: wheel.cy + wheel.r * Math.sin(angle),
    };
  }

  /**
   * Tečna z vnějšího bodu ke kružnici.
   * side: +1 / -1 volí jednu ze dvou tečen.
   */
  function tangentAngleFromPoint(wheel, p, side) {
    const dx = p.x - wheel.cx;
    const dy = p.y - wheel.cy;
    const d = Math.hypot(dx, dy);
    const base = Math.atan2(dy, dx);

    if (d <= wheel.r * 1.001) {
      return base;
    }

    const alpha = Math.acos(clamp(wheel.r / d, -1, 1));
    return base + side * alpha;
  }

  /** SVG arc: y roste dolů → sweep=1 je po směru hodin (kladný atan2). */
  function svgArc(wheel, a0, a1, clockwise) {
    let cw = clockwise;
    let travel = wrapTravelRaw(a0, a1, cw);
    // Nikdy neomotat skoro celou kladku — vždy kratší přípustný oblouk.
    if (Math.abs(travel) > MAX_WRAP_TRAVEL + 1e-6) {
      const alt = wrapTravelRaw(a0, a1, !cw);
      if (Math.abs(alt) < Math.abs(travel)) {
        cw = !cw;
        travel = alt;
      }
    }
    // Konce zůstávají na a0/a1 (tečny). Travel jen pro SVG flags.
    if (Math.abs(travel) < 1e-4) {
      travel = cw ? MIN_WRAP_TRAVEL : -MIN_WRAP_TRAVEL;
    }
    const p0 = pointOnCircle(wheel, a0);
    const p1 = pointOnCircle(wheel, a1);

    const large = Math.abs(travel) > Math.PI + 1e-6 ? 1 : 0;
    const sweep = cw ? 1 : 0;

    return {
      start: p0,
      end: p1,
      clockwise: cw,
      d: `L${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${wheel.r.toFixed(2)} ${wheel.r.toFixed(2)} 0 ${large} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      travel,
    };
  }

  /**
   * Najde souvislé průchody kolem kladky a nahradí je čistým obloukem
   * podle tečen a směru tahu.
   */
  function findWraps(points, wheel) {
    // Širší pás: tah pod kladkou často klesne pod r + band a jinak
    // by se wrap rozpadl na dvě krátká škrábnutí.
    const band = Math.max(48, wheel.r * 1.35);
    const outer = wheel.r + band;
    const farLimit = wheel.r * 2.8;
    const distTo = (p) => Math.hypot(p.x - wheel.cx, p.y - wheel.cy);
    const near = points.map((p) => distTo(p) <= outer);

    const raw = [];
    let i = 0;
    while (i < points.length) {
      if (!near[i]) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < points.length && near[j]) j += 1;
      raw.push({ start: i, end: j - 1 });
      i = j;
    }

    // Spoj sousední průchody, pokud mezi nimi tah stále „obíhá“ kladku
    // (typicky dno U pod kolem, které vypadne z pásu).
    const merged = [];
    for (const run of raw) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({ ...run });
        continue;
      }

      const gapPts = points.slice(last.end + 1, run.start);
      const gapReachable =
        gapPts.length > 0 && gapPts.every((p) => distTo(p) <= farLimit);
      const crossesHub = gapPts.some((p) => distTo(p) < wheel.r * 0.45);

      let angTravel = 0;
      for (let k = last.end; k < run.start; k += 1) {
        const a0 = Math.atan2(points[k].y - wheel.cy, points[k].x - wheel.cx);
        const a1 = Math.atan2(
          points[k + 1].y - wheel.cy,
          points[k + 1].x - wheel.cx
        );
        angTravel += normalizeAngle(a1 - a0);
      }

      if (gapReachable && !crossesHub && Math.abs(angTravel) >= 0.2) {
        last.end = run.end;
      } else {
        merged.push({ ...run });
      }
    }

    const wraps = [];
    for (const run of merged) {
      const runLen = points
        .slice(run.start, run.end + 1)
        .reduce((s, p, k, arr) => (k ? s + dist(arr[k - 1], p) : s), 0);
      if (run.end - run.start >= 2 && runLen >= 12) {
        wraps.push(run);
      }
    }
    return wraps;
  }

  function wrapDirection(points, start, end, wheel) {
    if (end <= start) return "cw";

    const a = Math.atan2(points[start].y - wheel.cy, points[start].x - wheel.cx);
    const b = Math.atan2(points[end].y - wheel.cy, points[end].x - wheel.cx);

    // Hledáme bod z úseku wrapping, který je nejvzdálenější od přímky
    // procházející prvním a posledním bodem wrappingu.
    // Tento bod spolehlivě určí, na které straně kladky lano jde — přežije
    // i simplify, která může nechat jen 2–3 body.
    const p0 = points[start];
    const p1 = points[end];
    const lineLen = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const nx = -(p1.y - p0.y) / lineLen; // normála (vlevo od směru p0→p1)
    const ny = (p1.x - p0.x) / lineLen;
    let bestSigned = 0;
    let bestMidAng = Math.atan2(
      points[Math.floor((start + end) / 2)].y - wheel.cy,
      points[Math.floor((start + end) / 2)].x - wheel.cx
    );
    for (let k = start; k <= end; k++) {
      const s = (points[k].x - p0.x) * nx + (points[k].y - p0.y) * ny;
      if (Math.abs(s) > Math.abs(bestSigned)) {
        bestSigned = s;
        bestMidAng = Math.atan2(points[k].y - wheel.cy, points[k].x - wheel.cx);
      }
    }
    const m = bestMidAng;

    function arcContains(cw) {
      const total = wrapTravelRaw(a, b, cw);
      const toMid = wrapTravelRaw(a, m, cw);
      if (Math.abs(total) < 1e-4) return false;
      if (Math.sign(total) !== Math.sign(toMid) && Math.abs(toMid) > 0.05) {
        return false;
      }
      if (Math.abs(toMid) > Math.abs(total) + 0.1) return false;
      const fromMid = wrapTravelRaw(m, b, cw);
      if (Math.sign(total) !== Math.sign(fromMid) && Math.abs(fromMid) > 0.05) {
        return false;
      }
      return Math.abs(toMid + fromMid - total) < 0.25;
    }

    if (arcContains(true)) return "cw";
    if (arcContains(false)) return "ccw";

    // Záloha: součet úhlových kroků
    let signed = 0;
    for (let k = start; k < end; k += 1) {
      const a0 = Math.atan2(points[k].y - wheel.cy, points[k].x - wheel.cx);
      const a1 = Math.atan2(
        points[k + 1].y - wheel.cy,
        points[k + 1].x - wheel.cx
      );
      signed += normalizeAngle(a1 - a0);
    }
    if (Math.abs(signed) < 0.12) {
      // Střed kladky leží vlevo nebo vpravo od směrového vektoru lana?
      // V SVG (y dolů): cross > 0 → střed je vpravo od tahu → lano se vine po obvodu cw.
      const cross =
        (points[end].x - points[start].x) * (wheel.cy - points[start].y) -
        (points[end].y - points[start].y) * (wheel.cx - points[start].x);
      signed = cross >= 0 ? 1 : -1;
    }
    return signed >= 0 ? "cw" : "ccw";
  }

  function sameWheel(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    if (a.el && b.el) return a.el === b.el;
    return dist(a, b) < 4 && Math.abs(a.r - b.r) < 4;
  }

  function segmentClosestDist(p0, p1, wheel) {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) {
      return Math.hypot(p0.x - wheel.cx, p0.y - wheel.cy);
    }
    const t = clamp(
      ((wheel.cx - p0.x) * dx + (wheel.cy - p0.y) * dy) / lenSq,
      0,
      1
    );
    return Math.hypot(p0.x + t * dx - wheel.cx, p0.y + t * dy - wheel.cy);
  }

  /** Úsek jde skrz kladku nebo těsně podél obvodu (má se obepnout, ne obejít). */
  function segmentTouchesWheel(p0, p1, wheel, pad = 5) {
    if (segmentPiercesWheel(p0, p1, wheel, 3)) return true;
    return segmentClosestDist(p0, p1, wheel) < wheel.r + pad;
  }

  function freeRangesOfStroke(pts, picked) {
    if (!picked.length) return [{ start: 0, end: pts.length - 1 }];
    const ranges = [{ start: 0, end: picked[0].start }];
    for (let i = 0; i < picked.length - 1; i += 1) {
      ranges.push({ start: picked[i].end, end: picked[i + 1].start });
    }
    ranges.push({
      start: picked[picked.length - 1].end,
      end: pts.length - 1,
    });
    return ranges;
  }

  function insertWrapEvent(picked, ev) {
    if (picked.some((p) => sameWheel(p.wheel, ev.wheel))) return false;
    picked.push(ev);
    picked.sort((a, b) => a.start - b.start || a.end - b.end);
    // Znovu ořež překryvy (stejná logika jako při prvním výběru)
    const cleaned = [];
    for (const e of picked) {
      if (cleaned.some((p) => sameWheel(p.wheel, e.wheel))) continue;
      const last = cleaned[cleaned.length - 1];
      const next = { ...e };
      if (last && next.start <= last.end) {
        if (next.end <= last.end) continue;
        next.start = last.end;
        if (next.end - next.start < 1) continue;
      }
      cleaned.push(next);
    }
    picked.length = 0;
    for (const e of cleaned) picked.push(e);
    return true;
  }

  /**
   * Když volný úsek míjí neobepnutou kladku, doplň wrap —
   * jinak lineToAvoidingWheels udělá „V“ s mezerou pod kolem.
   */
  function supplementMissedWraps(pts, picked) {
    const wheels = collectWheels();
    for (let guard = 0; guard < wheels.length + 2; guard += 1) {
      let added = false;
      for (const wheel of wheels) {
        if (picked.some((p) => sameWheel(p.wheel, wheel))) continue;
        const ranges = freeRangesOfStroke(pts, picked);
        for (const range of ranges) {
          if (range.end - range.start < 1) continue;
          let hit = false;
          for (let i = range.start; i < range.end; i += 1) {
            if (segmentTouchesWheel(pts[i], pts[i + 1], wheel, 6)) {
              hit = true;
              break;
            }
          }
          if (!hit) continue;
          const run = findPiercingSpan(pts, wheel, range.start, range.end);
          if (!run) continue;
          const start = Math.max(run.start, range.start);
          const end = Math.min(run.end, range.end);
          if (end - start < 1) continue;
          added = insertWrapEvent(picked, {
            start,
            end,
            wheel,
            clockwise:
              wrapDirection(pts, start, end, wheel) === "cw",
          });
          if (added) break;
        }
        if (added) break;
      }
      if (!added) break;
    }
  }

  function pickWrapEvents(pts) {
    const wheels = collectWheels();
    const events = [];

    for (const wheel of wheels) {
      for (const w of findWraps(pts, wheel)) {
        events.push({
          ...w,
          wheel,
          clockwise: wrapDirection(pts, w.start, w.end, wheel) === "cw",
        });
      }
      if (!events.some((e) => sameWheel(e.wheel, wheel))) {
        const run = findPiercingSpan(pts, wheel);
        if (run) {
          events.push({
            start: run.start,
            end: run.end,
            wheel,
            clockwise: wrapDirection(pts, run.start, run.end, wheel) === "cw",
          });
        }
      }
    }

    // Podle pořadí tahu: ke kladce jen první přimknutí, další se zahodí
    events.sort((a, b) => a.start - b.start || a.end - b.end);

    const picked = [];
    for (const ev of events) {
      if (picked.some((p) => sameWheel(p.wheel, ev.wheel))) continue;

      const last = picked[picked.length - 1];
      if (last && ev.start <= last.end) {
        if (ev.end <= last.end) continue;
        ev.start = last.end;
        if (ev.end - ev.start < 1) continue;
      }
      picked.push(ev);
    }

    supplementMissedWraps(pts, picked);
    return picked;
  }

  /** Najde úsek tahu, který prochází vnitřkem / těsně podél kladky. */
  function findPiercingSpan(pts, wheel, fromIdx = 0, toIdx = pts.length - 1) {
    const lo = Math.max(0, fromIdx);
    const hi = Math.min(pts.length - 1, toIdx);
    let first = -1;
    let last = -1;
    for (let i = lo; i < hi; i += 1) {
      if (segmentTouchesWheel(pts[i], pts[i + 1], wheel, 5)) {
        if (first < 0) first = i;
        last = i + 1;
      }
    }
    if (first < 0) {
      const distTo = (p) => Math.hypot(p.x - wheel.cx, p.y - wheel.cy);
      for (let i = lo; i <= hi; i += 1) {
        if (distTo(pts[i]) < wheel.r + 4) {
          if (first < 0) first = i;
          last = i;
        }
      }
    }
    if (first < 0) return null;
    first = Math.max(lo, first - 1);
    last = Math.min(hi, last + 1);
    if (last - first < 1) {
      last = Math.min(hi, first + 1);
    }
    return { start: first, end: last };
  }

  /**
   * Tečna z vnějšího bodu ke kružnici, zvolená podle směru obepnutí.
   * clockwise=true → v SVG (y dolů) vstupní tečna se side=+1.
   */
  function tangentFromFreePoint(wheel, p, clockwise, entering) {
    const side = entering
      ? clockwise
        ? 1
        : -1
      : clockwise
        ? -1
        : 1;
    return tangentAngleFromPoint(wheel, p, side);
  }

  /**
   * Všechny společné tečny dvou kružnic (2 vnější + 2 vnitřní).
   */
  function allCommonTangents(w0, w1) {
    const dx = w1.cx - w0.cx;
    const dy = w1.cy - w0.cy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return [];

    const base = Math.atan2(dy, dx);
    const out = [];

    // Vnější (direct) — stejná strana
    for (const sign of [-1, 1]) {
      const rr = w0.r - w1.r;
      if (Math.abs(rr) >= d - 1e-9) continue;
      const ph = Math.acos(clamp(rr / d, -1, 1));
      out.push({
        a0: base + sign * ph,
        a1: base + sign * ph,
        type: "ext",
      });
    }

    // Vnitřní (transverse) — tečny se kříží mezi středy
    for (const sign of [-1, 1]) {
      if (w0.r + w1.r >= d - 1e-9) continue;
      const ph = Math.acos(clamp((w0.r + w1.r) / d, -1, 1));
      out.push({
        a0: base + sign * ph,
        a1: base + Math.PI + sign * ph,
        type: "int",
      });
    }

    return out;
  }

  function angDist(a, b) {
    return Math.abs(normalizeAngle(a - b));
  }

  function distPointToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) return dist(p, a);
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /** Projde úseček vnitřkem kola (kromě konců na obvodu)? */
  function segmentPiercesWheel(p0, p1, wheel, endClear = 8) {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) return false;

    const t = clamp(
      ((wheel.cx - p0.x) * dx + (wheel.cy - p0.y) * dy) / lenSq,
      0,
      1
    );
    const closest = { x: p0.x + t * dx, y: p0.y + t * dy };
    if (Math.hypot(closest.x - wheel.cx, closest.y - wheel.cy) >= wheel.r - 1.5) {
      return false;
    }
    return dist(p0, closest) >= endClear && dist(p1, closest) >= endClear;
  }

  /** Směr oblouku: vybere smysl s přirozeným obepnutím (ne zlom, ne celý kruh). */
  function resolveArcClockwise(enterAng, leaveAng, hintCw) {
    function absTravel(cw) {
      let t = Math.abs(wrapTravelRaw(enterAng, leaveAng, cw));
      if (t < 1e-4) t = 2 * Math.PI;
      return t;
    }
    function ok(t) {
      return t >= MIN_WRAP_TRAVEL - 1e-6 && t <= MAX_WRAP_TRAVEL + 1e-6;
    }

    const tHint = absTravel(hintCw);
    const tAlt = absTravel(!hintCw);
    if (ok(tHint)) return hintCw;
    if (ok(tAlt)) return !hintCw;
    // Kratší oblouk je méně náchylný k celému závitu
    return tHint <= tAlt ? hintCw : !hintCw;
  }

  function wrapTravelRaw(a0, a1, clockwise) {
    let travel = normalizeAngle(a1 - a0);
    if (clockwise && travel < 0) travel += 2 * Math.PI;
    if (!clockwise && travel > 0) travel -= 2 * Math.PI;
    return travel;
  }

  function travelFor(a0, a1, clockwise) {
    let travel = wrapTravelRaw(a0, a1, clockwise);
    // Nikdy celý závit; nenuť minimální oblouk (rozbíjí společné tečny).
    if (Math.abs(travel) < 1e-4) {
      travel = clockwise ? MIN_WRAP_TRAVEL : -MIN_WRAP_TRAVEL;
    } else if (Math.abs(travel) > MAX_WRAP_TRAVEL) {
      travel = clockwise ? MAX_WRAP_TRAVEL : -MAX_WRAP_TRAVEL;
    }
    return travel;
  }

  /** Omezí výstupní úhel jen proti celému závitu / nulovému zlomu. */
  function clampWrapLeave(enterAng, leaveAng, clockwise) {
    let travel = wrapTravelRaw(enterAng, leaveAng, clockwise);
    const abs = Math.abs(travel);
    if (abs < 1e-4 || abs < MIN_WRAP_TRAVEL) {
      travel = clockwise ? MIN_WRAP_TRAVEL : -MIN_WRAP_TRAVEL;
    } else if (abs > MAX_WRAP_TRAVEL) {
      travel = clockwise ? MAX_WRAP_TRAVEL : -MAX_WRAP_TRAVEL;
    }
    return enterAng + travel;
  }

  /**
   * Společná tečna: vybere kandidáta podle skutečného tahu mezi kladkami.
   */
  function commonTangentAngles(
    w0,
    leaveCw,
    w1,
    enterCw,
    hintLeaveAng,
    hintEnterAng,
    hintMid,
    knownEnterAng
  ) {
    const candidates = allCommonTangents(w0, w1);
    if (!candidates.length) {
      const base = Math.atan2(w1.cy - w0.cy, w1.cx - w0.cx);
      return { a0: base, a1: base + Math.PI };
    }

    let best = null;
    let bestScore = Infinity;

    for (const c of candidates) {
      const p0 = pointOnCircle(w0, c.a0);
      const p1 = pointOnCircle(w1, c.a1);
      const tx = p1.x - p0.x;
      const ty = p1.y - p0.y;
      const len = Math.hypot(tx, ty) || 1;

      // Tečný směr ve smyslu obepnutí (odchozí na w0, příchozí na w1)
      const leaveT = leaveCw ? c.a0 + Math.PI / 2 : c.a0 - Math.PI / 2;
      const enterT = enterCw ? c.a1 + Math.PI / 2 : c.a1 - Math.PI / 2;
      const alignOut =
        (tx / len) * Math.cos(leaveT) + (ty / len) * Math.sin(leaveT);
      const alignIn =
        (tx / len) * Math.cos(enterT) + (ty / len) * Math.sin(enterT);

      let score = 0;
      // Lano nesmí jít skrz kladku — tvrdá penalizace
      if (segmentPiercesWheel(p0, p1, w0, 3)) score += 5000;
      if (segmentPiercesWheel(p0, p1, w1, 3)) score += 5000;

      // Tečna musí souhlasit se smyslem obepnutí — jinak ostré „V“ na styku
      if (alignOut < 0.15) score += 8000;
      if (alignIn < 0.15) score += 8000;

      // Hlavní kritérium: tečna má ležet u nakresleného volného úseku
      if (hintMid) score += distPointToSegment(hintMid, p0, p1) * 3;
      if (hintLeaveAng != null) score += angDist(c.a0, hintLeaveAng) * 25;
      if (hintEnterAng != null) score += angDist(c.a1, hintEnterAng) * 25;

      if (knownEnterAng != null) {
        const arcT = Math.abs(wrapTravelRaw(knownEnterAng, c.a0, leaveCw));
        const absT = arcT < 1e-4 ? 2 * Math.PI : arcT;
        if (absT > MAX_WRAP_TRAVEL) score += 120;
        if (absT < MIN_WRAP_TRAVEL) score += 40;
      }

      // Soft penalizace za slabší soulad
      score += Math.max(0, 0.85 - alignOut) * 40;
      score += Math.max(0, 0.85 - alignIn) * 40;

      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return best || candidates[0];
  }

  function strokeHintAngle(pts, index, wheel) {
    const p = pts[clamp(index, 0, pts.length - 1)];
    return Math.atan2(p.y - wheel.cy, p.x - wheel.cx);
  }

  function freeSegmentMid(pts, fromIdx, toIdx) {
    if (toIdx <= fromIdx) return null;
    const slice = pts.slice(fromIdx, toIdx + 1);
    if (!slice.length) return null;
    return slice[Math.floor(slice.length / 2)];
  }

  /** Po spočtení tečen oprav volné úseky, které by šly skrz kladku. */
  function repairPiercingFreeSegments(wraps, enterAng, leaveAng, pts, closed) {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < wraps.length - 1; i += 1) {
        const a = wraps[i];
        const b = wraps[i + 1];
        const p0 = pointOnCircle(a.wheel, leaveAng[i]);
        const p1 = pointOnCircle(b.wheel, enterAng[i + 1]);
        // endClear ≥ 8: pravá tečna na obvodu není „průchod“
        if (
          !segmentPiercesWheel(p0, p1, a.wheel, 8) &&
          !segmentPiercesWheel(p0, p1, b.wheel, 8)
        ) {
          continue;
        }
        const mid = freeSegmentMid(pts, a.end, b.start);
        const tang = commonTangentAngles(
          a.wheel,
          a.clockwise,
          b.wheel,
          b.clockwise,
          leaveAng[i],
          enterAng[i + 1],
          mid,
          enterAng[i]
        );
        leaveAng[i] = tang.a0;
        enterAng[i + 1] = tang.a1;
      }

      if (!closed && wraps.length) {
        const first = wraps[0];
        const last = wraps[wraps.length - 1];
        const startPt = pts[0];
        const endPt = pts[pts.length - 1];
        let pe = pointOnCircle(first.wheel, enterAng[0]);
        if (
          segmentPiercesWheel(startPt, pe, first.wheel, 8) ||
          segmentCrossesWheel(startPt, pe, first.wheel, 2)
        ) {
          first.clockwise = !first.clockwise;
          enterAng[0] = tangentFromFreePoint(
            first.wheel,
            startPt,
            first.clockwise,
            true
          );
          if (wraps.length === 1) {
            leaveAng[0] = tangentFromFreePoint(
              first.wheel,
              endPt,
              first.clockwise,
              false
            );
          } else {
            const mid = freeSegmentMid(pts, first.end, wraps[1].start);
            const tang = commonTangentAngles(
              first.wheel,
              first.clockwise,
              wraps[1].wheel,
              wraps[1].clockwise,
              leaveAng[0],
              enterAng[1],
              mid,
              enterAng[0]
            );
            leaveAng[0] = tang.a0;
            enterAng[1] = tang.a1;
          }
        }
        let pl = pointOnCircle(last.wheel, leaveAng[wraps.length - 1]);
        if (
          segmentPiercesWheel(pl, endPt, last.wheel, 8) ||
          segmentCrossesWheel(pl, endPt, last.wheel, 2)
        ) {
          last.clockwise = !last.clockwise;
          leaveAng[wraps.length - 1] = tangentFromFreePoint(
            last.wheel,
            endPt,
            last.clockwise,
            false
          );
          if (wraps.length === 1) {
            enterAng[0] = tangentFromFreePoint(
              last.wheel,
              startPt,
              last.clockwise,
              true
            );
          } else {
            const prev = wraps[wraps.length - 2];
            const li = wraps.length - 2;
            const mid = freeSegmentMid(pts, prev.end, last.start);
            const tang = commonTangentAngles(
              prev.wheel,
              prev.clockwise,
              last.wheel,
              last.clockwise,
              leaveAng[li],
              enterAng[li + 1],
              mid,
              enterAng[li]
            );
            leaveAng[li] = tang.a0;
            enterAng[li + 1] = tang.a1;
          }
        }
      }
    }

    // Jen srovnej smysl proti celému závitu; koncové tečny drž u volných konců.
    // Neflipuj jen kvůli kratšímu oblouku — to vypadá jako odskok od kladky.
    if (!closed && wraps.length) {
      const startPt = pts[0];
      const endPt = pts[pts.length - 1];
      for (let i = 0; i < wraps.length; i += 1) {
        const travel = Math.abs(
          wrapTravelRaw(enterAng[i], leaveAng[i], wraps[i].clockwise)
        );
        if (travel > MAX_WRAP_TRAVEL + 1e-6) {
          wraps[i].clockwise = !wraps[i].clockwise;
        }
      }
      enterAng[0] = tangentFromFreePoint(
        wraps[0].wheel,
        startPt,
        wraps[0].clockwise,
        true
      );
      leaveAng[wraps.length - 1] = tangentFromFreePoint(
        wraps[wraps.length - 1].wheel,
        endPt,
        wraps[wraps.length - 1].clockwise,
        false
      );
    }
  }

  /**
   * True, pokud volný úsek (nebo tětiva) jde skrz disk kladky.
   * Přísnější než segmentPiercesWheel — chytí i „lano přes kladku“.
   */
  function segmentCrossesWheel(p0, p1, wheel, pad = 2) {
    if (segmentPiercesWheel(p0, p1, wheel, 6)) return true;
    const d0 = Math.hypot(p0.x - wheel.cx, p0.y - wheel.cy);
    const d1 = Math.hypot(p1.x - wheel.cx, p1.y - wheel.cy);
    // Oba body mimo, ale tětiva zasahuje dovnitř disku
    if (d0 >= wheel.r - 1 && d1 >= wheel.r - 1) {
      return segmentClosestDist(p0, p1, wheel) < wheel.r - pad;
    }
    return false;
  }

  /**
   * Body obcházející kladku ZVENKU — jen u kladek, kterých se úsek
   * nedotýká na koncích (jinak by vzniklo ostré „V“ u tečny).
   */
  function freeSegmentDetours(p0, p1, wheels, margin = 10) {
    const detours = [];
    let from = { x: p0.x, y: p0.y };
    for (let guard = 0; guard < 8; guard += 1) {
      let hit = null;
      for (const wheel of wheels) {
        // Jen skutečný průchod diskem — ne tečný kontakt u konce lana
        if (segmentPiercesWheel(from, p1, wheel, 14)) {
          hit = wheel;
          break;
        }
      }
      if (!hit) break;

      const dx = p1.x - from.x;
      const dy = p1.y - from.y;
      const lenSq = dx * dx + dy * dy || 1;
      const t = clamp(
        ((hit.cx - from.x) * dx + (hit.cy - from.y) * dy) / lenSq,
        0,
        1
      );
      const closest = { x: from.x + t * dx, y: from.y + t * dy };
      let ox = closest.x - hit.cx;
      let oy = closest.y - hit.cy;
      let od = Math.hypot(ox, oy);
      if (od < 1e-4) {
        ox = -dy;
        oy = dx;
        od = Math.hypot(ox, oy) || 1;
      }
      const need = hit.r + margin;
      let wp = {
        x: hit.cx + (ox / od) * need,
        y: hit.cy + (oy / od) * need,
      };
      if (
        segmentPiercesWheel(from, wp, hit, 8) ||
        segmentPiercesWheel(wp, p1, hit, 8)
      ) {
        wp = {
          x: hit.cx - (ox / od) * need,
          y: hit.cy - (oy / od) * need,
        };
      }
      if (segmentPiercesWheel(from, wp, hit, 8)) {
        wp = {
          x: hit.cx + (ox / od) * (need + 14),
          y: hit.cy + (oy / od) * (need + 14),
        };
      }
      detours.push(wp);
      from = wp;
    }
    return detours;
  }

  function lineToAvoidingWheels(lineTo, from, to, wheels, ignoreWheels = []) {
    if (!from) {
      lineTo(to);
      return to;
    }
    const check = wheels.filter(
      (w) => !ignoreWheels.some((iw) => iw && sameWheel(iw, w))
    );
    const detours = freeSegmentDetours(from, to, check);
    for (const wp of detours) lineTo(wp);
    lineTo(to);
    return to;
  }

  /** Souhlas tečny oblouku se směrem volného úseku (−1…+1). */
  function tangentAlign(wheel, ang, clockwise, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const tAng = clockwise ? ang + Math.PI / 2 : ang - Math.PI / 2;
    return (dx / len) * Math.cos(tAng) + (dy / len) * Math.sin(tAng);
  }

  /**
   * Spočte enter/leave tak, aby volné úseky byly tečné a smysl oblouku
   * seděl (žádné „V“ na styku).
   */
  function solveWrapGeometry(wraps, pts, closed) {
    const n = wraps.length;
    const startPt = pts[0];
    const endPt = pts[pts.length - 1];

    function applyCandidate(cws) {
      const enterAng = new Array(n);
      const leaveAng = new Array(n);
      for (let i = 0; i < n; i += 1) wraps[i].clockwise = cws[i];

      if (!closed) {
        enterAng[0] = tangentFromFreePoint(
          wraps[0].wheel,
          startPt,
          cws[0],
          true
        );
        leaveAng[n - 1] = tangentFromFreePoint(
          wraps[n - 1].wheel,
          endPt,
          cws[n - 1],
          false
        );
      }

      for (let i = 0; i < n - 1; i += 1) {
        const a = wraps[i];
        const b = wraps[i + 1];
        const tang = commonTangentAngles(
          a.wheel,
          cws[i],
          b.wheel,
          cws[i + 1],
          strokeHintAngle(pts, a.end, a.wheel),
          strokeHintAngle(pts, b.start, b.wheel),
          freeSegmentMid(pts, a.end, b.start),
          enterAng[i] ?? null
        );
        leaveAng[i] = tang.a0;
        enterAng[i + 1] = tang.a1;
      }

      if (closed) {
        if (n === 1) {
          const mid = pts[Math.floor(pts.length / 2)];
          enterAng[0] = tangentFromFreePoint(
            wraps[0].wheel,
            mid,
            cws[0],
            true
          );
          leaveAng[0] = enterAng[0];
        } else {
          const a = wraps[n - 1];
          const b = wraps[0];
          const tang = commonTangentAngles(
            a.wheel,
            cws[n - 1],
            b.wheel,
            cws[0],
            strokeHintAngle(pts, a.end, a.wheel),
            strokeHintAngle(pts, b.start, b.wheel),
            freeSegmentMid(pts, a.end, pts.length - 1) ||
              freeSegmentMid(pts, 0, b.start),
            null
          );
          leaveAng[n - 1] = tang.a0;
          enterAng[0] = tang.a1;
        }
      }

      for (let i = 0; i < n; i += 1) {
        if (enterAng[i] == null) {
          enterAng[i] = strokeHintAngle(pts, wraps[i].start, wraps[i].wheel);
        }
        if (leaveAng[i] == null) {
          leaveAng[i] = strokeHintAngle(pts, wraps[i].end, wraps[i].wheel);
        }
      }

      let score = 0;
      for (let i = 0; i < n; i += 1) {
        const w = wraps[i];
        const travel = Math.abs(
          wrapTravelRaw(enterAng[i], leaveAng[i], cws[i])
        );
        if (travel < MIN_WRAP_TRAVEL - 1e-6 || travel > MAX_WRAP_TRAVEL + 1e-6) {
          score -= 5000;
        } else if (travel > Math.PI + 0.15) {
          // Mírně nad půlkruhem je OK (volná kladka), skoro celý závit ne
          score -= (travel - Math.PI) * 8;
        }

        const enterP = pointOnCircle(w.wheel, enterAng[i]);
        const leaveP = pointOnCircle(w.wheel, leaveAng[i]);

        let fromP;
        if (i === 0 && !closed) fromP = startPt;
        else if (i === 0 && closed) fromP = pointOnCircle(wraps[n - 1].wheel, leaveAng[n - 1]);
        else fromP = pointOnCircle(wraps[i - 1].wheel, leaveAng[i - 1]);

        let toP;
        if (i === n - 1 && !closed) toP = endPt;
        else if (i === n - 1 && closed) toP = pointOnCircle(wraps[0].wheel, enterAng[0]);
        else toP = pointOnCircle(wraps[i + 1].wheel, enterAng[i + 1]);

        const aIn = tangentAlign(w.wheel, enterAng[i], cws[i], fromP, enterP);
        const aOut = tangentAlign(w.wheel, leaveAng[i], cws[i], leaveP, toP);
        score += aIn * 40 + aOut * 40;
        if (aIn < 0.2) score -= 80;
        if (aOut < 0.2) score -= 80;

        if (segmentPiercesWheel(fromP, enterP, w.wheel, 8)) score -= 2000;
        if (segmentPiercesWheel(leaveP, toP, w.wheel, 8)) score -= 2000;
        if (segmentCrossesWheel(fromP, enterP, w.wheel, 1)) score -= 4000;
        if (segmentCrossesWheel(leaveP, toP, w.wheel, 1)) score -= 4000;
      }
      return { score, enterAng, leaveAng, cws: cws.slice() };
    }

    // Vyzkoušej kombinace smyslu oblouku (max 2 kladky → 4 varianty)
    const hint = wraps.map((w) => w.clockwise);
    let best = null;
    const limit = Math.min(n, 3);
    const total = 1 << limit;
    for (let mask = 0; mask < total; mask += 1) {
      const cws = hint.slice();
      for (let i = 0; i < limit; i += 1) {
        if (mask & (1 << i)) cws[i] = !hint[i];
      }
      const cand = applyCandidate(cws);
      if (!best || cand.score > best.score) best = cand;
    }

    for (let i = 0; i < n; i += 1) wraps[i].clockwise = best.cws[i];
    repairPiercingFreeSegments(wraps, best.enterAng, best.leaveAng, pts, closed);
    return { enterAng: best.enterAng, leaveAng: best.leaveAng };
  }

  /**
   * Doplň wrapy pro kladky, kterými by volný úsek / tětiva procházela.
   */
  function ensureWrapsAgainstCrossing(pts, wraps) {
    const wheels = collectWheels();
    for (let guard = 0; guard < wheels.length + 2; guard += 1) {
      let added = false;

      // Geometrické volné úseky podle indexů wrapů
      const anchors = [];
      if (!wraps.length) {
        anchors.push({ a: pts[0], b: pts[pts.length - 1], from: 0, to: pts.length - 1 });
      } else {
        anchors.push({
          a: pts[0],
          b: pts[wraps[0].start],
          from: 0,
          to: wraps[0].start,
        });
        for (let i = 0; i < wraps.length - 1; i += 1) {
          anchors.push({
            a: pts[wraps[i].end],
            b: pts[wraps[i + 1].start],
            from: wraps[i].end,
            to: wraps[i + 1].start,
          });
        }
        anchors.push({
          a: pts[wraps[wraps.length - 1].end],
          b: pts[pts.length - 1],
          from: wraps[wraps.length - 1].end,
          to: pts.length - 1,
        });
      }

      for (const wheel of wheels) {
        if (wraps.some((w) => sameWheel(w.wheel, wheel))) continue;

        let hitFrom = 0;
        let hitTo = pts.length - 1;
        let hit = false;

        for (const seg of anchors) {
          if (
            segmentCrossesWheel(seg.a, seg.b, wheel, 1) ||
            segmentTouchesWheel(seg.a, seg.b, wheel, 4)
          ) {
            hit = true;
            hitFrom = seg.from;
            hitTo = seg.to;
            break;
          }
        }

        if (!hit) {
          for (let i = 0; i < pts.length - 1; i += 1) {
            if (
              segmentCrossesWheel(pts[i], pts[i + 1], wheel, 1) ||
              segmentTouchesWheel(pts[i], pts[i + 1], wheel, 4)
            ) {
              hit = true;
              hitFrom = Math.max(0, i - 1);
              hitTo = Math.min(pts.length - 1, i + 2);
              break;
            }
          }
        }

        if (!hit) continue;

        const run =
          findPiercingSpan(pts, wheel, hitFrom, hitTo) || {
            start: hitFrom,
            end: Math.max(hitFrom + 1, hitTo),
          };
        const start = clamp(run.start, 0, pts.length - 1);
        const end = clamp(run.end, 0, pts.length - 1);
        if (end - start < 1) continue;

        added = insertWrapEvent(wraps, {
          start,
          end,
          wheel,
          clockwise: wrapDirection(pts, start, end, wheel) === "cw",
        });
        if (added) break;
      }
      if (!added) break;
    }
    wraps.sort((a, b) => a.start - b.start || a.end - b.end);
    return wraps;
  }

  /**
   * Lepkavé obepnutí — jednou detekovaná kladka zůstane, i když je kurzor už daleko
   * (simplify jinak wrap zahodí a lano „odskočí“).
   */
  function wrapsFromStickyIds(pts, stickyIds) {
    if (!stickyIds || !stickyIds.length) return [];
    const wheels = collectWheels();
    const out = [];
    for (const id of stickyIds) {
      const wheel = wheels.find((w) => w.id === id);
      if (!wheel) continue;
      if (out.some((w) => sameWheel(w.wheel, wheel))) continue;
      const i = out.length;
      out.push({
        start: i * 2,
        end: i * 2 + 1,
        wheel,
        clockwise: true,
      });
    }
    return out;
  }

  function mergeStickyWraps(pts, wraps, stickyIds) {
    if (!stickyIds || !stickyIds.length) return wraps;
    const sticky = wrapsFromStickyIds(pts, stickyIds);
    if (!sticky.length) return wraps;

    // Zachovej pořadí sticky; doplň směr z případné detekce
    for (const s of sticky) {
      const found = wraps.find((w) => sameWheel(w.wheel, s.wheel));
      if (found) s.clockwise = found.clockwise;
    }
    return sticky;
  }

  function buildRopePath(rawPoints, closed = false, stickyIds = null) {
    if (rawPoints.length < 2) return pointsToPolyline(rawPoints);

    // Jemnější simplify — hrubý maže body u druhé kladky a wrap se ztratí
    let pts = simplify(rawPoints, 0.9);
    if (pts.length < 2) pts = rawPoints.slice();

    if (closed && pts.length >= 3) {
      if (dist(pts[0], pts[pts.length - 1]) > 1) {
        pts = pts.concat([{ x: pts[0].x, y: pts[0].y }]);
      } else {
        pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
      }
    }

    let wraps = pickWrapEvents(pts);
    wraps = ensureWrapsAgainstCrossing(pts, wraps);
    // Lepkavé kladky mají přednost — nenech wrap zmizet ve vzdálenosti
    wraps = mergeStickyWraps(pts, wraps, stickyIds);

    if (!wraps.length) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      // Jen skutečný průchod diskem — ne pouhý dotyk v okolí (to by „přilepilo“ lano)
      const hitWheel = collectWheels().find((w) =>
        segmentCrossesWheel(a, b, w, 1)
      );
      if (hitWheel) {
        const cw = wrapDirection(pts, 0, pts.length - 1, hitWheel) === "cw";
        const useCw = resolveArcClockwise(
          tangentFromFreePoint(hitWheel, a, cw, true),
          tangentFromFreePoint(hitWheel, b, cw, false),
          cw
        );
        const e = tangentFromFreePoint(hitWheel, a, useCw, true);
        const l = tangentFromFreePoint(hitWheel, b, useCw, false);
        const arc = svgArc(hitWheel, e, l, useCw);
        const sweep = arc.clockwise ? 1 : 0;
        const large = Math.abs(arc.travel) > Math.PI + 1e-6 ? 1 : 0;
        return (
          `M${a.x.toFixed(2)} ${a.y.toFixed(2)}` +
          `L${arc.start.x.toFixed(2)} ${arc.start.y.toFixed(2)}` +
          `A${hitWheel.r.toFixed(2)} ${hitWheel.r.toFixed(2)} 0 ${large} ${sweep} ${arc.end.x.toFixed(2)} ${arc.end.y.toFixed(2)}` +
          `L${b.x.toFixed(2)} ${b.y.toFixed(2)}`
        );
      }
      if (closed) return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} Z`;
      return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} L${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }

    let geom = solveWrapGeometry(wraps, pts, closed);

    // Po vyřešení: volné úseky nesmí jít skrz cizí kladku
    {
      const allWheels = collectWheels();
      const segs = [];
      if (!closed) {
        segs.push({
          a: pts[0],
          b: pointOnCircle(wraps[0].wheel, geom.enterAng[0]),
        });
        segs.push({
          a: pointOnCircle(
            wraps[wraps.length - 1].wheel,
            geom.leaveAng[wraps.length - 1]
          ),
          b: pts[pts.length - 1],
        });
      }
      for (let i = 0; i < wraps.length - 1; i += 1) {
        segs.push({
          a: pointOnCircle(wraps[i].wheel, geom.leaveAng[i]),
          b: pointOnCircle(wraps[i + 1].wheel, geom.enterAng[i + 1]),
        });
      }
      let needsRetry = false;
      const extraIds = stickyIds ? stickyIds.slice() : [];
      for (const seg of segs) {
        for (const wheel of allWheels) {
          if (!segmentCrossesWheel(seg.a, seg.b, wheel, 1)) continue;
          if (wraps.some((w) => sameWheel(w.wheel, wheel))) continue;
          if (wheel.id && !extraIds.includes(wheel.id)) {
            extraIds.push(wheel.id);
          }
          needsRetry = true;
        }
      }
      if (needsRetry) {
        wraps = mergeStickyWraps(pts, wraps, extraIds);
        geom = solveWrapGeometry(wraps, pts, closed);
      }
    }

    const { enterAng, leaveAng } = geom;

    let d = "";
    let pen = null;

    function lineTo(p) {
      if (!pen) {
        d = `M${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      } else {
        d += `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      }
      pen = p;
    }

    function addArc(wheel, a0, a1, clockwise) {
      const arc = svgArc(wheel, a0, a1, clockwise);
      const cw = arc.clockwise != null ? arc.clockwise : clockwise;
      lineTo(arc.start);
      const large = Math.abs(arc.travel) > Math.PI + 1e-6 ? 1 : 0;
      const sweep = cw ? 1 : 0;
      d += `A${wheel.r.toFixed(2)} ${wheel.r.toFixed(2)} 0 ${large} ${sweep} ${arc.end.x.toFixed(2)} ${arc.end.y.toFixed(2)}`;
      pen = arc.end;
    }

    if (!closed) {
      lineTo(pts[0]);
    }

    for (let i = 0; i < wraps.length; i += 1) {
      const w = wraps[i];
      addArc(w.wheel, enterAng[i], leaveAng[i], w.clockwise);
    }

    if (closed) {
      lineTo(pointOnCircle(wraps[0].wheel, enterAng[0]));
      if (d) d += " Z";
    } else {
      lineTo(pts[pts.length - 1]);
    }

    return d || pointsToPolyline(pts);
  }

  /** Zamrzne geometrii obepnutí — v simulaci se nemění úhly tečen. */
  function computeRopeModel(rope) {
    let pts = simplify(rope.points, 0.9);
    if (pts.length < 2) pts = rope.points.slice();

    let wraps = pickWrapEvents(pts);
    wraps = ensureWrapsAgainstCrossing(pts, wraps);
    wraps = mergeStickyWraps(pts, wraps, rope.wrapIds || rope.wrapKinds || null);

    if (!wraps.length) return { wraps: [], closed: rope.closed };

    const { enterAng, leaveAng } = solveWrapGeometry(wraps, pts, rope.closed);

    const modelWraps = wraps.map((w, i) => ({
      wheelId: w.wheel.id || null,
      wheelKind: w.wheel.kind || "free",
      enterAng: enterAng[i],
      leaveAng: leaveAng[i],
      clockwise: w.clockwise,
      hintEnterAng: enterAng[i],
      hintLeaveAng: leaveAng[i],
    }));

    return { wraps: modelWraps, closed: rope.closed };
  }

  function resolveModelWheel(ref) {
    const wheels = collectWheels();
    if (!ref) return null;
    if (typeof ref === "string") {
      return (
        wheels.find((w) => w.id === ref) ||
        wheels.find((w) => (w.kind || "") === ref) ||
        null
      );
    }
    if (ref.wheelId) {
      const byId = wheels.find((w) => w.id === ref.wheelId);
      if (byId) return byId;
    }
    if (ref.wheelKind) {
      return wheels.find((w) => (w.kind || "") === ref.wheelKind) || null;
    }
    return null;
  }

  /**
   * Live tečny podle aktuálních pozic kladek — volné úseky nesmí jít skrz disk.
   * Drží smysl obepnutí z modelu, ale přepočítá společné tečny.
   */
  function liveWrapGeometry(model, startPt, endPt) {
    const n = model.wraps.length;
    if (!n) return null;

    const wheels = model.wraps.map((w) => resolveModelWheel(w));
    if (wheels.some((w) => !w)) return null;

    function scoreCws(cws) {
      const enterAng = new Array(n);
      const leaveAng = new Array(n);

      if (!model.closed) {
        enterAng[0] = tangentFromFreePoint(wheels[0], startPt, cws[0], true);
        leaveAng[n - 1] = tangentFromFreePoint(
          wheels[n - 1],
          endPt,
          cws[n - 1],
          false
        );
      }

      for (let i = 0; i < n - 1; i += 1) {
        const tang = commonTangentAngles(
          wheels[i],
          cws[i],
          wheels[i + 1],
          cws[i + 1],
          model.wraps[i].hintLeaveAng ?? null,
          model.wraps[i + 1].hintEnterAng ?? null,
          null,
          enterAng[i] ?? null
        );
        leaveAng[i] = tang.a0;
        enterAng[i + 1] = tang.a1;
      }

      if (model.closed) {
        if (n === 1) {
          enterAng[0] = model.wraps[0].enterAng;
          leaveAng[0] = enterAng[0];
        } else {
          const tang = commonTangentAngles(
            wheels[n - 1],
            cws[n - 1],
            wheels[0],
            cws[0],
            model.wraps[n - 1].hintLeaveAng ?? null,
            model.wraps[0].hintEnterAng ?? null,
            null,
            null
          );
          leaveAng[n - 1] = tang.a0;
          enterAng[0] = tang.a1;
        }
      }

      let score = 0;
      for (let i = 0; i < n; i += 1) {
        // Drž původní smysl obepnutí — jinak lano „odskočí“ na druhou stranu
        if (cws[i] === hint[i]) score += 800;

        const travel = Math.abs(
          wrapTravelRaw(enterAng[i], leaveAng[i], cws[i])
        );
        if (travel < MIN_WRAP_TRAVEL - 1e-6 || travel > MAX_WRAP_TRAVEL + 1e-6) {
          score -= 5000;
        }

        const enterP = pointOnCircle(wheels[i], enterAng[i]);
        const leaveP = pointOnCircle(wheels[i], leaveAng[i]);
        let fromP =
          i === 0 && !model.closed
            ? startPt
            : pointOnCircle(wheels[i === 0 ? n - 1 : i - 1], leaveAng[i === 0 ? n - 1 : i - 1]);
        let toP =
          i === n - 1 && !model.closed
            ? endPt
            : pointOnCircle(wheels[i === n - 1 ? 0 : i + 1], enterAng[i === n - 1 ? 0 : i + 1]);

        if (i === 0 && model.closed) {
          fromP = pointOnCircle(wheels[n - 1], leaveAng[n - 1]);
        }
        if (i === n - 1 && model.closed) {
          toP = pointOnCircle(wheels[0], enterAng[0]);
        }

        score += tangentAlign(wheels[i], enterAng[i], cws[i], fromP, enterP) * 40;
        score += tangentAlign(wheels[i], leaveAng[i], cws[i], leaveP, toP) * 40;

        if (segmentCrossesWheel(fromP, enterP, wheels[i], 1)) score -= 5000;
        if (segmentCrossesWheel(leaveP, toP, wheels[i], 1)) score -= 5000;

        // Volný úsek nesmí procházet ani cizí kladkou
        for (let j = 0; j < n; j += 1) {
          if (j === i) continue;
          if (segmentCrossesWheel(fromP, enterP, wheels[j], 1)) score -= 5000;
          if (segmentCrossesWheel(leaveP, toP, wheels[j], 1)) score -= 5000;
        }
      }

      // Mezi kladkami
      for (let i = 0; i < n - 1; i += 1) {
        const p0 = pointOnCircle(wheels[i], leaveAng[i]);
        const p1 = pointOnCircle(wheels[i + 1], enterAng[i + 1]);
        for (const wheel of wheels) {
          if (segmentCrossesWheel(p0, p1, wheel, 1)) score -= 5000;
        }
      }

      return { score, enterAng, leaveAng, cws: cws.slice(), wheels };
    }

    const hint = model.wraps.map((w) => w.clockwise);
    let best = null;
    const limit = Math.min(n, 3);
    const total = 1 << limit;
    for (let mask = 0; mask < total; mask += 1) {
      const cws = hint.slice();
      for (let i = 0; i < limit; i += 1) {
        if (mask & (1 << i)) cws[i] = !hint[i];
      }
      const cand = scoreCws(cws);
      if (!best || cand.score > best.score) best = cand;
    }
    return best;
  }

  function wrapAnglesAtEndpoints(model, startPt, endPt, w, wheel, index, count) {
    const live = liveWrapGeometry(model, startPt, endPt);
    if (live) {
      return {
        enterAng: live.enterAng[index],
        leaveAng: live.leaveAng[index],
        clockwise: live.cws[index],
      };
    }

    let enterAng = w.enterAng;
    let leaveAng = w.leaveAng;
    let cw = w.clockwise;

    if (count > 1) {
      if (!model.closed) {
        if (index === 0) {
          enterAng = tangentFromFreePoint(wheel, startPt, cw, true);
        }
        if (index === count - 1) {
          leaveAng = tangentFromFreePoint(wheel, endPt, cw, false);
        }
      }
      return { enterAng, leaveAng, clockwise: cw };
    }

    function tryCw(useCw) {
      const e = tangentFromFreePoint(wheel, startPt, useCw, true);
      const l = tangentFromFreePoint(wheel, endPt, useCw, false);
      const enterP = pointOnCircle(wheel, e);
      const leaveP = pointOnCircle(wheel, l);
      let score = 0;
      const travel = Math.abs(wrapTravelRaw(e, l, useCw));
      if (travel < MIN_WRAP_TRAVEL - 1e-6 || travel > MAX_WRAP_TRAVEL + 1e-6) {
        score -= 5000;
      }
      score += tangentAlign(wheel, e, useCw, startPt, enterP) * 50;
      score += tangentAlign(wheel, l, useCw, leaveP, endPt) * 50;
      if (segmentCrossesWheel(startPt, enterP, wheel, 1)) score -= 4000;
      if (segmentCrossesWheel(leaveP, endPt, wheel, 1)) score -= 4000;
      return { score, enterAng: e, leaveAng: l, clockwise: useCw };
    }

    if (model.closed) {
      return { enterAng, leaveAng, clockwise: cw };
    }
    const a = tryCw(cw);
    const b = tryCw(!cw);
    return b.score > a.score + 0.05 ? b : a;
  }

  function measureModelLength(model, startPt, endPt) {
    if (!model.wraps.length) {
      return dist(startPt, endPt);
    }
    let len = 0;
    let prev = startPt;
    const count = model.wraps.length;
    for (let i = 0; i < count; i += 1) {
      const w = model.wraps[i];
      const wheel = resolveModelWheel(w);
      if (!wheel) continue;
      const { enterAng, leaveAng, clockwise } = wrapAnglesAtEndpoints(
        model,
        startPt,
        endPt,
        w,
        wheel,
        i,
        count
      );
      const arcStart = pointOnCircle(wheel, enterAng);
      const arcEnd = pointOnCircle(wheel, leaveAng);
      len += dist(prev, arcStart);
      len += Math.abs(travelFor(enterAng, leaveAng, clockwise)) * wheel.r;
      prev = arcEnd;
    }
    len += dist(prev, endPt);
    return len;
  }

  function modelTangentPoints(model, startPt, endPt) {
    if (!model.wraps.length) return null;
    const first = model.wraps[0];
    const last = model.wraps[model.wraps.length - 1];
    const w0 = resolveModelWheel(first);
    const w1 = resolveModelWheel(last);
    if (!w0 || !w1) return null;
    const count = model.wraps.length;
    const firstAng = wrapAnglesAtEndpoints(
      model,
      startPt,
      endPt,
      first,
      w0,
      0,
      count
    );
    const lastAng = wrapAnglesAtEndpoints(
      model,
      startPt,
      endPt,
      last,
      w1,
      count - 1,
      count
    );
    return {
      start: pointOnCircle(w0, firstAng.enterAng),
      end: pointOnCircle(w1, lastAng.leaveAng),
    };
  }

  function buildRopeFromModel(model, startPt, endPt) {
    if (!model.wraps.length) {
      return `M${startPt.x.toFixed(2)} ${startPt.y.toFixed(2)} L${endPt.x.toFixed(2)} ${endPt.y.toFixed(2)}`;
    }

    let d = "";
    let pen = null;

    function lineTo(p) {
      if (!pen) d = `M${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      else d += `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      pen = p;
    }

    function addArc(wheel, a0, a1, clockwise) {
      const arc = svgArc(wheel, a0, a1, clockwise);
      const cw = arc.clockwise != null ? arc.clockwise : clockwise;
      lineTo(arc.start);
      const large = Math.abs(arc.travel) > Math.PI + 1e-6 ? 1 : 0;
      const sweep = cw ? 1 : 0;
      d += `A${wheel.r.toFixed(2)} ${wheel.r.toFixed(2)} 0 ${large} ${sweep} ${arc.end.x.toFixed(2)} ${arc.end.y.toFixed(2)}`;
      pen = arc.end;
    }

    if (!model.closed) lineTo(startPt);

    const count = model.wraps.length;
    for (let i = 0; i < count; i += 1) {
      const w = model.wraps[i];
      const wheel = resolveModelWheel(w);
      if (!wheel) continue;
      const { enterAng, leaveAng, clockwise } = wrapAnglesAtEndpoints(
        model,
        startPt,
        endPt,
        w,
        wheel,
        i,
        count
      );
      addArc(wheel, enterAng, leaveAng, clockwise);
    }

    if (model.closed) {
      const w0 = resolveModelWheel(model.wraps[0]);
      if (w0) lineTo(pointOnCircle(w0, model.wraps[0].enterAng));
      if (d) d += " Z";
    } else {
      lineTo(endPt);
    }

    return d;
  }

  function moveToward(from, to, amount) {
    const d = dist(from, to);
    if (d < 1e-6) return { x: from.x, y: from.y };
    const t = Math.min(amount / d, 1);
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  }

  function enforceRopeLength(model, startPt, endPt, restLength) {
    let s = { x: startPt.x, y: startPt.y };
    let e = { x: endPt.x, y: endPt.y };

    for (let i = 0; i < 10; i += 1) {
      const L = measureModelLength(model, s, e);
      if (L <= restLength + 0.5) break;
      const excess = L - restLength;
      const tang = modelTangentPoints(model, s, e);
      if (!tang) break;
      const legA = dist(s, tang.start);
      const legB = dist(tang.end, e);
      const total = legA + legB + 1e-6;
      s = moveToward(s, tang.start, excess * (legA / total));
      e = moveToward(e, tang.end, excess * (legB / total));
    }

    return { start: s, end: e };
  }

  /** Posun volné kladky bez rebuildAllRopes (pro constraint během integrace). */
  function nudgeFreePulley(pulley, dx, dy) {
    const el = pulley?.el;
    if (!el || isDocked(el)) return;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
    const { width, height } = stageSize();
    const maxLeft = Math.max(0, width - el.offsetWidth);
    const maxTop = Math.max(0, height - el.offsetHeight);
    el.style.left = `${clamp((parseFloat(el.style.left) || 0) + dx, 0, maxLeft)}px`;
    el.style.top = `${clamp((parseFloat(el.style.top) || 0) + dy, 0, maxTop)}px`;
  }

  /**
   * Když jsou oba konce lana pevné (naviják / okraj), enforceRopeLength
   * nemůže nic zkrátit — musí se posunout volná kladka po gradientu délky.
   */
  function enforceRopeLengthViaFreePulley(
    model,
    startPt,
    endPt,
    restLength,
    freePulley
  ) {
    if (!freePulley?.el || isDocked(freePulley.el)) return;
    const el = freePulley.el;
    const eps = 1.5;
    for (let i = 0; i < 10; i += 1) {
      const L = measureModelLength(model, startPt, endPt);
      if (L <= restLength + 0.5) break;
      const excess = L - restLength;
      const left0 = parseFloat(el.style.left) || 0;
      const top0 = parseFloat(el.style.top) || 0;
      el.style.left = `${left0 + eps}px`;
      const dLx = (measureModelLength(model, startPt, endPt) - L) / eps;
      el.style.left = `${left0}px`;
      el.style.top = `${top0 + eps}px`;
      const dLy = (measureModelLength(model, startPt, endPt) - L) / eps;
      el.style.top = `${top0}px`;
      const g2 = dLx * dLx + dLy * dLy;
      if (g2 < 1e-8) break;
      nudgeFreePulley(freePulley, dLx * (-excess / g2), dLy * (-excess / g2));
    }
  }

  function initRopeSimulation() {
    for (const rope of ropes) {
      if (rope.closed || !rope.el.isConnected) {
        delete rope.sim;
        continue;
      }
      const model = computeRopeModel(rope);
      if (!model.wraps.length) {
        delete rope.sim;
        continue;
      }
      const startPt = { ...getRopeSimEndpoint(rope, "start") };
      const endPt = { ...getRopeSimEndpoint(rope, "end") };
      const restLength = measureModelLength(model, startPt, endPt);
      rope.sim = {
        model,
        startPt,
        endPt,
        restLength,
      };
      rope.el.setAttribute("d", buildRopeFromModel(model, startPt, endPt));
    }
  }

  function clearRopeSimulation() {
    for (const rope of ropes) delete rope.sim;
  }

  function weightOnRopeEnd(rope, which) {
    return weights.find(
      (w) =>
        w.snap.type === "rope" &&
        w.snap.rope === rope &&
        w.snap.which === which
    );
  }

  /** Aktuální simulační bod konce lana — háček závaží, naviják, okraj nebo tah. */
  function getRopeSimEndpoint(rope, which) {
    const w = weightOnRopeEnd(rope, which);
    if (w) return getWeightHookWorld(w);
    const winch = winchOnRopeEnd(rope, which);
    if (winch) return getWinchHookWorld(winch);
    return getRopeEndPoint(rope, which);
  }

  function applyRopeSimEndpoints(rope, startPt, endPt) {
    const { model, restLength } = rope.sim;
    const { height } = stageSize();
    const floorY = height - 8;

    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const startWinch = winchOnRopeEnd(rope, "start");
    const endWinch = winchOnRopeEnd(rope, "end");
    const offS = startW ? getWeightHookOffset(startW) : { x: 0, y: 0 };
    const offE = endW ? getWeightHookOffset(endW) : { x: 0, y: 0 };

    const corrected = enforceRopeLength(model, startPt, endPt, restLength);

    if (startWinch) {
      corrected.start = getWinchHookWorld(startWinch);
    } else if (isRopeEndOnEdge(rope, "start") && !startW) {
      corrected.start = getRopeEndPoint(rope, "start");
    }
    if (endWinch) {
      corrected.end = getWinchHookWorld(endWinch);
    } else if (isRopeEndOnEdge(rope, "end") && !endW) {
      corrected.end = getRopeEndPoint(rope, "end");
    }

    rope.sim.startPt = { ...corrected.start };
    rope.sim.endPt = { ...corrected.end };

    if (startW) {
      placeWeightAtHook(startW, {
        x: corrected.start.x,
        y: Math.min(corrected.start.y, floorY - offS.y),
      });
      rope.points[0] = { ...corrected.start };
    } else if (startWinch) {
      rope.points[0] = { ...corrected.start };
    } else if (isRopeEndOnEdge(rope, "start")) {
      syncRopeEdgePoint(rope, "start");
    } else {
      rope.points[0] = { ...corrected.start };
    }

    if (endW) {
      placeWeightAtHook(endW, {
        x: corrected.end.x,
        y: Math.min(corrected.end.y, floorY - offE.y),
      });
      rope.points[rope.points.length - 1] = { ...corrected.end };
    } else if (endWinch) {
      rope.points[rope.points.length - 1] = { ...corrected.end };
    } else if (isRopeEndOnEdge(rope, "end")) {
      syncRopeEdgePoint(rope, "end");
    } else {
      rope.points[rope.points.length - 1] = { ...corrected.end };
    }

    rope.el.setAttribute(
      "d",
      buildRopeFromModel(model, rope.sim.startPt, rope.sim.endPt)
    );
  }

  function settleTargetForRope(rope) {
    const { model, restLength } = rope.sim;

    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const startWinch = winchOnRopeEnd(rope, "start");
    const endWinch = winchOnRopeEnd(rope, "end");
    const startEdge = isRopeEndOnEdge(rope, "start") && !startW && !startWinch;
    const endEdge = isRopeEndOnEdge(rope, "end") && !endW && !endWinch;

    let startPt = startWinch
      ? getWinchHookWorld(startWinch)
      : startEdge
        ? getRopeEndPoint(rope, "start")
        : startW
          ? getWeightHookWorld(startW)
          : { ...rope.sim.startPt };
    let endPt = endWinch
      ? getWinchHookWorld(endWinch)
      : endEdge
        ? getRopeEndPoint(rope, "end")
        : endW
          ? getWeightHookWorld(endW)
          : { ...rope.sim.endPt };

    const corrected = enforceRopeLength(model, startPt, endPt, restLength);

    if (startWinch) corrected.start = getWinchHookWorld(startWinch);
    else if (startEdge) corrected.start = getRopeEndPoint(rope, "start");
    else if (startW) corrected.start = getWeightHookWorld(startW);
    if (endWinch) corrected.end = getWinchHookWorld(endWinch);
    else if (endEdge) corrected.end = getRopeEndPoint(rope, "end");
    else if (endW) corrected.end = getWeightHookWorld(endW);
    return corrected;
  }

  function startSettling() {
    settling = true;
    settleStartTime = performance.now();
    for (const rope of ropes) {
      if (!rope.sim) continue;
      rope.sim.settleFrom = {
        start: { ...rope.sim.startPt },
        end: { ...rope.sim.endPt },
      };
      rope.sim.settleTo = settleTargetForRope(rope);
    }
    syncAllWeightsToSnap();
  }

  function updateSettling(now) {
    const t = Math.min((now - settleStartTime) / SETTLE_MS, 1);
    const ease = 1 - Math.pow(1 - t, 3);

    for (const rope of ropes) {
      if (!rope.sim?.settleFrom || !rope.sim?.settleTo) continue;
      const from = rope.sim.settleFrom;
      const to = rope.sim.settleTo;
      applyRopeSimEndpoints(rope, {
        x: from.start.x + (to.start.x - from.start.x) * ease,
        y: from.start.y + (to.start.y - from.start.y) * ease,
      }, {
        x: from.end.x + (to.end.x - from.end.x) * ease,
        y: from.end.y + (to.end.y - from.end.y) * ease,
      });
    }
    updateForceArrows();

    if (t >= 1) {
      settling = false;
      lastPhysicsTime = performance.now();
      for (const rope of ropes) {
        if (!rope.sim) continue;
        applyRopeSimEndpoints(rope, rope.sim.settleTo.start, rope.sim.settleTo.end);
        delete rope.sim.settleFrom;
        delete rope.sim.settleTo;
      }
      syncAllWeightsToSnap();
      for (const weight of weights) weight.vel = { x: 0, y: 0 };
      updateForceArrows();
    }
  }

  function unitVec(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-8) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  /** Směry napětí v laně u konců a u volné kladky (bez změny obepnutí). */
  function getRopeAttachmentVectors(model, startPt, endPt) {
    const count = model.wraps.length;
    const chain = [startPt];

    for (let i = 0; i < count; i += 1) {
      const w = model.wraps[i];
      const wheel = resolveModelWheel(w);
      const { enterAng, leaveAng } = wrapAnglesAtEndpoints(
        model,
        startPt,
        endPt,
        w,
        wheel,
        i,
        count
      );
      chain.push(
        pointOnCircle(wheel, enterAng),
        pointOnCircle(wheel, leaveAng)
      );
    }
    chain.push(endPt);

    const startU = unitVec(chain[0], chain[1]);
    const endU = unitVec(chain[chain.length - 1], chain[chain.length - 2]);

    let freeEnterU = { x: 0, y: 0 };
    let freeLeaveU = { x: 0, y: 0 };

    for (let i = 0; i < count; i += 1) {
      if (model.wraps[i].wheelKind !== "free") continue;
      const prev = chain[i * 2];
      const enter = chain[i * 2 + 1];
      const leave = chain[i * 2 + 2];
      const next = chain[i * 2 + 3];
      freeEnterU = unitVec(prev, enter);
      freeLeaveU = unitVec(leave, next);
      break;
    }

    return { startU, endU, freeEnterU, freeLeaveU };
  }

  function vecDot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function numericalLengthGradient(model, startPt, endPt, opts) {
    const eps = 1.5;
    const base = measureModelLength(model, startPt, endPt);
    const grad = {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      pulley: { x: 0, y: 0 },
    };

    if (opts.startFree) {
      grad.start.x =
        (measureModelLength(model, { x: startPt.x + eps, y: startPt.y }, endPt) -
          base) /
        eps;
      grad.start.y =
        (measureModelLength(model, { x: startPt.x, y: startPt.y + eps }, endPt) -
          base) /
        eps;
    }
    if (opts.endFree) {
      grad.end.x =
        (measureModelLength(model, startPt, { x: endPt.x + eps, y: endPt.y }) -
          base) /
        eps;
      grad.end.y =
        (measureModelLength(model, startPt, { x: endPt.x, y: endPt.y + eps }) -
          base) /
        eps;
    }
    if (opts.pulleyFree && opts.pulleyEl) {
      const el = opts.pulleyEl;
      const left0 = parseFloat(el.style.left) || 0;
      const top0 = parseFloat(el.style.top) || 0;
      el.style.left = `${left0 + eps}px`;
      const movedX = measureModelLength(model, startPt, endPt);
      el.style.left = `${left0}px`;
      el.style.top = `${top0 + eps}px`;
      const movedY = measureModelLength(model, startPt, endPt);
      el.style.top = `${top0}px`;
      grad.pulley.x = (movedX - base) / eps;
      grad.pulley.y = (movedY - base) / eps;
    }

    return grad;
  }

  /**
   * Síla lana na volnou kladku: napětí táhne kladku podél volných úseků
   * (od tečného bodu směrem pryč od kola).
   */
  function freePulleyRopeForceUnit(attach) {
    return {
      x: -attach.freeEnterU.x + attach.freeLeaveU.x,
      y: -attach.freeEnterU.y + attach.freeLeaveU.y,
    };
  }

  /** Počet závaží zavěšených pod daným (včetně něj) — hang řetězec. */
  function countHangingWeights(root) {
    if (!root?.el?.isConnected) return 0;
    let count = 1;
    for (const w of weights) {
      if (
        w !== root &&
        w.snap.type === "weight" &&
        w.snap.weight === root &&
        w.snap.placement === "hang"
      ) {
        count += countHangingWeights(w);
      }
    }
    return count;
  }

  function massOfWeightStack(weight) {
    return countHangingWeights(weight) * WEIGHT_MASS;
  }

  function freePulleyMass(pulleyEl) {
    const rodW = weights.find(
      (w) => w.snap.type === "rod" && (!pulleyEl || w.snap.pulley === pulleyEl)
    );
    if (!rodW) return PULLEY_MASS;
    return PULLEY_MASS + massOfWeightStack(rodW);
  }

  function getRopeFreePulley(rope, model) {
    const wraps = model?.wraps || [];
    const freeWrap = wraps.find((w) => w.wheelKind === "free");
    if (freeWrap) {
      const wheel = resolveModelWheel(freeWrap);
      if (wheel?.el) return findPulleyByEl(wheel.el);
      if (freeWrap.wheelId) return findPulleyById(freeWrap.wheelId);
    }
    if (rope?.wrapIds) {
      for (const id of rope.wrapIds) {
        const p = findPulleyById(id);
        if (p && p.kind === "free" && !isDocked(p.el)) return p;
      }
    }
    return null;
  }

  /**
   * Napětí v laně T a zrychlení volných těles z podmínky konstantní délky lana.
   * Závaží = hmotné body. Modrá kladka má zanedbatelnou hmotnost (+ všechna závaží na tyči).
   */
  function computeRopeDynamics(rope, model, startPt, endPt) {
    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const freePulley = getRopeFreePulley(rope, model);
    const hasFree = !!freePulley || ropeWrapsFreeWheel(rope);
    const pulleyEl = freePulley?.el || null;
    const rodW = weights.find(
      (w) => w.snap.type === "rod" && (!pulleyEl || w.snap.pulley === pulleyEl)
    );
    const startMass = startW ? massOfWeightStack(startW) : 0;
    const endMass = endW ? massOfWeightStack(endW) : 0;
    const pulleyMass = freePulleyMass(pulleyEl);

    const attach = getRopeAttachmentVectors(model, startPt, endPt);
    const pulleyU = freePulleyRopeForceUnit(attach);
    const grad = numericalLengthGradient(model, startPt, endPt, {
      startFree: !!startW,
      endFree: !!endW,
      pulleyFree: hasFree && pulleyMass > 1e-8,
      pulleyEl,
    });

    let numerator = 0;
    let denominator = 0;

    if (startW && startMass > 1e-8) {
      const Fg = { x: 0, y: startMass * GRAVITY };
      numerator += vecDot(grad.start, Fg) / startMass;
      denominator += vecDot(grad.start, attach.startU) / startMass;
    }
    if (endW && endMass > 1e-8) {
      const Fg = { x: 0, y: endMass * GRAVITY };
      numerator += vecDot(grad.end, Fg) / endMass;
      denominator += vecDot(grad.end, attach.endU) / endMass;
    }
    if (hasFree && pulleyMass > 1e-8) {
      const Fg = { x: 0, y: pulleyMass * GRAVITY };
      numerator += vecDot(grad.pulley, Fg) / pulleyMass;
      denominator += vecDot(grad.pulley, pulleyU) / pulleyMass;
    }

    let tension = 0;
    if (Math.abs(denominator) > 1e-8) {
      tension = -numerator / denominator;
      if (tension < 0) tension = 0;
    }

    const accel = {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      pulley: { x: 0, y: 0 },
    };
    const netForce = {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      pulley: { x: 0, y: 0 },
    };

    if (startW && startMass > 1e-8) {
      netForce.start = {
        x: tension * attach.startU.x,
        y: startMass * GRAVITY + tension * attach.startU.y,
      };
      accel.start = {
        x: netForce.start.x / startMass,
        y: netForce.start.y / startMass,
      };
    }
    if (endW && endMass > 1e-8) {
      netForce.end = {
        x: tension * attach.endU.x,
        y: endMass * GRAVITY + tension * attach.endU.y,
      };
      accel.end = {
        x: netForce.end.x / endMass,
        y: netForce.end.y / endMass,
      };
    }
    if (hasFree) {
      netForce.pulley = {
        x: tension * pulleyU.x,
        y: pulleyMass * GRAVITY + tension * pulleyU.y,
      };
      if (pulleyMass > 1e-8) {
        accel.pulley = {
          x: netForce.pulley.x / pulleyMass,
          y: netForce.pulley.y / pulleyMass,
        };
      }
    }

    return {
      tension,
      accel,
      netForce,
      attach,
      pulleyMass,
      pulleyU,
      rodW,
      startMass,
      endMass,
      freePulley,
    };
  }

  /** Stav lana pro výpočet sil — i mimo simulaci. */
  function getRopeForceState(rope) {
    if (!rope?.el?.isConnected || rope.closed) return null;
    if (rope.sim?.model?.wraps?.length) {
      return {
        model: rope.sim.model,
        startPt: { ...rope.sim.startPt },
        endPt: { ...rope.sim.endPt },
      };
    }
    syncRopeEdgePoints(rope);
    const model = computeRopeModel(rope);
    if (!model.wraps.length) return null;
    return {
      model,
      startPt: { ...getRopeSimEndpoint(rope, "start") },
      endPt: { ...getRopeSimEndpoint(rope, "end") },
    };
  }

  function ensureForceLayer() {
    if (forceLayer && forceLayer.isConnected) return forceLayer;
    let overlay = document.getElementById("force-overlay");
    if (!overlay) {
      overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      overlay.setAttribute("id", "force-overlay");
      overlay.setAttribute("aria-hidden", "true");
      stage.appendChild(overlay);
    }
    forceLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    forceLayer.setAttribute("id", "force-layer");
    overlay.appendChild(forceLayer);
    syncForceOverlay();
    return forceLayer;
  }

  function syncForceOverlay() {
    const overlay = document.getElementById("force-overlay");
    if (!overlay) return;
    const { width, height } = stageSize();
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    overlay.setAttribute("width", String(width));
    overlay.setAttribute("height", String(height));
  }

  function clearForceArrows() {
    if (forceLayer) forceLayer.replaceChildren();
  }

  function scaleForceArrow(fx, fy) {
    const mag = Math.hypot(fx, fy);
    if (mag < 1e-6) return null;
    // Délka podle násobku tíhy jednoho závaží — stack 2×/3× se vizuálně prodlouží
    const unit = WEIGHT_MASS * GRAVITY;
    const len = clamp(
      (mag / unit) * FORCE_ARROW_UNIT_LEN,
      FORCE_ARROW_MIN,
      FORCE_ARROW_MAX
    );
    return {
      x: (fx / mag) * len,
      y: (fy / mag) * len,
      mag,
    };
  }

  function drawForceArrow(origin, fx, fy, kind) {
    const scaled = scaleForceArrow(fx, fy);
    if (!scaled) return;
    const layer = ensureForceLayer();
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("force-arrow", `is-${kind}`);

    const x2 = origin.x + scaled.x;
    const y2 = origin.y + scaled.y;
    const ang = Math.atan2(scaled.y, scaled.x);
    const head = 14;
    const hx1 = x2 - head * Math.cos(ang - 0.42);
    const hy1 = y2 - head * Math.sin(ang - 0.42);
    const hx2 = x2 - head * Math.cos(ang + 0.42);
    const hy2 = y2 - head * Math.sin(ang + 0.42);

    // Zkrať dřík, ať špička nepřesahuje cílový bod
    const tipBack = 5;
    const shaftX2 = x2 - Math.cos(ang) * tipBack;
    const shaftY2 = y2 - Math.sin(ang) * tipBack;

    const shaft = document.createElementNS("http://www.w3.org/2000/svg", "line");
    shaft.classList.add("force-arrow-shaft");
    shaft.setAttribute("x1", origin.x.toFixed(1));
    shaft.setAttribute("y1", origin.y.toFixed(1));
    shaft.setAttribute("x2", shaftX2.toFixed(1));
    shaft.setAttribute("y2", shaftY2.toFixed(1));
    g.appendChild(shaft);

    const headEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    headEl.classList.add("force-arrow-head");
    headEl.setAttribute(
      "points",
      `${x2.toFixed(1)},${y2.toFixed(1)} ${hx1.toFixed(1)},${hy1.toFixed(1)} ${hx2.toFixed(1)},${hy2.toFixed(1)}`
    );
    g.appendChild(headEl);

    layer.appendChild(g);
  }

  function syncForcesToggleUi() {
    if (!btnForces) return;
    btnForces.classList.toggle("is-active", showForces);
    btnForces.setAttribute("aria-pressed", String(showForces));
  }

  function setShowForces(next) {
    showForces = !!next;
    syncForcesToggleUi();
    updateForceArrows();
  }

  function updateForceArrows() {
    clearForceArrows();
    syncForceOverlay();
    if (!showForces) return;

    for (const rope of ropes) {
      const state = getRopeForceState(rope);
      if (!state) continue;
      const { model, startPt, endPt } = state;
      const dyn = computeRopeDynamics(rope, model, startPt, endPt);
      const T = dyn.tension;
      const startW = weightOnRopeEnd(rope, "start");
      const endW = weightOnRopeEnd(rope, "end");
      const hasFree = !!dyn.freePulley || ropeWrapsFreeWheel(rope);
      const rodW = dyn.rodW;

      if (startW) {
        const origin = getWeightHookWorld(startW);
        const gx = 0;
        const gy = dyn.startMass * GRAVITY;
        const tx = T * dyn.attach.startU.x;
        const ty = T * dyn.attach.startU.y;
        drawForceArrow(origin, gx, gy, "gravity");
        drawForceArrow(origin, tx, ty, "tension");
        drawForceArrow(origin, gx + tx, gy + ty, "net");
      }

      if (endW) {
        const origin = getWeightHookWorld(endW);
        const gx = 0;
        const gy = dyn.endMass * GRAVITY;
        const tx = T * dyn.attach.endU.x;
        const ty = T * dyn.attach.endU.y;
        drawForceArrow(origin, gx, gy, "gravity");
        drawForceArrow(origin, tx, ty, "tension");
        drawForceArrow(origin, gx + tx, gy + ty, "net");
      }

      if (hasFree && dyn.freePulley) {
        const wheel = getWheelWorld(dyn.freePulley.el, "free");
        if (!wheel) continue;
        const origin = { x: wheel.cx, y: wheel.cy };
        const gx = 0;
        const gy = dyn.pulleyMass * GRAVITY;
        const t1x = T * -dyn.attach.freeEnterU.x;
        const t1y = T * -dyn.attach.freeEnterU.y;
        const t2x = T * dyn.attach.freeLeaveU.x;
        const t2y = T * dyn.attach.freeLeaveU.y;
        if (dyn.pulleyMass > 1e-8) {
          drawForceArrow(origin, gx, gy, "gravity");
        }
        drawForceArrow(origin, t1x, t1y, "tension");
        drawForceArrow(origin, t2x, t2y, "tension");
        drawForceArrow(
          origin,
          gx + t1x + t2x,
          gy + t1y + t2y,
          "net"
        );

        if (rodW) {
          const hook = getWeightHookWorld(rodW);
          drawForceArrow(hook, gx, gy, "gravity");
          drawForceArrow(
            hook,
            gx + t1x + t2x,
            gy + t1y + t2y,
            "net"
          );
        }
      }

      // Síla navijáku (max 150 N) — směr do bubnu, velikost min(T, Fmax)
      for (const which of ["start", "end"]) {
        const winch = winchOnRopeEnd(rope, which);
        if (!winch) continue;
        const origin = getWinchHookWorld(winch);
        const u =
          which === "start" ? dyn.attach.startU : dyn.attach.endU;
        const f = Math.min(T, WINCH_MAX_FORCE);
        // Napětí táhne konec směrem u; naviják drží opačně (do bubnu)
        drawForceArrow(origin, -u.x * f, -u.y * f, "winch");
      }
    }
  }

  function integrateRopePhysics(rope, dt) {
    if (!rope.sim || rope.closed || !rope.el.isConnected) return;

    const { model, restLength } = rope.sim;
    const { height, width } = stageSize();
    const floorY = height - 8;

    let startPt = { ...rope.sim.startPt };
    let endPt = { ...rope.sim.endPt };

    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const startWinch = winchOnRopeEnd(rope, "start");
    const endWinch = winchOnRopeEnd(rope, "end");
    const freePulley = getRopeFreePulley(rope, model);
    const hasFree = !!freePulley;
    const pulleyEl = freePulley?.el || null;
    const rodW = weights.find(
      (w) => w.snap.type === "rod" && (!pulleyEl || w.snap.pulley === pulleyEl)
    );

    if (startWinch) startPt = getWinchHookWorld(startWinch);
    if (endWinch) endPt = getWinchHookWorld(endWinch);

    const { tension, accel } = computeRopeDynamics(
      rope,
      rope.sim.model,
      startPt,
      endPt
    );
    rope.sim.tension = tension;

    // Navíjení: zkracuj lano, dokud napětí nepřekročí max. sílu navijáku (150 N).
    const activeWinch = startWinch || endWinch;
    if (activeWinch) {
      const canReel = tension < WINCH_MAX_FORCE - 1e-6;
      setWinchWinding(activeWinch, canReel);
      if (canReel) {
        const minLen = 40;
        rope.sim.restLength = Math.max(
          minLen,
          rope.sim.restLength - WINCH_REEL_SPEED * dt
        );
      }
    } else {
      if (startWinch) setWinchWinding(startWinch, false);
      if (endWinch) setWinchWinding(endWinch, false);
    }

    // Bez setrvačnosti: rychlost = aktuální zrychlení ze sil (neakumuluje se)
    if (startW) {
      startW.vel.x = accel.start.x;
      startW.vel.y = accel.start.y;
      startPt.x += startW.vel.x * dt;
      startPt.y += startW.vel.y * dt;
    } else if (startWinch) {
      startPt = getWinchHookWorld(startWinch);
    } else if (isRopeEndOnEdge(rope, "start")) {
      startPt = getRopeEndPoint(rope, "start");
    }

    if (endW) {
      endW.vel.x = accel.end.x;
      endW.vel.y = accel.end.y;
      endPt.x += endW.vel.x * dt;
      endPt.y += endW.vel.y * dt;
    } else if (endWinch) {
      endPt = getWinchHookWorld(endWinch);
    } else if (isRopeEndOnEdge(rope, "end")) {
      endPt = getRopeEndPoint(rope, "end");
    }

    const offS = startW ? getWeightHookOffset(startW) : { x: 0, y: 0 };
    const offE = endW ? getWeightHookOffset(endW) : { x: 0, y: 0 };
    startPt.x = clamp(
      startPt.x,
      offS.x,
      width - (startW?.el.offsetWidth || 70) + offS.x
    );
    startPt.y = Math.min(startPt.y, floorY);
    endPt.x = clamp(
      endPt.x,
      offE.x,
      width - (endW?.el.offsetWidth || 70) + offE.x
    );
    endPt.y = Math.min(endPt.y, floorY);

    if (hasFree && freePulley) {
      freePulley.vel.x = accel.pulley.x;
      freePulley.vel.y = accel.pulley.y;
      moveFreePulleyBy(freePulley, freePulley.vel.x * dt, freePulley.vel.y * dt);
      const maxTop = Math.max(0, height - (pulleyEl?.offsetHeight || 0));
      const maxLeft = Math.max(0, width - (pulleyEl?.offsetWidth || 0));
      if (parseFloat(pulleyEl?.style.top) >= maxTop - 0.5) freePulley.vel.y = 0;
      if (parseFloat(pulleyEl?.style.left) <= 0.5) freePulley.vel.x = 0;
      if (parseFloat(pulleyEl?.style.left) >= maxLeft - 0.5) freePulley.vel.x = 0;
    }

    let corrected = enforceRopeLength(
      model,
      startPt,
      endPt,
      rope.sim.restLength
    );

    if (startWinch) {
      corrected.start = getWinchHookWorld(startWinch);
    } else if (isRopeEndOnEdge(rope, "start") && !startW) {
      corrected.start = getRopeEndPoint(rope, "start");
    }
    if (endWinch) {
      corrected.end = getWinchHookWorld(endWinch);
    } else if (isRopeEndOnEdge(rope, "end") && !endW) {
      corrected.end = getRopeEndPoint(rope, "end");
    }

    // Oba konce pevné → zkrácení lana (navíjení) zvedne volnou kladku
    if (hasFree && freePulley) {
      enforceRopeLengthViaFreePulley(
        model,
        corrected.start,
        corrected.end,
        rope.sim.restLength,
        freePulley
      );
    }

    if (startW && corrected.start.y >= floorY - offS.y - 0.5) {
      startW.vel.x = 0;
      startW.vel.y = 0;
    }
    if (endW && corrected.end.y >= floorY - offE.y - 0.5) {
      endW.vel.x = 0;
      endW.vel.y = 0;
    }

    applyRopeSimEndpoints(rope, corrected.start, corrected.end);

    if (rodW && hasFree && freePulley) {
      rodW.vel.x = freePulley.vel.x;
      rodW.vel.y = freePulley.vel.y;
      const rod = getFreeRodEnd(pulleyEl);
      if (rod) placeWeightAtHook(rodW, rod);
    }
  }

  function simulateRopes(dt) {
    for (const rope of ropes) {
      integrateRopePhysics(rope, dt);
    }
  }

  function ensureSnapMarker() {
    if (snapMarker) return snapMarker;
    snapMarker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    snapMarker.classList.add("rope-snap");
    snapMarker.setAttribute("r", String(CLOSE_SNAP_RADIUS));
    snapMarker.setAttribute("aria-hidden", "true");
    snapMarker.style.display = "none";
    ropeLayer.appendChild(snapMarker);
    return snapMarker;
  }

  function hideSnapMarker() {
    if (snapMarker) snapMarker.style.display = "none";
  }

  function showSnapMarker(at) {
    const marker = ensureSnapMarker();
    marker.setAttribute("cx", at.x.toFixed(2));
    marker.setAttribute("cy", at.y.toFixed(2));
    marker.style.display = "";
  }

  function svgPointToStage(svg, x, y) {
    const stageRect = stage.getBoundingClientRect();
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const screen = pt.matrixTransform(ctm);
    return {
      x: screen.x - stageRect.left,
      y: screen.y - stageRect.top,
    };
  }

  function getFreeRodEnd(pulleyEl) {
    const free =
      pulleyEl ||
      pulleys.find((p) => p.kind === "free" && !isDocked(p.el))?.el ||
      null;
    if (!free || isDocked(free)) return null;
    const svg = free.querySelector("svg");
    if (!svg) return null;
    return svgPointToStage(svg, FREE_ROD_TIP.x, FREE_ROD_TIP.y);
  }

  function getWeightHookOffset(weight) {
    const svg = weight.el.querySelector("svg");
    const scale =
      (svg && svg.getBoundingClientRect().width) / WEIGHT.vbW ||
      weight.el.offsetWidth / WEIGHT.vbW;
    return { x: WEIGHT.hookX * scale, y: WEIGHT.hookY * scale };
  }

  function getWeightHookWorld(weight) {
    const left = parseFloat(weight.el.style.left) || 0;
    const top = parseFloat(weight.el.style.top) || 0;
    const off = getWeightHookOffset(weight);
    return { x: left + off.x, y: top + off.y };
  }

  function getWeightBottomSnapPoint(weight) {
    const left = parseFloat(weight.el.style.left) || 0;
    const top = parseFloat(weight.el.style.top) || 0;
    const w = weight.el.offsetWidth || 70;
    const h = weight.el.offsetHeight || 67;
    return { x: left + w / 2, y: top + h };
  }

  function isWeightBottomTaken(support, excludeWeight) {
    return weights.some(
      (w) =>
        w !== excludeWeight &&
        w.snap.type === "weight" &&
        w.snap.weight === support &&
        w.snap.placement === "hang"
    );
  }

  function placeWeightAlignedToBottom(support, weight) {
    const { width, height } = stageSize();
    const sTop = parseFloat(support.el.style.top) || 0;
    const sH = support.el.offsetHeight || 67;
    const wW = weight.el.offsetWidth || 70;
    const wH = weight.el.offsetHeight || 67;
    const wLeft = parseFloat(weight.el.style.left) || 0;
    const bottomY = sTop + sH;
    weight.el.style.top = `${clamp(bottomY - wH, 0, Math.max(0, height - wH))}px`;
    weight.el.style.left = `${clamp(wLeft, 0, Math.max(0, width - wW))}px`;
  }

  function wouldCreateWeightCycle(dragged, support) {
    if (dragged === support) return true;
    let current = support;
    while (current.snap.type === "weight") {
      if (current.snap.weight === dragged) return true;
      current = current.snap.weight;
    }
    return false;
  }

  function detachWeightsFrom(support) {
    for (const w of weights) {
      if (w.snap.type === "weight" && w.snap.weight === support) {
        w.snap = { type: "free" };
        w.vel = { x: 0, y: 0 };
      }
    }
  }

  function placeWeightAtHook(weight, point) {
    const off = getWeightHookOffset(weight);
    const { width, height } = stageSize();
    const w = weight.el.offsetWidth || 70;
    const h = weight.el.offsetHeight || 67;
    const left = clamp(point.x - off.x, 0, Math.max(0, width - w));
    const top = clamp(point.y - off.y, 0, Math.max(0, height - h));
    weight.el.style.left = `${left}px`;
    weight.el.style.top = `${top}px`;
  }

  function isRodTaken(pulleyEl, excludeWeight) {
    return weights.some(
      (w) =>
        w !== excludeWeight &&
        w.snap.type === "rod" &&
        (!pulleyEl || w.snap.pulley === pulleyEl)
    );
  }

  function isRopeEndTakenByWeight(rope, which, excludeWeight) {
    return weights.some(
      (w) =>
        w !== excludeWeight &&
        w.snap.type === "rope" &&
        w.snap.rope === rope &&
        w.snap.which === which
    );
  }

  function collectWeightSnapTargets(excludeWeight) {
    const targets = [];
    for (const pulley of pulleys) {
      if (pulley.kind !== "free" || isDocked(pulley.el)) continue;
      const rod = getFreeRodEnd(pulley.el);
      if (rod && !isRodTaken(pulley.el, excludeWeight)) {
        targets.push({ type: "rod", point: rod, pulley: pulley.el });
      }
    }

    for (const rope of ropes) {
      if (!rope.el.isConnected || rope.closed) continue;
      for (const end of ropeEnds(rope)) {
        if (isRopeEndTaken(rope, end.which, excludeWeight, null)) continue;
        targets.push({
          type: "rope",
          point: end.point,
          rope: end.rope,
          which: end.which,
        });
      }
    }

    for (const w of weights) {
      if (w === excludeWeight || !w.el.isConnected || isDocked(w.el)) continue;
      if (wouldCreateWeightCycle(excludeWeight, w)) continue;
      if (!isWeightBottomTaken(w, excludeWeight)) {
        targets.push({
          type: "weight",
          placement: "hang",
          point: getWeightBottomSnapPoint(w),
          weight: w,
        });
      }
      targets.push({
        type: "weight",
        placement: "align",
        point: getWeightBottomSnapPoint(w),
        weight: w,
      });
    }

    return targets;
  }

  function findWeightSnapTarget(weight) {
    const hook = getWeightHookWorld(weight);
    const bottom = getWeightBottomSnapPoint(weight);
    let best = null;
    let bestDist = CLOSE_SNAP_RADIUS;
    for (const target of collectWeightSnapTargets(weight)) {
      const probe =
        target.type === "weight" && target.placement === "align"
          ? bottom
          : hook;
      const d = dist(probe, target.point);
      if (d <= bestDist) {
        bestDist = d;
        best = target;
      }
    }
    return best;
  }

  function syncWeightToSnap(weight) {
    if (weight.dragging || isDocked(weight.el)) return;

    if (weight.snap.type === "rod") {
      const rod = getFreeRodEnd(weight.snap.pulley);
      if (rod) placeWeightAtHook(weight, rod);
      return;
    }

    if (weight.snap.type === "weight") {
      const support = weight.snap.weight;
      if (!support?.el.isConnected) {
        weight.snap = { type: "free" };
        return;
      }
      if (weight.snap.placement === "align") {
        placeWeightAlignedToBottom(support, weight);
      } else {
        placeWeightAtHook(weight, getWeightBottomSnapPoint(support));
      }
      return;
    }

    if (weight.snap.type === "rope") {
      const rope = weight.snap.rope;
      if (!rope.el.isConnected) {
        weight.snap = { type: "free" };
        return;
      }
      let pt;
      if (running && rope.sim) {
        pt =
          weight.snap.which === "start"
            ? rope.sim.startPt
            : rope.sim.endPt;
      } else {
        pt = getRopeEndPoint(rope, weight.snap.which);
      }
      placeWeightAtHook(weight, pt);
    }
  }

  function syncAllWeightsToSnap() {
    for (const weight of weights) syncWeightToSnap(weight);
  }

  function applyWeightSnap(weight, target) {
    if (target.type === "rod") {
      weight.snap = { type: "rod", pulley: target.pulley };
      placeWeightAtHook(weight, target.point);
    } else if (target.type === "weight") {
      weight.snap = {
        type: "weight",
        weight: target.weight,
        placement: target.placement,
      };
      if (target.placement === "align") {
        placeWeightAlignedToBottom(target.weight, weight);
      } else {
        placeWeightAtHook(weight, target.point);
      }
    } else {
      weight.snap = {
        type: "rope",
        rope: target.rope,
        which: target.which,
      };
      ensureRopeEdgeSnap(target.rope);
      target.rope.edgeSnap[target.which] = null;
      placeWeightAtHook(weight, target.point);
    }
    updateForceArrows();
  }

  function enableWeightDrag(weight) {
    let dragging = false;
    let pointerId = null;
    let grabOffsetX = 0;
    let grabOffsetY = 0;

    function stagePoint(e) {
      const { rect } = stageSize();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    weight.el.addEventListener("pointerdown", (e) => {
      if (tool !== "move" || running) return;
      if (e.button != null && e.button !== 0) return;
      if (isStockTemplate(weight.el)) return;
      beginUserAction();
      const { rect } = stageSize();
      const elRect = weight.el.getBoundingClientRect();
      weight.el.style.left = `${elRect.left - rect.left}px`;
      weight.el.style.top = `${elRect.top - rect.top}px`;
      const p = stagePoint(e);
      grabOffsetX = p.x - parseFloat(weight.el.style.left);
      grabOffsetY = p.y - parseFloat(weight.el.style.top);
      dragging = true;
      weight.dragging = true;
      pointerId = e.pointerId;
      detachWeightsFrom(weight);
      weight.snap = { type: "free" };
      weight.el.classList.add("is-dragging");
      weight.el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    weight.el.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const overStock = isOverStock(e.clientX, e.clientY);
      setStockDropTarget(overStock);
      if (overStock) {
        hideSnapMarker();
        weight.el.classList.remove("is-snapping");
        return;
      }
      const p = stagePoint(e);
      const { width, height } = stageSize();
      const w = weight.el.offsetWidth || 70;
      const h = weight.el.offsetHeight || 67;
      weight.el.style.left = `${clamp(p.x - grabOffsetX, 0, Math.max(0, width - w))}px`;
      weight.el.style.top = `${clamp(p.y - grabOffsetY, 0, Math.max(0, height - h))}px`;

      const snap = findWeightSnapTarget(weight);
      if (snap) {
        showSnapMarker(snap.point);
        weight.el.classList.add("is-snapping");
      } else {
        hideSnapMarker();
        weight.el.classList.remove("is-snapping");
      }
    });

    function finish(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      weight.dragging = false;
      pointerId = null;
      weight.el.classList.remove("is-dragging", "is-snapping");
      hideSnapMarker();
      setStockDropTarget(false);

      if (e && isOverStock(e.clientX, e.clientY)) {
        returnWeightToStock(weight);
        endUserAction();
        return;
      }

      const snap = findWeightSnapTarget(weight);
      if (snap) applyWeightSnap(weight, snap);
      else updateForceArrows();
      endUserAction();
    }

    weight.el.addEventListener("pointerup", finish);
    weight.el.addEventListener("pointercancel", finish);
  }

  function beginWeightSpawnDrag(e) {
    if (tool !== "move" || running) return;
    if (e.button != null && e.button !== 0) return;
    beginUserAction();
    const weight = createWeightInstance();
    const offsets = placeElUnderPointer(weight.el, e.clientX, e.clientY);
    let grabOffsetX = offsets.offsetX;
    let grabOffsetY = offsets.offsetY;
    let pointerId = e.pointerId;
    weight.dragging = true;
    weight.el.classList.add("is-dragging");
    e.preventDefault();

    function onMove(ev) {
      if (ev.pointerId !== pointerId) return;
      const overStock = isOverStock(ev.clientX, ev.clientY);
      setStockDropTarget(overStock);
      if (overStock) {
        hideSnapMarker();
        weight.el.classList.remove("is-snapping");
        return;
      }
      const { rect, width, height } = stageSize();
      const w = weight.el.offsetWidth || 70;
      const h = weight.el.offsetHeight || 67;
      weight.el.style.left = `${clamp(ev.clientX - rect.left - grabOffsetX, 0, Math.max(0, width - w))}px`;
      weight.el.style.top = `${clamp(ev.clientY - rect.top - grabOffsetY, 0, Math.max(0, height - h))}px`;
      const snap = findWeightSnapTarget(weight);
      if (snap) {
        showSnapMarker(snap.point);
        weight.el.classList.add("is-snapping");
      } else {
        hideSnapMarker();
        weight.el.classList.remove("is-snapping");
      }
    }

    function onUp(ev) {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      weight.dragging = false;
      weight.el.classList.remove("is-dragging", "is-snapping");
      hideSnapMarker();
      setStockDropTarget(false);
      if (isOverStock(ev.clientX, ev.clientY)) {
        returnWeightToStock(weight);
        endUserAction();
        return;
      }
      const snap = findWeightSnapTarget(weight);
      if (snap) applyWeightSnap(weight, snap);
      else updateForceArrows();
      endUserAction();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function beginPulleySpawnDrag(kind, e) {
    if (tool !== "move" || running) return;
    if (e.button != null && e.button !== 0) return;
    beginUserAction();
    const pulley = createPulleyInstance(kind);
    if (!pulley) return;
    const el = pulley.el;
    placeElUnderPointer(el, e.clientX, e.clientY);
    let pointerId = e.pointerId;
    let edge = "top";
    let along = 0;
    el.classList.add("is-dragging");
    e.preventDefault();

    function naturalSize() {
      return {
        width: el.offsetWidth || 112,
        height: el.offsetHeight || 128,
      };
    }

    function clampAlong(nextEdge, value) {
      const { width: sw, height: sh } = stageSize();
      const { width: w } = naturalSize();
      const margin = w * 0.35;
      if (nextEdge === "top" || nextEdge === "bottom") {
        return clamp(value, margin, sw - margin);
      }
      return clamp(value, margin, sh - margin);
    }

    function applyFixed(nextEdge, nextAlong) {
      const { width: sw, height: sh } = stageSize();
      const { width: w } = naturalSize();
      edge = nextEdge;
      along = clampAlong(nextEdge, nextAlong);
      let left = 0;
      let top = 0;
      if (nextEdge === "top") {
        left = along - w / 2;
        top = 0;
      } else if (nextEdge === "bottom") {
        left = along - w / 2;
        top = sh;
      } else if (nextEdge === "right") {
        left = sw - w / 2;
        top = along;
      } else {
        left = -w / 2;
        top = along;
      }
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.transform = `rotate(${EDGE_ROTATION[nextEdge]}deg)`;
      el.dataset.edge = nextEdge;
      el.dataset.along = String(along);
    }

    function nearestEdge(x, y) {
      const { width: sw, height: sh } = stageSize();
      const dists = [
        { edge: "top", d: y },
        { edge: "bottom", d: sh - y },
        { edge: "left", d: x },
        { edge: "right", d: sw - x },
      ];
      dists.sort((a, b) => a.d - b.d);
      return dists[0].edge;
    }

    function alongForEdge(nextEdge, x, y) {
      if (nextEdge === "top" || nextEdge === "bottom") return x;
      return y;
    }

    if (kind === "fixed") {
      const { rect } = stageSize();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      applyFixed(nearestEdge(x, y), alongForEdge(nearestEdge(x, y), x, y));
    }

    function onMove(ev) {
      if (ev.pointerId !== pointerId) return;
      const overStock = isOverStock(ev.clientX, ev.clientY);
      setStockDropTarget(overStock);
      if (overStock) return;
      if (kind === "free") {
        const { rect, width, height } = stageSize();
        const w = el.offsetWidth || 104;
        const h = el.offsetHeight || 160;
        const ox = w * 0.5;
        const oy = h * 0.4;
        el.style.left = `${clamp(ev.clientX - rect.left - ox, 0, Math.max(0, width - w))}px`;
        el.style.top = `${clamp(ev.clientY - rect.top - oy, 0, Math.max(0, height - h))}px`;
      } else {
        const { rect } = stageSize();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const nextEdge = nearestEdge(x, y);
        applyFixed(nextEdge, alongForEdge(nextEdge, x, y));
      }
      rebuildAllRopes();
      syncAllWeightsToSnap();
      updateForceArrows();
    }

    function onUp(ev) {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.classList.remove("is-dragging");
      setStockDropTarget(false);
      if (isOverStock(ev.clientX, ev.clientY)) {
        returnPulleyToStock(el);
        endUserAction();
        return;
      }
      if (kind === "free") enableFreeDrag(el);
      else enableFixedEdgeDrag(el, { edge, along });
      rebuildAllRopes();
      updateForceArrows();
      endUserAction();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function enableStockSpawning() {
    ensureStockTemplatesInSlots();
    const weightTpl = ensureWeightStockTemplate();
    const winchTpl = ensureWinchStockTemplate();
    if (stockTemplateFixed) {
      stockTemplateFixed.addEventListener("pointerdown", (e) => {
        beginPulleySpawnDrag("fixed", e);
      });
    }
    if (stockTemplateFree) {
      stockTemplateFree.addEventListener("pointerdown", (e) => {
        beginPulleySpawnDrag("free", e);
      });
    }
    if (weightTpl) {
      weightTpl.addEventListener("pointerdown", (e) => {
        beginWeightSpawnDrag(e);
      });
    }
    if (winchTpl) {
      winchTpl.addEventListener("pointerdown", (e) => {
        beginWinchSpawnDrag(e);
      });
    }
  }

  function collectWinchSnapTargets(excludeWinch) {
    const targets = [];
    for (const rope of ropes) {
      if (!rope.el.isConnected || rope.closed) continue;
      for (const end of ropeEnds(rope)) {
        if (isRopeEndTaken(rope, end.which, null, excludeWinch)) continue;
        targets.push({
          type: "rope",
          point: end.point,
          rope: end.rope,
          which: end.which,
        });
      }
    }
    return targets;
  }

  function findWinchSnapTarget(winch) {
    const hook = getWinchHookWorld(winch);
    let best = null;
    let bestDist = CLOSE_SNAP_RADIUS;
    for (const target of collectWinchSnapTargets(winch)) {
      const d = dist(hook, target.point);
      if (d <= bestDist) {
        bestDist = d;
        best = target;
      }
    }
    return best;
  }

  function applyWinchSnap(winch, target) {
    winch.snap = {
      type: "rope",
      rope: target.rope,
      which: target.which,
    };
    ensureRopeEdgeSnap(target.rope);
    target.rope.edgeSnap[target.which] = null;
    // Odpoj váhu na stejném konci, pokud by náhodou zůstala
    const w = weightOnRopeEnd(target.rope, target.which);
    if (w) w.snap = { type: "free" };
    placeWinchAtHook(winch, target.point);
    // Lano přichytí ke kotvě navijáku
    if (target.which === "start") {
      target.rope.points[0] = { ...target.point };
    } else {
      target.rope.points[target.rope.points.length - 1] = {
        ...target.point,
      };
    }
    rebuildRope(target.rope);
    updateForceArrows();
  }

  function enableWinchDrag(winch) {
    let dragging = false;
    let pointerId = null;
    let grabOffsetX = 0;
    let grabOffsetY = 0;

    function stagePoint(e) {
      const { rect } = stageSize();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    winch.el.addEventListener("pointerdown", (e) => {
      if (tool !== "move" || running) return;
      if (e.button != null && e.button !== 0) return;
      if (isStockTemplate(winch.el)) return;
      beginUserAction();
      const { rect } = stageSize();
      const elRect = winch.el.getBoundingClientRect();
      winch.el.style.left = `${elRect.left - rect.left}px`;
      winch.el.style.top = `${elRect.top - rect.top}px`;
      const p = stagePoint(e);
      grabOffsetX = p.x - parseFloat(winch.el.style.left);
      grabOffsetY = p.y - parseFloat(winch.el.style.top);
      dragging = true;
      winch.dragging = true;
      pointerId = e.pointerId;
      winch.snap = { type: "free" };
      setWinchWinding(winch, false);
      winch.el.classList.add("is-dragging");
      winch.el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    winch.el.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const overStock = isOverStock(e.clientX, e.clientY);
      setStockDropTarget(overStock);
      if (overStock) {
        hideSnapMarker();
        winch.el.classList.remove("is-snapping");
        return;
      }
      const p = stagePoint(e);
      const { width, height } = stageSize();
      const w = winch.el.offsetWidth || 78;
      const h = winch.el.offsetHeight || 65;
      winch.el.style.left = `${clamp(p.x - grabOffsetX, 0, Math.max(0, width - w))}px`;
      winch.el.style.top = `${clamp(p.y - grabOffsetY, 0, Math.max(0, height - h))}px`;
      const snap = findWinchSnapTarget(winch);
      if (snap) {
        showSnapMarker(snap.point);
        winch.el.classList.add("is-snapping");
      } else {
        hideSnapMarker();
        winch.el.classList.remove("is-snapping");
      }
    });

    function finish(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      winch.dragging = false;
      pointerId = null;
      winch.el.classList.remove("is-dragging", "is-snapping");
      hideSnapMarker();
      setStockDropTarget(false);
      if (e && isOverStock(e.clientX, e.clientY)) {
        returnWinchToStock(winch);
        endUserAction();
        return;
      }
      const snap = findWinchSnapTarget(winch);
      if (snap) applyWinchSnap(winch, snap);
      else updateForceArrows();
      endUserAction();
    }

    winch.el.addEventListener("pointerup", finish);
    winch.el.addEventListener("pointercancel", finish);
  }

  function beginWinchSpawnDrag(e) {
    if (tool !== "move" || running) return;
    if (e.button != null && e.button !== 0) return;
    beginUserAction();
    const winch = createWinchInstance();
    const offsets = placeElUnderPointer(winch.el, e.clientX, e.clientY);
    let grabOffsetX = offsets.offsetX;
    let grabOffsetY = offsets.offsetY;
    let pointerId = e.pointerId;
    winch.dragging = true;
    winch.el.classList.add("is-dragging");
    e.preventDefault();

    function onMove(ev) {
      if (ev.pointerId !== pointerId) return;
      const overStock = isOverStock(ev.clientX, ev.clientY);
      setStockDropTarget(overStock);
      if (overStock) {
        hideSnapMarker();
        winch.el.classList.remove("is-snapping");
        return;
      }
      const { rect, width, height } = stageSize();
      const w = winch.el.offsetWidth || 78;
      const h = winch.el.offsetHeight || 65;
      winch.el.style.left = `${clamp(ev.clientX - rect.left - grabOffsetX, 0, Math.max(0, width - w))}px`;
      winch.el.style.top = `${clamp(ev.clientY - rect.top - grabOffsetY, 0, Math.max(0, height - h))}px`;
      const snap = findWinchSnapTarget(winch);
      if (snap) {
        showSnapMarker(snap.point);
        winch.el.classList.add("is-snapping");
      } else {
        hideSnapMarker();
        winch.el.classList.remove("is-snapping");
      }
    }

    function onUp(ev) {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      winch.dragging = false;
      winch.el.classList.remove("is-dragging", "is-snapping");
      hideSnapMarker();
      setStockDropTarget(false);
      if (isOverStock(ev.clientX, ev.clientY)) {
        returnWinchToStock(winch);
        endUserAction();
        return;
      }
      const snap = findWinchSnapTarget(winch);
      if (snap) applyWinchSnap(winch, snap);
      else updateForceArrows();
      endUserAction();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function ropeEnds(rope) {
    if (!rope.points.length) return [];
    if (rope.closed) return [];
    return [
      { which: "start", point: getRopeEndPoint(rope, "start"), rope },
      { which: "end", point: getRopeEndPoint(rope, "end"), rope },
    ];
  }

  function findSnapTarget(p, excludeRope) {
    let best = null;
    let bestDist = CLOSE_SNAP_RADIUS;

    for (const rope of ropes) {
      if (excludeRope && rope === excludeRope) continue;
      if (!rope.el.isConnected) continue;
      for (const end of ropeEnds(rope)) {
        const d = dist(p, end.point);
        if (d <= bestDist) {
          bestDist = d;
          best = end;
        }
      }
    }

    // Uzavření smyčky na vlastní začátek se řeší zvlášť
    return best;
  }

  function concatPoints(a, aWhich, bPoints) {
    const left =
      aWhich === "end" ? a.points.slice() : a.points.slice().reverse();
    const right = bPoints.slice();
    if (left.length && right.length && dist(left[left.length - 1], right[0]) < 1) {
      right.shift();
    }
    return left.concat(right);
  }

  function commitRope(el, points, closed, edgeSnap, stickyIds) {
    const d = buildRopePath(points, closed, stickyIds || null);
    el.classList.remove("is-draft", "is-snapping");
    el.setAttribute("d", d);
    if (closed) el.dataset.closed = "true";
    else delete el.dataset.closed;

    const existing = ropes.find((r) => r.el === el);
    const nextEdge = edgeSnap || { start: null, end: null };
    const draft = {
      el,
      points,
      closed,
      edgeSnap: nextEdge,
      wrapIds: stickyIds ? stickyIds.slice() : [],
    };
    const model = computeRopeModel(draft);
    const wrapIds =
      stickyIds && stickyIds.length
        ? stickyIds.slice()
        : model.wraps.map((w) => w.wheelId).filter(Boolean);

    if (existing) {
      existing.points = points;
      existing.closed = closed;
      existing.wrapIds = wrapIds;
      if (edgeSnap) existing.edgeSnap = nextEdge;
      else ensureRopeEdgeSnap(existing);
    } else {
      ropes.push({
        el,
        points,
        closed,
        edgeSnap: nextEdge,
        wrapIds,
      });
    }
    syncRopeCount();
    syncRopeEndHandles();
    updateForceArrows();
  }

  function removeRope(rope) {
    for (const w of weights) {
      if (w.snap.type === "rope" && w.snap.rope === rope) {
        w.snap = { type: "free" };
      }
    }
    for (const w of winches) {
      if (w.snap.type === "rope" && w.snap.rope === rope) {
        w.snap = { type: "free" };
        setWinchWinding(w, false);
      }
    }
    rope.el.remove();
    ropes = ropes.filter((r) => r !== rope);
    syncRopeCount();
    syncRopeEndHandles();
    updateForceArrows();
  }

  function clearEndHandles() {
    endHandles.forEach((h) => h.el.remove());
    endHandles = [];
  }

  function syncRopeEndHandles() {
    clearEndHandles();
    if (tool !== "move") return;

    for (const rope of ropes) {
      if (!rope.el.isConnected || rope.closed) continue;
      for (const end of ropeEnds(rope)) {
        const handle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle"
        );
        handle.classList.add("rope-end-handle");
        handle.setAttribute("r", String(END_GRAB_RADIUS));
        handle.setAttribute("cx", end.point.x.toFixed(2));
        handle.setAttribute("cy", end.point.y.toFixed(2));
        handle.setAttribute("role", "button");
        handle.setAttribute(
          "aria-label",
          end.which === "start" ? "Začátek lana" : "Konec lana"
        );
        ropeLayer.appendChild(handle);
        endHandles.push({ el: handle, rope, which: end.which });
      }
    }
  }

  function attachRopeEndToEdge(rope, which, snap, handleEl) {
    ensureRopeEdgeSnap(rope);
    const w = weightOnRopeEnd(rope, which);
    if (w) w.snap = { type: "free" };
    const wn = winchOnRopeEnd(rope, which);
    if (wn) {
      wn.snap = { type: "free" };
      setWinchWinding(wn, false);
    }
    rope.edgeSnap[which] = normalizeEndSnap(snap);
    syncRopeEdgePoint(rope, which);
    rebuildRope(rope);
    if (handleEl) {
      const pt = getRopeEndPoint(rope, which);
      handleEl.setAttribute("cx", pt.x.toFixed(2));
      handleEl.setAttribute("cy", pt.y.toFixed(2));
    } else {
      syncRopeEndHandles();
    }
    syncAllWeightsToSnap();
    updateForceArrows();
  }

  function updateRopeEndPoint(rope, which, point, handleEl) {
    ensureRopeEdgeSnap(rope);
    rope.edgeSnap[which] = null;
    if (which === "start") {
      rope.points[0] = { x: point.x, y: point.y };
    } else {
      rope.points[rope.points.length - 1] = { x: point.x, y: point.y };
    }
    rebuildRope(rope);
    if (handleEl) {
      handleEl.setAttribute("cx", point.x.toFixed(2));
      handleEl.setAttribute("cy", point.y.toFixed(2));
    } else {
      syncRopeEndHandles();
    }
    syncAllWeightsToSnap();
  }

  function mergeRopesAtEnds(a, aWhich, b, bWhich) {
    const merged = concatPoints(
      { points: a.points, closed: false },
      aWhich,
      bWhich === "end"
        ? b.points.slice().reverse()
        : b.points.slice()
    );
    const edgeSnap = outerEdgeSnaps(a, aWhich, b, bWhich);
    commitRope(a.el, merged, false, edgeSnap);
    if (b !== a) removeRope(b);
  }

  function enableRopeEndDrag() {
    /** @type {null | { rope: typeof ropes[0], which: "start"|"end", pointerId: number, el: SVGCircleElement }} */
    let dragging = null;

    function stagePoint(e) {
      const { rect } = stageSize();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    ropeLayer.addEventListener("pointerdown", (e) => {
      if (tool !== "move" || running) return;
      if (e.button != null && e.button !== 0) return;
      const handle = endHandles.find((h) => h.el === e.target);
      if (!handle) return;

      dragging = {
        rope: handle.rope,
        which: handle.which,
        pointerId: e.pointerId,
        el: handle.el,
      };
      beginUserAction();
      handle.el.classList.add("is-dragging");
      handle.el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    ropeLayer.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== dragging.pointerId) return;
      const p = stagePoint(e);
      ensureRopeEdgeSnap(dragging.rope);
      const attached = dragging.rope.edgeSnap[dragging.which];

      if (attached) {
        const anchorSnap = findAnchorSnapTarget(p);
        if (anchorSnap) {
          attachRopeEndToEdge(
            dragging.rope,
            dragging.which,
            anchorSnap,
            dragging.el
          );
          showSnapMarker(anchorSnap.point);
          dragging.el.classList.add("is-snapping");
        } else {
          updateRopeEndPoint(dragging.rope, dragging.which, p, dragging.el);
          hideSnapMarker();
          dragging.el.classList.remove("is-snapping");
        }
        return;
      }

      updateRopeEndPoint(dragging.rope, dragging.which, p, dragging.el);

      const ropeSnap = findSnapTarget(p, dragging.rope);
      const anchorSnap = ropeSnap ? null : findAnchorSnapTarget(p);
      const snapPoint = ropeSnap?.point || anchorSnap?.point;
      if (snapPoint) {
        showSnapMarker(snapPoint);
        dragging.el.classList.add("is-snapping");
      } else {
        hideSnapMarker();
        dragging.el.classList.remove("is-snapping");
      }
    });

    function finish(e) {
      if (!dragging || (e && e.pointerId !== dragging.pointerId)) return;
      const p = stagePoint(e);
      const ropeSnap = findSnapTarget(p, dragging.rope);
      const anchorSnap = ropeSnap ? null : findAnchorSnapTarget(p);

      dragging.el.classList.remove("is-dragging", "is-snapping");
      hideSnapMarker();

      if (ropeSnap) {
        mergeRopesAtEnds(
          dragging.rope,
          dragging.which,
          ropeSnap.rope,
          ropeSnap.which
        );
      } else if (anchorSnap) {
        attachRopeEndToEdge(
          dragging.rope,
          dragging.which,
          anchorSnap,
          dragging.el
        );
      } else {
        updateRopeEndPoint(dragging.rope, dragging.which, p);
      }

      dragging = null;
      endUserAction();
    }

    ropeLayer.addEventListener("pointerup", finish);
    ropeLayer.addEventListener("pointercancel", finish);
  }

  function enablePencil() {
    let drawing = false;
    let pointerId = null;
    let draft = null;
    let points = [];
    /** @type {null | { rope: typeof ropes[0], which: 'start'|'end' }} */
    let attachFrom = null;
    /** @type {null | { edge: string, along: number }} */
    let startEdgeSnap = null;
    /** @type {string[]} kladky, kterých se tah už dotkl — zůstanou i daleko */
    let stickyIds = [];

    function stagePoint(e) {
      const { rect } = stageSize();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function effectivePoints() {
      if (!attachFrom) return points;
      return concatPoints(attachFrom.rope, attachFrom.which, points);
    }

    function rememberStickyFromPoints(pts) {
      let wraps = pickWrapEvents(simplify(pts, 0.9));
      wraps = ensureWrapsAgainstCrossing(simplify(pts, 0.9), wraps);
      for (const w of wraps) {
        const id = w.wheel && w.wheel.id;
        if (id && !stickyIds.includes(id)) stickyIds.push(id);
      }
    }

    function updateDraft() {
      if (!draft) return;
      const pts = effectivePoints();
      rememberStickyFromPoints(pts);
      const selfClose =
        !attachFrom &&
        pts.length >= 4 &&
        dist(pts[pts.length - 1], pts[0]) <= CLOSE_SNAP_RADIUS;
      const endSnap = findSnapTarget(
        pts[pts.length - 1],
        attachFrom && attachFrom.rope
      );
      const endEdgeSnap =
        endSnap || selfClose ? null : findAnchorSnapTarget(pts[pts.length - 1]);

      if (selfClose) {
        showSnapMarker(pts[0]);
        draft.classList.add("is-snapping");
        draft.setAttribute("d", buildRopePath(pts, true, stickyIds));
      } else if (endSnap) {
        showSnapMarker(endSnap.point);
        draft.classList.add("is-snapping");
        const preview = pts.slice();
        preview[preview.length - 1] = {
          x: endSnap.point.x,
          y: endSnap.point.y,
        };
        draft.setAttribute("d", buildRopePath(preview, false, stickyIds));
      } else if (endEdgeSnap) {
        showSnapMarker(endEdgeSnap.point);
        draft.classList.add("is-snapping");
        const preview = pts.slice();
        preview[preview.length - 1] = {
          x: endEdgeSnap.point.x,
          y: endEdgeSnap.point.y,
        };
        draft.setAttribute("d", buildRopePath(preview, false, stickyIds));
      } else {
        hideSnapMarker();
        draft.classList.remove("is-snapping");
        draft.setAttribute("d", buildRopePath(pts, false, stickyIds));
      }
    }

    ropeLayer.addEventListener("pointerdown", (e) => {
      if (tool !== "pencil") return;
      if (e.button != null && e.button !== 0) return;
      beginUserAction();
      syncRopeViewBox();
      const p = stagePoint(e);
      startEdgeSnap = null;
      stickyIds = [];
      attachFrom = findSnapTarget(p, null);
      if (attachFrom) {
        points = [{ x: attachFrom.point.x, y: attachFrom.point.y }];
        if (attachFrom.rope.wrapIds) {
          stickyIds = attachFrom.rope.wrapIds.slice();
        }
      } else {
        const anchorSnap = findAnchorSnapTarget(p);
        if (anchorSnap) {
          startEdgeSnap = normalizeEndSnap(anchorSnap);
          points = [{ x: anchorSnap.point.x, y: anchorSnap.point.y }];
        } else {
          points = [p];
        }
      }

      drawing = true;
      pointerId = e.pointerId;
      draft = document.createElementNS("http://www.w3.org/2000/svg", "path");
      draft.classList.add("rope-path", "is-draft");
      if (attachFrom) {
        // Skryj napojované lano — nahradí ho sloučený výsledek
        attachFrom.rope.el.style.opacity = "0.25";
      }
      draft.setAttribute("d", pointsToPolyline(points));
      ropeLayer.appendChild(draft);
      ropeLayer.setPointerCapture(e.pointerId);
      e.preventDefault();
      updateDraft();
    });

    ropeLayer.addEventListener("pointermove", (e) => {
      if (!drawing || e.pointerId !== pointerId) return;
      const p = stagePoint(e);
      const last = points[points.length - 1];
      if (!last || dist(last, p) >= 1.5) {
        points.push(p);
        updateDraft();
      } else {
        updateDraft();
      }
    });

    function finish(e) {
      if (!drawing || (e && e.pointerId !== pointerId)) return;
      drawing = false;
      pointerId = null;
      hideSnapMarker();

      if (attachFrom && attachFrom.rope.el) {
        attachFrom.rope.el.style.opacity = "";
      }

      if (!draft || points.length < 2) {
        if (draft) draft.remove();
        draft = null;
        points = [];
        attachFrom = null;
        startEdgeSnap = null;
        stickyIds = [];
        cancelUserAction();
        return;
      }

      let pts = effectivePoints();
      let closed = false;
      let edgeSnap = { start: null, end: null };

      const selfClose =
        !attachFrom &&
        !startEdgeSnap &&
        pts.length >= 4 &&
        dist(pts[pts.length - 1], pts[0]) <= CLOSE_SNAP_RADIUS;

      const endSnap = findSnapTarget(
        pts[pts.length - 1],
        attachFrom && attachFrom.rope
      );
      const endEdgeSnap = endSnap || selfClose
        ? null
        : findAnchorSnapTarget(pts[pts.length - 1]);

      if (startEdgeSnap) edgeSnap.start = normalizeEndSnap(startEdgeSnap);
      if (endEdgeSnap) {
        pts[pts.length - 1] = {
          x: endEdgeSnap.point.x,
          y: endEdgeSnap.point.y,
        };
        edgeSnap.end = normalizeEndSnap(endEdgeSnap);
      }

      if (selfClose) {
        pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
        closed = true;
        commitRope(draft, pts, true, null, stickyIds);
      } else if (endSnap) {
        ensureRopeEdgeSnap(endSnap.rope);
        rememberStickyFromPoints(pts);
        if (endSnap.rope.wrapIds) {
          for (const k of endSnap.rope.wrapIds) {
            if (!stickyIds.includes(k)) stickyIds.push(k);
          }
        }
        if (attachFrom && attachFrom.rope.wrapIds) {
          for (const k of attachFrom.rope.wrapIds) {
            if (!stickyIds.includes(k)) stickyIds.push(k);
          }
        }
        const otherEdgeSnap = endSnap.rope.edgeSnap;
        pts = concatPoints(
          { points: pts, closed: false },
          "end",
          endSnap.which === "end"
            ? endSnap.rope.points.slice().reverse()
            : endSnap.rope.points.slice()
        );
        let mergedEdge;
        if (attachFrom) {
          ensureRopeEdgeSnap(attachFrom.rope);
          mergedEdge = outerEdgeSnaps(
            attachFrom.rope,
            attachFrom.which,
            endSnap.rope,
            endSnap.which
          );
        } else {
          mergedEdge = {
            start: startEdgeSnap,
            end:
              endSnap.which === "end"
                ? otherEdgeSnap.start
                : otherEdgeSnap.end,
          };
        }
        removeRope(endSnap.rope);
        if (attachFrom) removeRope(attachFrom.rope);
        commitRope(draft, pts, false, mergedEdge, stickyIds);
      } else if (attachFrom) {
        ensureRopeEdgeSnap(attachFrom.rope);
        if (attachFrom.rope.wrapIds) {
          for (const k of attachFrom.rope.wrapIds) {
            if (!stickyIds.includes(k)) stickyIds.push(k);
          }
        }
        edgeSnap.start = attachFrom.rope.edgeSnap.start;
        if (attachFrom.which === "start") {
          edgeSnap.end = endEdgeSnap ? normalizeEndSnap(endEdgeSnap) : null;
        } else {
          edgeSnap.end = endEdgeSnap
            ? normalizeEndSnap(endEdgeSnap)
            : attachFrom.rope.edgeSnap.end;
        }
        removeRope(attachFrom.rope);
        commitRope(draft, pts, false, edgeSnap, stickyIds);
      } else {
        commitRope(draft, pts, false, edgeSnap, stickyIds);
      }

      draft = null;
      points = [];
      attachFrom = null;
      startEdgeSnap = null;
      stickyIds = [];
      endUserAction();
    }

    ropeLayer.addEventListener("pointerup", finish);
    ropeLayer.addEventListener("pointercancel", finish);
  }

  function enableFreeDrag(el) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    let pointerId = null;

    function moveTo(clientX, clientY) {
      const { rect } = stageSize();
      const elRect = el.getBoundingClientRect();
      const maxLeft = Math.max(0, rect.width - elRect.width);
      const maxTop = Math.max(0, rect.height - elRect.height);
      const left = clamp(clientX - rect.left - offsetX, 0, maxLeft);
      const top = clamp(clientY - rect.top - offsetY, 0, maxTop);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      rebuildAllRopes();
      syncAllWeightsToSnap();
      updateForceArrows();
    }

    el.addEventListener("pointerdown", (e) => {
      if (tool !== "move" || running) return;
      if (e.button != null && e.button !== 0) return;
      if (isStockTemplate(el)) return;
      beginUserAction();
      const { rect } = stageSize();
      const elRect = el.getBoundingClientRect();
      el.style.left = `${elRect.left - rect.left}px`;
      el.style.top = `${elRect.top - rect.top}px`;
      offsetX = e.clientX - elRect.left;
      offsetY = e.clientY - elRect.top;
      dragging = true;
      pointerId = e.pointerId;
      el.classList.add("is-dragging");
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    el.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const overStock = isOverStock(e.clientX, e.clientY);
      setStockDropTarget(overStock);
      if (overStock) return;
      moveTo(e.clientX, e.clientY);
    });

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      el.classList.remove("is-dragging");
      setStockDropTarget(false);
      if (e && isOverStock(e.clientX, e.clientY)) {
        returnPulleyToStock(el);
      }
      endUserAction();
    }

    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  }

  function enableFixedEdgeDrag(el, initial) {
    let edge = initial?.edge || el.dataset.edge || "top";
    let along = initial?.along != null ? initial.along : 0;
    let dragging = false;
    let pointerId = null;
    let grabOffsetAlong = 0;

    function naturalSize() {
      return {
        width: el.offsetWidth || 112,
        height: el.offsetHeight || 128,
      };
    }

    function clampAlong(nextEdge, value) {
      const { width: sw, height: sh } = stageSize();
      const { width: w } = naturalSize();
      const margin = w * 0.35;
      if (nextEdge === "top" || nextEdge === "bottom") {
        return clamp(value, margin, sw - margin);
      }
      return clamp(value, margin, sh - margin);
    }

    function apply(nextEdge, nextAlong) {
      const { width: sw, height: sh } = stageSize();
      const { width: w } = naturalSize();
      edge = nextEdge;
      along = clampAlong(nextEdge, nextAlong);

      let left = 0;
      let top = 0;

      if (nextEdge === "top") {
        left = along - w / 2;
        top = 0;
      } else if (nextEdge === "bottom") {
        left = along - w / 2;
        top = sh;
      } else if (nextEdge === "right") {
        left = sw - w / 2;
        top = along;
      } else {
        left = -w / 2;
        top = along;
      }

      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.transform = `rotate(${EDGE_ROTATION[nextEdge]}deg)`;
      el.dataset.edge = nextEdge;
      el.dataset.along = String(along);
      rebuildAllRopes();
      syncAllWeightsToSnap();
      updateForceArrows();
    }

    function nearestEdge(x, y) {
      const { width: sw, height: sh } = stageSize();
      const dists = [
        { edge: "top", d: y },
        { edge: "bottom", d: sh - y },
        { edge: "left", d: x },
        { edge: "right", d: sw - x },
      ];
      dists.sort((a, b) => a.d - b.d);
      return dists[0].edge;
    }

    function alongForEdge(nextEdge, x, y) {
      if (nextEdge === "top" || nextEdge === "bottom") return x;
      return y;
    }

    el.addEventListener("pointerdown", (e) => {
      if (tool !== "move" || running) return;
      if (e.button != null && e.button !== 0) return;
      if (isStockTemplate(el)) return;
      beginUserAction();
      const { rect } = stageSize();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (edge === "top" || edge === "bottom") {
        grabOffsetAlong = x - along;
      } else {
        grabOffsetAlong = y - along;
      }
      dragging = true;
      pointerId = e.pointerId;
      el.classList.add("is-dragging");
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    el.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const overStock = isOverStock(e.clientX, e.clientY);
      setStockDropTarget(overStock);
      if (overStock) return;
      const { rect } = stageSize();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const nextEdge = nearestEdge(x, y);
      let nextAlong;
      if (nextEdge === "top" || nextEdge === "bottom") {
        nextAlong = x - (nextEdge === edge ? grabOffsetAlong : 0);
      } else {
        nextAlong = y - (nextEdge === edge ? grabOffsetAlong : 0);
      }
      if (nextEdge !== edge) {
        grabOffsetAlong = 0;
        nextAlong = alongForEdge(nextEdge, x, y);
      }
      apply(nextEdge, nextAlong);
    });

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      el.classList.remove("is-dragging");
      setStockDropTarget(false);
      if (e && isOverStock(e.clientX, e.clientY)) {
        returnPulleyToStock(el);
        endUserAction();
        return;
      }
      const { rect } = stageSize();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const nextEdge = nearestEdge(x, y);
      apply(nextEdge, alongForEdge(nextEdge, x, y));
      endUserAction();
    }

    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);

    if (el._fixedResizeHandler) {
      window.removeEventListener("resize", el._fixedResizeHandler);
    }
    el._fixedResizeHandler = () => {
      if (!el.isConnected || isDocked(el)) return;
      apply(edge, along);
      syncRopeViewBox();
    };
    window.addEventListener("resize", el._fixedResizeHandler);

    if (initial?.edge && !initial.skipApply) apply(initial.edge, initial.along);
  }

  function getFreePulleyWheel() {
    return resolveModelWheel("free");
  }

  function wheelsMatch(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    return dist(a, b) < 4 && Math.abs(a.r - b.r) < 4;
  }

  function ropeWrapsFreeWheel(rope) {
    if (rope.sim?.model?.wraps?.some((w) => w.wheelKind === "free")) {
      return true;
    }
    if (rope.wrapIds) {
      for (const id of rope.wrapIds) {
        const p = findPulleyById(id);
        if (p && p.kind === "free") return true;
      }
    }
    const freeWheel = getFreePulleyWheel();
    if (!freeWheel) return false;
    return pickWrapEvents(rope.points).some((ev) =>
      wheelsMatch(ev.wheel, freeWheel)
    );
  }

  function clampWeightHook(weight, point) {
    const { width, height } = stageSize();
    const off = getWeightHookOffset(weight);
    const floorY = height - 8;
    const p = {
      x: clamp(
        point.x,
        off.x,
        width - (weight.el.offsetWidth - off.x)
      ),
      y: clamp(point.y, off.y, floorY),
    };
    if (p.y >= floorY - 0.5) weight.vel.y = 0;
    return p;
  }

  function moveFreePulleyBy(pulley, dx, dy) {
    const el = pulley?.el;
    if (!el || isDocked(el)) return;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
    const { width, height } = stageSize();
    const maxLeft = Math.max(0, width - el.offsetWidth);
    const maxTop = Math.max(0, height - el.offsetHeight);
    const left = clamp(parseFloat(el.style.left) + dx, 0, maxLeft);
    const top = clamp(parseFloat(el.style.top) + dy, 0, maxTop);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    rebuildAllRopes();
  }

  function rebuildRope(rope) {
    syncRopeEdgePoints(rope);
    if (running && rope.sim) {
      rope.el.setAttribute(
        "d",
        buildRopeFromModel(rope.sim.model, rope.sim.startPt, rope.sim.endPt)
      );
      return;
    }

    const startPt = getRopeEndPoint(rope, "start");
    const endPt = getRopeEndPoint(rope, "end");
    const model = computeRopeModel(rope);

    if (model.wraps.length && !rope.closed) {
      const live = liveWrapGeometry(model, startPt, endPt);
      if (live) {
        for (let i = 0; i < model.wraps.length; i += 1) {
          model.wraps[i].clockwise = live.cws[i];
          model.wraps[i].enterAng = live.enterAng[i];
          model.wraps[i].leaveAng = live.leaveAng[i];
        }
      }
      rope.wrapIds = model.wraps.map((w) => w.wheelId).filter(Boolean);
      rope.el.setAttribute("d", buildRopeFromModel(model, startPt, endPt));
      return;
    }

    rope.el.setAttribute("d", buildRopePath(rope.points, rope.closed));
  }

  function rebuildAllRopes() {
    for (const rope of ropes) {
      if (rope.el.isConnected) rebuildRope(rope);
    }
    if (!running) updateForceArrows();
  }

  function physicsStep(dt) {
    if (!weights.length) return;

    simulateRopes(dt);

    for (const weight of weights) {
      if (isDocked(weight.el)) continue;
      if (
        weight.snap.type === "rod" ||
        weight.snap.type === "rope" ||
        weight.snap.type === "weight"
      ) {
        continue;
      }

      weight.vel.x = 0;
      weight.vel.y = GRAVITY;
      const hook = getWeightHookWorld(weight);
      let nextHook = {
        x: hook.x + weight.vel.x * dt,
        y: hook.y + weight.vel.y * dt,
      };
      nextHook = clampWeightHook(weight, nextHook);
      placeWeightAtHook(weight, nextHook);
    }

    syncAllWeightsToSnap();
    updateForceArrows();
  }

  function physicsLoop(now) {
    if (!running) return;
    if (settling) {
      updateSettling(now);
    } else {
      const dt = Math.min((now - lastPhysicsTime) / 1000, 0.032);
      lastPhysicsTime = now;
      physicsStep(dt);
    }
    physicsFrame = requestAnimationFrame(physicsLoop);
  }

  function startSimulation() {
    if (running) return;
    preRunSnapshot = captureScene();
    updateHistoryButtons();
    running = true;
    for (const pulley of pulleys) pulley.vel = { x: 0, y: 0 };
    for (const weight of weights) weight.vel = { x: 0, y: 0 };
    initRopeSimulation();
    startSettling();
    clearEndHandles();
    hideSnapMarker();
    updateForceArrows();
    lastPhysicsTime = performance.now();
    physicsFrame = requestAnimationFrame(physicsLoop);
  }

  function stopSimulation() {
    running = false;
    settling = false;
    for (const pulley of pulleys) pulley.vel = { x: 0, y: 0 };
    for (const weight of weights) weight.vel = { x: 0, y: 0 };
    for (const winch of winches) setWinchWinding(winch, false);
    clearRopeSimulation();
    rebuildAllRopes();
    syncAllWeightsToSnap();
    syncAllWinchesToSnap();
    syncRopeEndHandles();
    updateForceArrows();
    if (physicsFrame != null) {
      cancelAnimationFrame(physicsFrame);
      physicsFrame = null;
    }
  }

  function eraseTargetAtEvent(e) {
    if (tool !== "erase" || running) return false;
    if (e.button != null && e.button !== 0) return false;

    const stack =
      typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(e.clientX, e.clientY)
        : [e.target];

    for (const node of stack) {
      if (!node || !node.closest) continue;

      const pulleyEl = node.closest(".pulley");
      if (
        pulleyEl &&
        !isStockTemplate(pulleyEl) &&
        stage.contains(pulleyEl) &&
        findPulleyByEl(pulleyEl)
      ) {
        beginUserAction();
        destroyPulley(pulleyEl);
        endUserAction();
        return true;
      }

      const weightEl = node.closest(".weight");
      if (
        weightEl &&
        !isStockTemplate(weightEl) &&
        stage.contains(weightEl)
      ) {
        const weight = weights.find((w) => w.el === weightEl);
        if (weight) {
          beginUserAction();
          destroyWeight(weight);
          endUserAction();
          return true;
        }
      }

      const winchEl = node.closest(".winch");
      if (
        winchEl &&
        !isStockTemplate(winchEl) &&
        stage.contains(winchEl)
      ) {
        const winch = winches.find((w) => w.el === winchEl);
        if (winch) {
          beginUserAction();
          destroyWinch(winch);
          endUserAction();
          return true;
        }
      }

      const path = node.closest(".rope-path");
      if (path && !path.classList.contains("is-draft")) {
        const rope = ropes.find((r) => r.el === path);
        if (rope) {
          beginUserAction();
          removeRope(rope);
          endUserAction();
          return true;
        }
      }
    }

    return false;
  }

  function enableEraser() {
    const onPointerDown = (e) => {
      if (tool !== "erase" || running) return;
      if (eraseTargetAtEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    stage.addEventListener("pointerdown", onPointerDown, true);
    ropeLayer.addEventListener("pointerdown", onPointerDown, true);
  }

  btnMove.addEventListener("click", () => setTool("move"));
  btnPencil.addEventListener("click", () => setTool("pencil"));
  btnRun.addEventListener("click", () => {
    if (tool === "run") setTool("move");
    else setTool("run");
  });
  if (btnErase) {
    btnErase.addEventListener("click", () => {
      if (tool === "erase") setTool("move");
      else setTool("erase");
    });
  }

  if (btnUndo) btnUndo.addEventListener("click", () => undoLastStep());
  if (btnReset) btnReset.addEventListener("click", () => resetToPreRun());
  if (btnForces) {
    btnForces.addEventListener("click", () => setShowForces(!showForces));
  }

  enablePencil();
  enableRopeEndDrag();
  enableStockSpawning();
  enableEraser();

  syncRopeViewBox();
  updateClearEnabled();
  updateHistoryButtons();
  syncForcesToggleUi();

  window.addEventListener("resize", () => {
    syncRopeViewBox();
    syncForceOverlay();
    syncAllRopeEdgePoints();
    rebuildAllRopes();
    syncRopeEndHandles();
    syncAllWeightsToSnap();
    updateForceArrows();
  });

  requestAnimationFrame(() => updateForceArrows());
})();
