(function () {
  const appRoot = document.querySelector(".app-root");
  const stage = document.getElementById("stage");
  const ropeLayer = document.getElementById("rope-layer");
  const btnMove = document.getElementById("tool-move");
  const btnRope = document.getElementById("tool-rope");
  const btnFreehand = document.getElementById("tool-freehand");
  const btnRun = document.getElementById("tool-run");
  const btnErase = document.getElementById("tool-erase");
  const btnUndo = document.getElementById("tool-undo");
  const btnReset = document.getElementById("tool-reset");
  const btnForces = document.getElementById("toggle-forces");
  const freehandConfirm = document.getElementById("freehand-confirm");
  const freehandConfirmOk = document.getElementById("freehand-confirm-ok");
  const freehandConfirmCancel = document.getElementById(
    "freehand-confirm-cancel"
  );
  const pulleySizeSlider = document.getElementById("pulley-size-slider");
  const stockTray = document.getElementById("stock-tray");
  const stockScaler = document.getElementById("stock-scaler");
  const stockSection = document.querySelector(".stock-section");
  const leftPanel = document.querySelector(".left-panel");
  const stockSlotFixed = document.getElementById("stock-slot-fixed");
  const stockSlotFree = document.getElementById("stock-slot-free");
  const stockSlotWeights = document.getElementById("stock-slot-weights");
  const stockSlotWinch = document.getElementById("stock-slot-winch");
  const winchOverloadMsg = document.getElementById("winch-overload-msg");
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
  /** Než se tažení rozjede, musí prst ujít pár pixelů — klik tak nic neposune. */
  const DRAG_START_SLOP = 4;
  /**
   * Maximální obepnutí — těsně pod celým závitem. Volná kladka v oku lana,
   * jehož ramena se nad ní sbíhají, potřebuje výrazně víc než půlkruh.
   */
  const MAX_WRAP_TRAVEL = 2 * Math.PI - 0.35;
  /** Nad tímto obloukem se obepnutí mírně penalizuje (kratší je pravděpodobnější). */
  const LONG_WRAP_TRAVEL = Math.PI + 0.15;
  /** Minimální obepnutí — jen proti ostrému „V“ zlomu (ne proti platným krátkým obloukům). */
  const MIN_WRAP_TRAVEL = 0.35;
  /** Pás přimknutí lana k obvodu kladky (px za poloměrem drážky). */
  const WRAP_ADHESION_BAND_MIN = 10;
  const WRAP_ADHESION_BAND_RATIO = 0.32;
  const WRAP_TOUCH_PAD = 2;
  const WRAP_POINT_PAD = 2;
  /** Bod v jádře kladky (osa) nepatří k obepnutí po obvodu. */
  const WRAP_HUB_RATIO = 0.45;
  /** Nejkratší úsek tahu v pásmu přimknutí, který se ještě počítá jako obepnutí. */
  const WRAP_MIN_BAND_LENGTH = 12;
  /** Kolik pořadí obepnutí se zkusí, když stávající navlečení nelze projít. */
  const WRAP_REORDER_MAX_TRIES = 48;
  /** Obepnutí, které lano prodlouží o méně, už lano nevede — uvolní se. */
  const WRAP_STALE_DETOUR = 6;
  /** Kolika obepnutím se hledá smysl oblouku hrubou silou (2^n variant). */
  const MAX_WRAP_DIRECTION_SEARCH = 4;

  /** Konec volné tyčky u modré kladky (SVG souřadnice). */
  const FREE_ROD_TIP = { x: 143.314, y: 103.887 };

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
  const WEIGHT_LABEL_TEXT = "10 kg";

  function weightInnerHtml() {
    return `${WEIGHT_SVG}<span class="weight-label" aria-hidden="true">${WEIGHT_LABEL_TEXT}</span>`;
  }

  const WINCH_SVG = `<svg width="134" height="132" viewBox="0 0 134 132" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="48.5" width="133" height="83" rx="12" ry="12" fill="#D9D9D9" stroke="black"/><circle cx="67" cy="50" r="50" fill="black"/><g transform="translate(66.7016 49.7016)"><g class="winch-drum"><g transform="translate(-66.7016 -49.7016)"><path d="M66.6989 80.4041C83.6555 80.4041 97.4015 66.6581 97.4015 49.7015C97.4015 32.745 83.6555 18.999 66.6989 18.999C49.7423 18.999 35.9963 32.745 35.9963 49.7015C35.9963 66.6581 49.7423 80.4041 66.6989 80.4041Z" fill="white" stroke="#B1B1B1" stroke-width="7.69075" stroke-miterlimit="10" stroke-linecap="round"/><path d="M66.7016 85.4031C86.419 85.4031 102.403 69.419 102.403 49.7016C102.403 29.9841 86.419 14 66.7016 14C46.9841 14 31 29.9841 31 49.7016C31 69.419 46.9841 85.4031 66.7016 85.4031Z" stroke="#1D1D1B" stroke-width="3.29604" stroke-miterlimit="10" stroke-linecap="round"/><path d="M99.2331 49.7016C99.2331 67.665 84.6701 82.2335 66.7012 82.2335C48.7323 82.2335 34.1693 67.6705 34.1693 49.7016C34.1693 31.7327 48.7323 17.1697 66.7012 17.1697" stroke="white" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/><path d="M39.9513 49.7234H93.3746" stroke="#1D1D1B" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/><path d="M66.6575 23.0091V76.4324" stroke="#1D1D1B" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/><path d="M47.7767 30.8317L85.5548 68.6098" stroke="#1D1D1B" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/><path d="M85.5548 30.8317L47.7767 68.6098" stroke="#1D1D1B" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/><path d="M41.8699 39.7641L91.4423 59.6777" stroke="#1D1D1B" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/><path d="M76.614 24.9374L56.7005 74.5098" stroke="#1D1D1B" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/><path d="M56.1691 25.1571L77.1429 74.29" stroke="#1D1D1B" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/><path d="M91.2219 39.2367L42.089 60.2105" stroke="#1D1D1B" stroke-width="0.54934" stroke-miterlimit="10" stroke-linecap="round"/></g></g></g><circle class="winch-light" cx="67" cy="50" r="43" stroke="white" stroke-width="5" stroke-linecap="round" stroke-dasharray="8 14" fill="none"/><circle class="winch-led" cx="16" cy="118" r="6.5" fill="#5a5a5a" stroke="#1d1d1b" stroke-width="1.4"/><text class="winch-force-text" x="67" y="119.5" text-anchor="middle" dominant-baseline="central" fill="#4A43E8" font-size="15" font-weight="700" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"></text></svg>`;

  const WINCH = {
    vbW: 134,
    /** Úchyt lana — horní bod bubnu. */
    hookX: 67,
    hookY: 14,
    /** Střed kola (SVG). */
    drumCx: 66.7016,
    drumCy: 49.7016,
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
  /** Otáčení bubnu při navíjení (stupně / s). */
  const WINCH_SPIN_DEG_PER_S = 130;
  /** Hmotnost modré kladky — zanedbatelná. */
  const PULLEY_MASS = 0;
  /**
   * Náhradní hmotnost tělesa bez zátěže. Soustava napětí se počítá přes
   * zrychlení (F/m), takže nulová hmotnost by kladku ze soustavy vyřadila —
   * a pohyblivý blok kladkostroje by pak sílu nepůlil. Zlomek závaží je proti
   * zátěži zanedbatelný a řešení tím vyjde jako pro nehmotnou kladku.
   */
  const MIN_BODY_MASS = 1e-3;
  /**
   * Setrvačnost nezatížené kladky napříč osou zátěže. Nehmotné těleso musí být
   * přesně v rovnováze, takže i pár stupňů šikmé lano by napětí srazilo na nulu.
   * Napříč osou se proto chová jako závaží — nepatrné vychýlení se jen pomalu
   * vykývá, místo aby rozhodilo celou soustavu.
   */
  const SWING_BODY_MASS = 1;
  /** Numerická pojistka na rychlost tělesa (px/s). */
  const MAX_BODY_SPEED = 4000;
  /** Pod touto tolerancí (px) je lano považované za napnuté. */
  const ROPE_SLACK_TOL = 1.5;
  const SETTLE_MS = 100;
  let running = false;
  let runBlocked = false;
  let settling = false;
  let settleStartTime = 0;
  let physicsFrame = null;
  let lastPhysicsTime = 0;
  let forceLayer = null;
  const FORCE_ARROW_MAX = 900;
  const FORCE_ARROW_UNIT_LEN = 110;
  /** @type {boolean} */
  let showForces = false;
  /** @type {string | null} */
  let selectedPulleyId = null;
  const PULLEY_CLICK_MOVE_PX = 6;
  const PULLEY_SCALE_MIN = 0.4;
  const PULLEY_SCALE_MAX = 1;
  /** Globální měřítko kladek, závaží a lana na ploše. */
  let globalStageScale = 0.9;

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
    if (btnRun) btnRun.disabled = runBlocked && tool !== "run";
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
      globalStageScale,
      pulleys: pulleys.map((p) => ({
        id: p.id,
        kind: p.kind,
        relativeScale: getPulleyRelativeScale(p),
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
    tieRopeEndsAtPulleyCenters();
    if (historySuspended || running || !actionBaseline) {
      actionBaseline = null;
      return;
    }
    const now = captureScene();
    if (!scenesEqual(actionBaseline, now)) {
      historyStack.push(actionBaseline);
      if (historyStack.length > HISTORY_MAX) historyStack.shift();
      runBlocked = false;
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
    if (snap.globalStageScale != null && !Number.isNaN(snap.globalStageScale)) {
      applyGlobalStageScale(snap.globalStageScale, {
        skipRebuild: true,
        skipSlider: true,
      });
    }

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
      if (ps.relativeScale != null && !Number.isNaN(ps.relativeScale)) {
        pulley.relativeScale = ps.relativeScale;
      } else if (ps.scale != null && !Number.isNaN(ps.scale)) {
        const baseGlobal =
          snap.globalStageScale != null && !Number.isNaN(snap.globalStageScale)
            ? snap.globalStageScale
            : 0.9;
        pulley.relativeScale = ps.scale / baseGlobal;
      }
      applyPulleyCssScale(pulley, { adjustPosition: false });
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
    syncRopeCount();
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
    discardFreehandPending();
    if (running) {
      stopSimulation();
      if (tool === "run") {
        tool = "move";
        applyToolChrome("move");
      }
    }
    const snap = historyStack.pop();
    runBlocked = false;
    historySuspended = true;
    actionBaseline = null;
    restoreScene(snap);
    historySuspended = false;
    updateHistoryButtons();
  }

  function resetToPreRun() {
    if (!preRunSnapshot) return;
    discardFreehandPending();
    if (running) stopSimulation();
    if (tool === "run") {
      tool = "move";
      applyToolChrome("move");
    }
    runBlocked = false;
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
    syncPulleySizeSliderState();
  }

  function syncPulleySizeSliderState() {
    if (!pulleySizeSlider) return;
    const pulley = findSelectedPulley();
    const canIndividual = pulleyCanResize(pulley);
    const canGlobal = !running;
    pulleySizeSlider.disabled = !(canIndividual || canGlobal);
    const control = pulleySizeSlider.closest(".size-control");
    if (control) control.classList.toggle("is-disabled", pulleySizeSlider.disabled);
    if (canIndividual) {
      const pct = Math.round(getPulleyEffectiveScale(pulley) * 100);
      pulleySizeSlider.value = String(pct);
      pulleySizeSlider.setAttribute("aria-valuenow", String(pct));
      pulleySizeSlider.setAttribute("aria-label", "Velikost vybrané kladky");
    } else if (canGlobal) {
      const pct = Math.round(globalStageScale * 100);
      pulleySizeSlider.value = String(pct);
      pulleySizeSlider.setAttribute("aria-valuenow", String(pct));
      pulleySizeSlider.setAttribute(
        "aria-label",
        "Celková velikost kladek, závaží a lana na ploše"
      );
    }
    syncPulleyResizeHandle();
  }

  function findSelectedPulley() {
    return selectedPulleyId ? findPulleyById(selectedPulleyId) : null;
  }

  function getPulleyRelativeScale(pulley) {
    if (pulley?.relativeScale != null && !Number.isNaN(pulley.relativeScale)) {
      return pulley.relativeScale;
    }
    if (pulley?.scale != null && !Number.isNaN(pulley.scale)) {
      return pulley.scale / globalStageScale;
    }
    const inline = pulley?.el?.style.getPropertyValue("--pulley-scale");
    if (inline) {
      const parsed = parseFloat(inline);
      if (!Number.isNaN(parsed)) return parsed / globalStageScale;
    }
    return 1;
  }

  function getPulleyEffectiveScale(pulley) {
    return clamp(
      getPulleyRelativeScale(pulley) * globalStageScale,
      PULLEY_SCALE_MIN,
      PULLEY_SCALE_MAX
    );
  }

  function getPulleyInstanceScale(pulley) {
    return getPulleyEffectiveScale(pulley);
  }

  function pulleyHasAttachedRope(pulley) {
    const id = pulley.id;
    for (const rope of ropes) {
      if (!rope.el.isConnected) continue;
      ensureRopeEdgeSnap(rope);
      for (const which of ["start", "end"]) {
        const snap = rope.edgeSnap[which];
        if (isPulleyCenterSnap(snap) && snap.pulleyId === id) return true;
      }
      if (rope.wrapIds && rope.wrapIds.includes(id)) return true;
      if (strokeWrapsPulley(rope.points, id)) return true;
    }
    return false;
  }

  /** @type {HTMLElement | null} */
  let pulleyResizeHandle = null;
  /** @type {null | { pointerId: number, startX: number, startScale: number }} */
  let pulleyResizeDrag = null;

  function pulleyCanResize(pulley) {
    return !!(
      pulley &&
      !isDocked(pulley.el) &&
      !pulleyHasAttachedRope(pulley) &&
      tool === "move" &&
      !running
    );
  }

  function ensurePulleyResizeHandle() {
    if (pulleyResizeHandle?.isConnected) return pulleyResizeHandle;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "pulley-resize-handle";
    handle.hidden = true;
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", "Velikost kladky");
    handle.setAttribute("aria-valuemin", "40");
    handle.setAttribute("aria-valuemax", "100");
    handle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7H11.5M4.5 4.5L2.5 7L4.5 9.5M9.5 4.5L11.5 7L9.5 9.5"/></svg>`;
    stage.appendChild(handle);
    enablePulleyResizeHandleDrag(handle);
    pulleyResizeHandle = handle;
    return handle;
  }

  function syncPulleyResizeHandle() {
    const handle = ensurePulleyResizeHandle();
    const pulley = findSelectedPulley();
    if (!pulley || !pulleyCanResize(pulley)) {
      handle.hidden = true;
      return;
    }

    // Na vodorovném průměru kola — tažení do strany mění velikost
    const wheel = getWheelWorld(pulley.el, pulley.kind);
    const pad = 6;
    handle.style.left = `${wheel.cx + wheel.r + pad}px`;
    handle.style.top = `${wheel.cy}px`;
    handle.hidden = false;
    const pct = Math.round(getPulleyInstanceScale(pulley) * 100);
    handle.setAttribute("aria-valuenow", String(pct));
  }

  function enablePulleyResizeHandleDrag(handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (handle.hidden) return;
      const pulley = findSelectedPulley();
      if (!pulley || !pulleyCanResize(pulley)) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      beginUserAction();
      runBlocked = false;
      updateHistoryButtons();
      pulleyResizeDrag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startScale: getPulleyInstanceScale(pulley),
      };
      handle.classList.add("is-dragging");
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener("pointermove", (e) => {
      if (!pulleyResizeDrag || e.pointerId !== pulleyResizeDrag.pointerId) return;
      const pulley = findSelectedPulley();
      if (!pulley) return;
      const dx = e.clientX - pulleyResizeDrag.startX;
      const next = clamp(pulleyResizeDrag.startScale + dx / 220, 0.4, 1);
      setPulleyEffectiveScale(pulley, next);
      if (pulleySizeSlider && !pulleySizeSlider.disabled) {
        pulleySizeSlider.value = String(Math.round(next * 100));
        pulleySizeSlider.setAttribute("aria-valuenow", String(Math.round(next * 100)));
      }
      syncPulleyResizeHandle();
    });

    function finish(e) {
      if (!pulleyResizeDrag || (e && e.pointerId !== pulleyResizeDrag.pointerId)) {
        return;
      }
      pulleyResizeDrag = null;
      handle.classList.remove("is-dragging");
      resettleRopeWraps();
      endUserAction();
    }

    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  function syncPulleySelectionChrome() {
    for (const pulley of pulleys) {
      pulley.el.classList.toggle("is-selected", pulley.id === selectedPulleyId);
    }
    syncPulleyResizeHandle();
  }

  function selectPulley(pulley) {
    if (running || tool !== "move") return;
    if (!pulley || isDocked(pulley.el)) {
      clearPulleySelection();
      return;
    }
    selectedPulleyId = pulley.id;
    syncPulleySelectionChrome();
    syncPulleySizeSliderState();
  }

  function clearPulleySelection() {
    if (!selectedPulleyId) return;
    selectedPulleyId = null;
    syncPulleySelectionChrome();
    syncPulleySizeSliderState();
  }

  function bindPulleySelectOnClick(el) {
    let downX = 0;
    let downY = 0;
    let moved = false;

    el.addEventListener(
      "pointerdown",
      (e) => {
        if (tool !== "move" || running) return;
        if (e.button != null && e.button !== 0) return;
        downX = e.clientX;
        downY = e.clientY;
        moved = false;
      },
      true
    );

    el.addEventListener("pointermove", (e) => {
      if (tool !== "move" || running) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > PULLEY_CLICK_MOVE_PX) {
        moved = true;
      }
    });

    el.addEventListener("pointerup", (e) => {
      if (tool !== "move" || running) return;
      if (e.button != null && e.button !== 0) return;
      if (isStockTemplate(el)) return;
      if (moved) return;
      const pulley = findPulleyByEl(el);
      if (pulley) selectPulley(pulley);
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function stageSize() {
    const rect = stage.getBoundingClientRect();
    return { width: rect.width, height: rect.height, rect };
  }

  /** @type {WeakMap<SVGSVGElement, SVGCircleElement>} */
  const svgCoordProbeCache = new WeakMap();

  function ensureSvgCoordProbe(svg) {
    let probe = svgCoordProbeCache.get(svg);
    if (probe?.isConnected) return probe;
    probe = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    probe.setAttribute("data-wheel-probe", "1");
    probe.setAttribute("r", "1");
    probe.setAttribute("fill", "#000");
    probe.setAttribute("opacity", "0");
    probe.setAttribute("pointer-events", "none");
    svg.appendChild(probe);
    svgCoordProbeCache.set(svg, probe);
    return probe;
  }

  /** SVG user → client (viewport) souřadnice; zahrnuje CSS transform rodičů. */
  function svgUserToClient(svg, ux, uy) {
    if (!svg) return null;
    const probe = ensureSvgCoordProbe(svg);
    probe.setAttribute("cx", String(ux));
    probe.setAttribute("cy", String(uy));
    const rect = probe.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
    if (rect.left || rect.top) {
      return { x: rect.left, y: rect.top };
    }
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = ux;
    pt.y = uy;
    const screen = pt.matrixTransform(ctm);
    return { x: screen.x, y: screen.y };
  }

  function svgUserToStage(svg, ux, uy) {
    const client = svgUserToClient(svg, ux, uy);
    if (!client) return null;
    const stageRect = stage.getBoundingClientRect();
    return {
      x: client.x - stageRect.left,
      y: client.y - stageRect.top,
    };
  }

  /** Bod ukazatele ve stage souřadnicích — přes inverse CTM vrstvy lana. */
  function pointerToStage(e) {
    const pt = ropeLayer.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = ropeLayer.getScreenCTM();
    if (ctm) {
      try {
        const local = pt.matrixTransform(ctm.inverse());
        if (Number.isFinite(local.x) && Number.isFinite(local.y)) {
          return { x: local.x, y: local.y };
        }
      } catch (_) {
        /* inverse singular — fallback níže */
      }
    }
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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

  /** Střed (osa) kladky ve stage souřadnicích — pevná i volná. */
  function getPulleyCenterWorld(pulleyId) {
    const wheels = collectWheels();
    const w = pulleyId
      ? wheels.find((x) => x.id === pulleyId)
      : null;
    if (!w) return null;
    return { x: w.cx, y: w.cy, pulleyId: w.id, kind: w.kind };
  }

  /** @deprecated alias — starší scény používají fixedCenter */
  function getFixedPulleyCenterWorld(pulleyId) {
    return getPulleyCenterWorld(pulleyId);
  }

  function isPulleyCenterSnap(snap) {
    return (
      !!snap &&
      (snap.type === "pulleyCenter" ||
        snap.type === "fixedCenter" ||
        snap.type === "freeCenter")
    );
  }

  /** Konec lana je upevněn ke středu kladky — sdílený bod pro více lan. */
  function isRopeEndAtPulleyCenter(rope, which) {
    ensureRopeEdgeSnap(rope);
    return isPulleyCenterSnap(rope.edgeSnap[which]);
  }

  /** ID kladek, ke jejichž středu je konec lana přimknutý — ty se neobepínají. */
  function pulleyCenterExcludeIds(...snaps) {
    const ids = new Set();
    for (const snap of snaps) {
      if (isPulleyCenterSnap(snap) && snap.pulleyId) ids.add(snap.pulleyId);
    }
    return ids;
  }

  function ropeCenterExcludeIds(rope) {
    if (!rope?.edgeSnap) return new Set();
    return pulleyCenterExcludeIds(rope.edgeSnap.start, rope.edgeSnap.end);
  }

  function wheelExcludedFromWrap(wheel, excludeIds) {
    return !!(excludeIds && wheel?.id && excludeIds.has(wheel.id));
  }

  function edgePointFromSnap(snap) {
    if (!snap) return null;
    if (isPulleyCenterSnap(snap)) {
      const c = getPulleyCenterWorld(snap.pulleyId);
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

  /** Přichycení ke středu kladky (červená i modrá). */
  function findPulleyCenterSnapTarget(p) {
    let best = null;
    for (const wheel of collectWheels()) {
      const center = { x: wheel.cx, y: wheel.cy };
      const d = dist(p, center);
      if (d > pulleyCenterSnapRadius(wheel)) continue;
      if (!best || d < best.d) {
        best = {
          type: "pulleyCenter",
          pulleyId: wheel.id,
          kind: wheel.kind,
          point: center,
          d,
        };
      }
    }
    return best;
  }

  function findWeightHookSnapTarget(p) {
    let best = null;
    let bestDist = CLOSE_SNAP_RADIUS;
    for (const weight of weights) {
      if (!weight.el.isConnected || isDocked(weight.el)) continue;
      if (weight.snap.type !== "free") continue;
      const hook = getWeightHookWorld(weight);
      const d = dist(p, hook);
      if (d <= bestDist) {
        bestDist = d;
        best = { type: "weight", weight, point: { ...hook }, d };
      }
    }
    return best;
  }

  function findWinchHookSnapTarget(p) {
    let best = null;
    let bestDist = CLOSE_SNAP_RADIUS;
    for (const winch of winches) {
      if (!winch.el.isConnected || isDocked(winch.el)) continue;
      if (winch.snap.type !== "free") continue;
      const hook = getWinchHookWorld(winch);
      const d = dist(p, hook);
      if (d <= bestDist) {
        bestDist = d;
        best = { type: "winch", winch, point: { ...hook }, d };
      }
    }
    return best;
  }

  function snapTargetDistance(p, snap) {
    if (!snap) return Infinity;
    if (snap.d != null) return snap.d;
    if (snap.type === "edge" || snap.edge) {
      return snap.edge === "top" || snap.edge === "bottom"
        ? Math.abs(p.y - snap.point.y)
        : Math.abs(p.x - snap.point.x);
    }
    return dist(p, snap.point);
  }

  function findFixedCenterSnapTarget(p) {
    return findPulleyCenterSnapTarget(p);
  }

  /**
   * Kotva pro konec lana: nejbližší střed kladky, háček závaží nebo okraj.
   */
  function findAnchorSnapTarget(p) {
    const candidates = [
      findPulleyCenterSnapTarget(p),
      findEdgeSnapTarget(p),
      findWeightHookSnapTarget(p),
      findWinchHookSnapTarget(p),
    ].filter(Boolean);
    if (!candidates.length) return null;
    candidates.sort(
      (a, b) => snapTargetDistance(p, a) - snapTargetDistance(p, b)
    );
    return candidates[0];
  }

  /** Kotva pro volný konec tužky — stejné cíle jako u nástroje Lano. */
  function findFreehandEndpointSnapTarget(p) {
    return findAnchorSnapTarget(p);
  }

  /**
   * Při tažení konce upevněného k okraji: sleduj jen okraje, ne skok na střed kladky.
   * Jinak vrátí běžný findAnchorSnapTarget.
   */
  function snapTargetForAttachedEnd(p, attachedSnap) {
    if (!attachedSnap) return findAnchorSnapTarget(p);
    if (isScreenEdgeSnap(attachedSnap)) {
      return findEdgeSnapTarget(p);
    }
    return findAnchorSnapTarget(p);
  }

  function normalizeEndSnap(snap) {
    if (!snap) return null;
    if (isPulleyCenterSnap(snap)) {
      return {
        type: "pulleyCenter",
        pulleyId: snap.pulleyId || null,
      };
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

  function isScreenEdgeSnap(snap) {
    return !!(snap && (snap.type === "edge" || snap.edge));
  }

  /** Konec lana je přichycen (okraj stage nebo střed kladky). */
  function isRopeEndSnapped(rope, which) {
    ensureRopeEdgeSnap(rope);
    return rope.edgeSnap[which] != null;
  }

  /** Konec lana je upevněn k okraji obrazovky. */
  function isRopeEndOnEdge(rope, which) {
    ensureRopeEdgeSnap(rope);
    return isScreenEdgeSnap(rope.edgeSnap[which]);
  }

  /**
   * Konec může nést tah: okraj stage, naviják, nebo střed pevné kladky.
   * Volná kladka a volný konec lana nejsou kotva.
   */
  function isRopeEndAnchored(rope, which) {
    if (winchOnRopeEnd(rope, which)) return true;
    if (isRopeEndOnEdge(rope, which)) return true;
    ensureRopeEdgeSnap(rope);
    const snap = rope.edgeSnap[which];
    if (!isPulleyCenterSnap(snap) || !snap.pulleyId) return false;
    const pulley = findPulleyById(snap.pulleyId);
    return !!(pulley && pulley.kind === "fixed" && !isDocked(pulley.el));
  }

  function ropeHasAnchoredEnd(rope) {
    return isRopeEndAnchored(rope, "start") || isRopeEndAnchored(rope, "end");
  }

  /** Lano obepíná pevnou kladku — drží napětí i když oba konce nesou závaží. */
  function ropeWrapsFixedWheel(rope, model) {
    if (model?.wraps?.some((w) => w.wheelKind === "fixed")) return true;
    if (rope?.wrapIds) {
      for (const id of rope.wrapIds) {
        const p = findPulleyById(id);
        if (p && p.kind === "fixed" && !isDocked(p.el)) return true;
      }
    }
    return false;
  }

  /** Konec lana je uvázaný ke středu (ose) volné kladky. */
  function isRopeEndOnFreePulleyCenter(rope, which) {
    ensureRopeEdgeSnap(rope);
    const snap = rope.edgeSnap[which];
    if (!isPulleyCenterSnap(snap) || !snap.pulleyId) return false;
    const pulley = findPulleyById(snap.pulleyId);
    return !!(pulley && pulley.kind === "free" && !isDocked(pulley.el));
  }

  /**
   * Konec může nést tah: okraj stage, naviják, závaží, střed pevné kladky
   * nebo osa volné kladky (ta je taky těleso s tíhou).
   * Volný konec (jen úchop) tah neudrží — napětí v laně je pak 0.
   */
  function ropeEndResistsTension(rope, which) {
    if (weightOnRopeEnd(rope, which)) return true;
    if (winchOnRopeEnd(rope, which)) return true;
    if (isRopeEndOnFreePulleyCenter(rope, which)) return true;
    return isRopeEndAnchored(rope, which);
  }

  /**
   * Lano může nést tah ve fyzice — oba konce musí něco držet
   * (kotva / závaží / naviják). Volný konec ⇒ T = 0 a soustava padá.
   */
  function ropeCanCarryTension(rope, model) {
    return (
      ropeEndResistsTension(rope, "start") &&
      ropeEndResistsTension(rope, "end")
    );
  }

  /**
   * Rameno u vstupu obepnutí míří ke startu lana, u výstupu k end.
   * Tah jen když ten konec něco drží — volný konec tah nezpůsobí.
   */
  function strandResistsTension(rope, side /* "enter"|"leave" */) {
    return ropeEndResistsTension(
      rope,
      side === "enter" ? "start" : "end"
    );
  }

  /** Synchronizuj body lana s háčky závaží přichycených ke koncům. */
  function syncRopeEndpointsFromWeights(rope) {
    for (const which of ["start", "end"]) {
      const w = weightOnRopeEnd(rope, which);
      if (!w) continue;
      const hook = getWeightHookWorld(w);
      if (which === "start") rope.points[0] = { ...hook };
      else rope.points[rope.points.length - 1] = { ...hook };
    }
  }

  /** Konec lana je přichycen (závaží, naviják, okraj nebo střed kladky). */
  function isRopeEndAttached(rope, which) {
    if (isRopeEndTaken(rope, which, null, null)) return true;
    return isRopeEndSnapped(rope, which);
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

  function strokeWrapsPulley(pts, pulleyId) {
    if (!pulleyId || !pts || pts.length < 2) return false;
    const simplified = simplify(pts, 0.9);
    const wraps = pickWrapEvents(simplified, null);
    return wraps.some((w) => {
      const id = w.wheel?.id ?? w.wheelId;
      return id === pulleyId;
    });
  }

  /** Oba konce jsou ve středech dvou různých kladek → přímé lano, bez obepnutí. */
  function isCenterToCenterRope(...snaps) {
    const centers = [];
    for (const snap of snaps) {
      const n = normalizeEndSnap(snap);
      if (!isPulleyCenterSnap(n) || !n.pulleyId) continue;
      if (!centers.includes(n.pulleyId)) centers.push(n.pulleyId);
    }
    return centers.length >= 2;
  }

  /**
   * Obepnutí kladky P hned u konce upevněného ve středu P odstraň —
   * z přimknutí jde lano rovně. Obepnutí P dál po laně (až po jiné kladce) nech.
   */
  function stripCenterAdjacentWraps(wraps, ...snaps) {
    if (!wraps?.length) return wraps || [];
    const result = wraps.slice();
    const startSnap = normalizeEndSnap(snaps[0]);
    const endSnap = normalizeEndSnap(snaps[1]);

    if (isPulleyCenterSnap(startSnap) && startSnap.pulleyId) {
      while (
        result.length &&
        (result[0].wheel?.id || result[0].wheelId) === startSnap.pulleyId
      ) {
        result.shift();
      }
    }
    if (isPulleyCenterSnap(endSnap) && endSnap.pulleyId) {
      while (
        result.length &&
        (result[result.length - 1].wheel?.id ||
          result[result.length - 1].wheelId) === endSnap.pulleyId
      ) {
        result.pop();
      }
    }
    return result;
  }

  /** Tah od středu P se dřív dotkne jiné kladky než jen P. */
  function strokeTouchesOtherPulleyFromCenter(pts, wrapIds, pulleyId) {
    if (!pulleyId) return false;
    for (const id of wrapIds || []) {
      if (id && id !== pulleyId) return true;
    }
    if (!pts || pts.length < 2) return false;
    const simplified = simplify(pts, 0.9);
    const wraps = pickWrapEvents(
      simplified.length >= 2 ? simplified : pts,
      null
    );
    return wraps.some((w) => {
      const id = w.wheel?.id ?? w.wheelId;
      return id && id !== pulleyId;
    });
  }

  /**
   * Vyloučení obepnutí u středu kladky.
   * Platí jen když od přimknutí ve středu nevede tah přes jinou kladku —
   * pak se P neobepíná a lano jde rovně ze středu.
   * Pokud tah nejdřív míří jinou kladku, P se z exclude vyřadí, aby mohlo
   * být obepnuto dál po laně; přilehlé obepnutí u středu se ořeže zvlášť.
   */
  function pulleyCenterExcludeIdsForStroke(pts, wrapIds, ...snaps) {
    const ids = pulleyCenterExcludeIds(...snaps);
    if (isCenterToCenterRope(...snaps)) return ids;

    for (const snap of snaps) {
      const normalized = normalizeEndSnap(snap);
      if (!isPulleyCenterSnap(normalized) || !normalized.pulleyId) continue;
      const pid = normalized.pulleyId;
      if (strokeTouchesOtherPulleyFromCenter(pts, wrapIds, pid)) {
        ids.delete(pid);
      }
    }
    return ids;
  }

  function isPointAtPulleyCenter(p) {
    return !!findPulleyCenterSnapTarget(p);
  }

  function wheelIsCenterAttachedEndpoint(wheel, point) {
    if (!wheel || !point) return false;
    const hub = findWheelHubAtPoint(point);
    return !!(hub && sameWheel(hub, wheel));
  }

  function distToWheelCenter(p, wheel) {
    return Math.hypot(p.x - wheel.cx, p.y - wheel.cy);
  }

  function isPointInWheelHub(p, wheel) {
    return distToWheelCenter(p, wheel) < wheel.r * WRAP_HUB_RATIO;
  }

  /** Kladka, jejíž osu bod zasahuje (konec ve středu). */
  function findWheelHubAtPoint(p) {
    let best = null;
    let bestD = Infinity;
    for (const w of collectWheels()) {
      const d = distToWheelCenter(p, w);
      if (d >= w.r * WRAP_HUB_RATIO || d >= bestD) continue;
      bestD = d;
      best = w;
    }
    return best;
  }

  /** Bod uvnitř kladky posuň na obvod — kromě míst, kde má přimknout ke středu. */
  function nudgeEndpointOffPulleyInterior(pts) {
    if (!pts || pts.length < 2) return pts;
    const result = pts.map((p) => ({ ...p }));
    for (const idx of [0, result.length - 1]) {
      if (findPulleyCenterSnapTarget(result[idx])) continue;
      const neighbor = idx === 0 ? result[1] : result[result.length - 2];
      for (const wheel of collectWheels()) {
        const dx = result[idx].x - wheel.cx;
        const dy = result[idx].y - wheel.cy;
        const d = Math.hypot(dx, dy);
        if (d >= wheel.r * 0.82) continue;
        const ang = Math.atan2(neighbor.y - wheel.cy, neighbor.x - wheel.cx);
        result[idx] = pointOnCircle(wheel, ang);
      }
    }
    return result;
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
    const ropeOn = next === "pencil";
    const freehandOn = next === "freehand";
    const moveOn = next === "move";
    const runOn = next === "run";
    if (btnMove) {
      btnMove.classList.toggle("is-active", moveOn);
      btnMove.setAttribute("aria-pressed", String(moveOn));
    }
    if (btnRope) {
      btnRope.classList.toggle("is-active", ropeOn);
      btnRope.setAttribute("aria-pressed", String(ropeOn));
    }
    if (btnFreehand) {
      btnFreehand.classList.toggle("is-active", freehandOn);
      btnFreehand.setAttribute("aria-pressed", String(freehandOn));
    }
    if (btnRun) {
      btnRun.textContent = runOn ? "Editor" : "Spustit";
      btnRun.classList.toggle("is-active", runOn);
      btnRun.classList.toggle("is-run", runOn);
      btnRun.setAttribute("aria-pressed", String(runOn));
      btnRun.setAttribute(
        "aria-label",
        runOn ? "Zpět do editoru" : "Spustit simulaci"
      );
      btnRun.title = runOn ? "Editor" : "Spustit";
    }
    if (btnErase) {
      btnErase.classList.toggle("is-active", next === "erase");
      btnErase.setAttribute("aria-pressed", String(next === "erase"));
    }
    if (next !== "move") clearPulleySelection();
    updateHistoryButtons();
    syncPulleySizeSliderState();
  }

  let discardFreehandPending = () => {};

  function setTool(next) {
    if (next === "run" && runBlocked) return;
    if (running && next !== "run") stopSimulation();
    if (next !== "freehand") discardFreehandPending();

    tool = next;
    applyToolChrome(next);

    if (next === "run") startSimulation();
    else syncRopeEndHandles();
  }

  const ROPE_STROKE_BASE = 6;
  const ROPE_STROKE_DRAFT_BASE = 5;

  let stockTrayScaleSyncing = false;

  function stockSectionInnerSize() {
    const style = getComputedStyle(stockSection);
    return {
      h:
        stockSection.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom),
      w:
        stockSection.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
    };
  }

  function syncStockTrayScale() {
    if (!stockTray || !stockScaler || !stockSection || stockTrayScaleSyncing) {
      return;
    }

    stockTrayScaleSyncing = true;
    try {
      document.documentElement.style.setProperty("--stock-tray-scale", "1");
      stockScaler.style.height = "";
      stockTray.style.marginBottom = "";

      const { h: availH, w: availW } = stockSectionInnerSize();
      const needH = stockTray.scrollHeight;
      const needW = stockTray.offsetWidth;
      if (needH < 1 || needW < 1 || availH < 1 || availW < 1) return;

      const scale = clamp(
        Math.min(1, availH / needH, availW / needW),
        0.2,
        1
      );
      const scaledH = needH * scale;

      document.documentElement.style.setProperty(
        "--stock-tray-scale",
        String(scale)
      );
      stockScaler.style.height = `${scaledH}px`;
      // transform: scale() nemění layout — záporný margin zmenší zabrané místo
      stockTray.style.marginBottom = `${scaledH - needH}px`;
    } finally {
      stockTrayScaleSyncing = false;
    }
  }

  function bindStockTrayScaleSync() {
    syncStockTrayScale();
    requestAnimationFrame(() => {
      syncStockTrayScale();
      requestAnimationFrame(syncStockTrayScale);
    });
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncStockTrayScale());
    ro.observe(stockSection);
    ro.observe(stockTray);
    if (leftPanel) ro.observe(leftPanel);
  }

  /** Globální měřítko závaží a tloušťky lana na ploše. */
  function applyGlobalStageScale(scale, opts = {}) {
    const next = clamp(scale, PULLEY_SCALE_MIN, PULLEY_SCALE_MAX);
    globalStageScale = next;
    document.documentElement.style.setProperty("--pulley-scale", String(next));
    document.documentElement.style.setProperty(
      "--end-handle-r",
      `${END_GRAB_RADIUS * next}px`
    );
    document.documentElement.style.setProperty(
      "--rope-stroke-width",
      `${ROPE_STROKE_BASE * next}px`
    );
    document.documentElement.style.setProperty(
      "--rope-stroke-width-draft",
      `${ROPE_STROKE_DRAFT_BASE * next}px`
    );
    syncRopeViewBox();

    for (const pulley of pulleys) {
      if (isDocked(pulley.el)) continue;
      applyPulleyCssScale(pulley);
    }

    if (!opts.skipRebuild) {
      rebuildAllRopes();
      syncAllWeightsToSnap();
      updateForceArrows();
    }
    syncPulleyResizeHandle();
    if (!opts.skipSlider) syncPulleySizeSliderState();
  }

  function applyPulleyCssScale(pulley, opts = {}) {
    if (!pulley || isDocked(pulley.el)) return;
    const effective = getPulleyEffectiveScale(pulley);
    const wheelBefore =
      opts.adjustPosition !== false && pulley.kind === "free"
        ? getWheelWorld(pulley.el, "free")
        : null;

    pulley.el.style.setProperty("--pulley-scale", String(effective));

    if (wheelBefore) {
      const wheelAfter = getWheelWorld(pulley.el, "free");
      const left = parseFloat(pulley.el.style.left) || 0;
      const top = parseFloat(pulley.el.style.top) || 0;
      pulley.el.style.left = `${left + (wheelBefore.cx - wheelAfter.cx)}px`;
      pulley.el.style.top = `${top + (wheelBefore.cy - wheelAfter.cy)}px`;
    } else if (
      opts.adjustPosition !== false &&
      typeof pulley.el._fixedResizeHandler === "function"
    ) {
      pulley.el._fixedResizeHandler();
    }
  }

  /** Nastaví efektivní měřítko vybrané kladky a uloží poměr vůči globálnímu. */
  function setPulleyEffectiveScale(pulley, effectiveScale) {
    if (!pulley || pulleyHasAttachedRope(pulley)) return;
    const effective = clamp(effectiveScale, PULLEY_SCALE_MIN, PULLEY_SCALE_MAX);
    pulley.relativeScale = effective / globalStageScale;
    delete pulley.scale;
    applyPulleyCssScale(pulley);
    rebuildAllRopes();
    syncAllWeightsToSnap();
    updateForceArrows();
    syncPulleySizeSliderState();
    syncPulleyResizeHandle();
  }

  function onPulleySizeSliderInput() {
    if (!pulleySizeSlider || pulleySizeSlider.disabled) return;
    runBlocked = false;
    updateHistoryButtons();
    const val = Number(pulleySizeSlider.value) / 100;
    const pulley = findSelectedPulley();
    if (pulleyCanResize(pulley)) {
      setPulleyEffectiveScale(pulley, val);
    } else {
      applyGlobalStageScale(val);
    }
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
    const pulley = { el, kind, id, vel: { x: 0, y: 0 }, relativeScale: 1 };
    pulleys.push(pulley);
    stage.appendChild(el);
    applyPulleyCssScale(pulley, { adjustPosition: false });
    bindPulleySelectOnClick(el);
    return pulley;
  }

  function destroyPulley(pulleyOrEl) {
    const pulley =
      typeof pulleyOrEl === "object" && pulleyOrEl?.el
        ? pulleyOrEl
        : findPulleyByEl(pulleyOrEl);
    if (!pulley) return;
    const id = pulley.id;
    if (selectedPulleyId === id) clearPulleySelection();
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
          if (isPulleyCenterSnap(snap) && snap.pulleyId === id) {
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
    el.setAttribute("aria-label", "Závaží 10 kg");
    el.innerHTML = weightInnerHtml();
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
      spinAngle: 0,
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
    const w = winch.el.offsetWidth || 110;
    const h = winch.el.offsetHeight || 98;
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

  /** @param {"idle"|"winding"|"overload"|boolean} state */
  function setWinchWinding(winch, state) {
    let mode = "idle";
    if (state === true || state === "winding") mode = "winding";
    else if (state === "overload") mode = "overload";
    winch.winding = mode === "winding";
    winch.el.classList.toggle("is-winding", mode === "winding");
    winch.el.classList.toggle("is-overload", mode === "overload");
    syncWinchAttachedLight(winch);
    updateWinchOverloadMessage();
  }

  function syncWinchAttachedLight(winch) {
    if (!winch?.el) return;
    const attached =
      !isDocked(winch.el) &&
      !isStockTemplate(winch.el) &&
      winch.snap?.type === "rope" &&
      !!winch.snap.rope?.el?.isConnected;
    winch.el.classList.toggle("is-snapped", attached);
    winch.el.setAttribute(
      "aria-label",
      attached ? "Naviják přimknutý k lanu" : "Naviják"
    );
  }

  function updateWinchOverloadMessage() {
    if (!winchOverloadMsg) return;
    const show =
      running && winches.some((w) => w.el.classList.contains("is-overload"));
    winchOverloadMsg.classList.toggle("is-visible", show);
    winchOverloadMsg.hidden = !show;
  }

  function syncWinchToSnap(winch) {
    if (winch.dragging || isDocked(winch.el)) {
      syncWinchAttachedLight(winch);
      return;
    }
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
    syncWinchAttachedLight(winch);
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
    tpl.setAttribute("aria-label", "Závaží 10 kg — vytáhnout");
    tpl.innerHTML = weightInnerHtml();
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
    tpl.setAttribute("aria-label", "Naviják — vytáhnout");
    tpl.innerHTML = WINCH_SVG;
    stockSlotWinch.appendChild(tpl);
    return tpl;
  }

  function syncRopeViewBox() {
    const { width, height } = stageSize();
    ropeLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    ropeLayer.setAttribute("width", String(width));
    ropeLayer.setAttribute("height", String(height));
    ropeLayer.setAttribute("preserveAspectRatio", "none");
    ropeLayer.setAttribute("overflow", "visible");
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
    if (!svg) {
      return { cx: 0, cy: 0, r: 0 };
    }

    const center = svgUserToStage(svg, meta.cx, meta.cy);
    const rim = svgUserToStage(svg, meta.cx + meta.grooveR, meta.cy);
    if (center && rim) {
      return {
        cx: center.x,
        cy: center.y,
        r: Math.hypot(rim.x - center.x, rim.y - center.y),
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

  /** Posune volnou kladku tak, aby střed kola ležel v bodě stage (cx, cy). */
  function moveFreePulleyWheelTo(el, cx, cy) {
    const wheel = getWheelWorld(el, "free");
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    el.style.left = `${left + (cx - wheel.cx)}px`;
    el.style.top = `${top + (cy - wheel.cy)}px`;
  }

  /**
   * Měření kola vynucuje přepočet layoutu, ale ve fyzice se geometrie čte
   * stokrát za krok — drží se tedy v cache. Klíč se skládá jen z hodnot,
   * které se čtou bez layoutu, takže se cache sama zneplatní při jakékoli
   * změně polohy, měřítka nebo zadokování kladky.
   */
  let wheelCache = { token: null, wheels: [] };
  /** Zkušební posun jedné kladky bez zápisu do DOM (numerický gradient délky). */
  let wheelProbeOffset = null;

  function wheelCacheToken() {
    const { width, height } = stageSize();
    let token = `${Math.round(width)}x${Math.round(height)}|${globalStageScale}`;
    for (const pulley of pulleys) {
      const el = pulley.el;
      token += `;${pulley.id}|${el.isConnected ? 1 : 0}|${el.className}|${
        el.getAttribute("style") || ""
      }`;
    }
    return token;
  }

  /** Identita aktuální geometrie kol — klíč pro memoizaci odvozených výpočtů. */
  function wheelGeometryToken() {
    const base = wheelCache.token || "";
    if (!wheelProbeOffset) return base;
    return `${base}#${wheelProbeOffset.id}:${wheelProbeOffset.dx}:${wheelProbeOffset.dy}`;
  }

  function setWheelProbeOffset(offset) {
    wheelProbeOffset = offset;
  }

  function collectWheels() {
    const token = wheelCacheToken();
    if (token !== wheelCache.token) {
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
      wheelCache = { token, wheels };
    }
    if (!wheelProbeOffset) return wheelCache.wheels;
    return wheelCache.wheels.map((w) =>
      w.id === wheelProbeOffset.id
        ? {
            ...w,
            cx: w.cx + wheelProbeOffset.dx,
            cy: w.cy + wheelProbeOffset.dy,
          }
        : w
    );
  }

  function pointOnCircle(wheel, angle) {
    return {
      x: wheel.cx + wheel.r * Math.cos(angle),
      y: wheel.cy + wheel.r * Math.sin(angle),
    };
  }

  /**
   * Pásmo, ve kterém se lano přimkne k drážce. Roste s kolem — u zmenšené
   * kladky by pevných 10 px byla polovina poloměru.
   */
  function wrapAdhesionBand(wheel) {
    return Math.max(
      wheel.r * WRAP_ADHESION_BAND_RATIO,
      Math.min(WRAP_ADHESION_BAND_MIN, wheel.r * 0.25)
    );
  }

  /** Dosah přichycení konce lana k ose kladky — u malé kladky menší než obvod. */
  function pulleyCenterSnapRadius(wheel) {
    return Math.min(CLOSE_SNAP_RADIUS, Math.max(12, wheel.r * 0.6));
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

  /** Bod, ze kterého tah ke kladce přichází / kam odchází — první mimo pásmo. */
  function wheelApproachPoint(wheel, pts, fromIdx, which) {
    const outer = wheel.r + wrapAdhesionBand(wheel) + 6;
    const distTo = (p) => Math.hypot(p.x - wheel.cx, p.y - wheel.cy);

    if (which === "enter") {
      for (let i = Math.min(fromIdx, pts.length - 1); i >= 0; i -= 1) {
        if (distTo(pts[i]) >= outer) return pts[i];
      }
      return pts[0];
    }

    for (let i = Math.max(fromIdx, 0); i < pts.length; i += 1) {
      if (distTo(pts[i]) >= outer) return pts[i];
    }
    return pts[pts.length - 1];
  }

  /** Směr přiblížení / odchodu — první bod mimo pásmo obepnutí. */
  function wheelApproachAngle(wheel, pts, fromIdx, which) {
    const p = wheelApproachPoint(wheel, pts, fromIdx, which);
    return Math.atan2(p.y - wheel.cy, p.x - wheel.cx);
  }

  function arcContainsAngle(enterAng, leaveAng, clockwise, ang) {
    const total = wrapTravelRaw(enterAng, leaveAng, clockwise);
    const to = wrapTravelRaw(enterAng, ang, clockwise);
    if (Math.abs(total) < 1e-4) return false;
    if (Math.sign(total) !== Math.sign(to) && Math.abs(to) > 0.05) return false;
    if (Math.abs(to) > Math.abs(total) + 0.1) return false;
    return true;
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
    // Užší pás: lano se obepne jen při tahu těsně podél obvodu.
    const outer = wheel.r + wrapAdhesionBand(wheel);
    const farLimit = wheel.r * 2.8;
    const distTo = (p) => Math.hypot(p.x - wheel.cx, p.y - wheel.cy);
    const pointNear = points.map((p) => {
      if (isPointInWheelHub(p, wheel)) return false;
      return distTo(p) <= outer;
    });

    // Rozhoduje úsečka, ne vzorek: rychlý tah má body daleko od sebe a kladku
    // by minul, i když jde přímo podél drážky.
    const near = pointNear.slice();
    for (let i = 0; i + 1 < points.length; i += 1) {
      if (near[i] && near[i + 1]) continue;
      if (isPointInWheelHub(points[i], wheel) && isPointInWheelHub(points[i + 1], wheel)) {
        continue;
      }
      if (segmentClosestDist(points[i], points[i + 1], wheel) <= outer) {
        near[i] = true;
        near[i + 1] = true;
      }
    }

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
      if (run.end <= run.start) continue;
      if (strokeLengthInsideBand(points, run, wheel, outer) >= WRAP_MIN_BAND_LENGTH) {
        wraps.push(run);
      }
    }
    return wraps;
  }

  /**
   * Délka tahu uvnitř pásma přimknutí. Počítá se přesně z úseček, takže
   * výsledek nezávisí na tom, jak rychle uživatel kreslil.
   */
  function strokeLengthInsideBand(points, run, wheel, outer) {
    let len = 0;
    for (let i = run.start; i < run.end; i += 1) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const a = dx * dx + dy * dy;
      if (a < 1e-9) continue;
      const fx = p0.x - wheel.cx;
      const fy = p0.y - wheel.cy;
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - outer * outer;
      const disc = b * b - 4 * a * c;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = clamp((-b - sq) / (2 * a), 0, 1);
      const t1 = clamp((-b + sq) / (2 * a), 0, 1);
      if (t1 > t0) len += (t1 - t0) * Math.sqrt(a);
    }
    return len;
  }

  function wrapDirection(points, start, end, wheel) {
    if (end <= start) return "cw";

    // Rozhoduje okolí této kladky, ne konce celého lana — jinak je vodítko
    // u druhé a další kladky systematicky mimo.
    const startPt = wheelApproachPoint(wheel, points, start, "enter");
    const endPt = wheelApproachPoint(wheel, points, end, "leave");
    const enterHint = Math.atan2(startPt.y - wheel.cy, startPt.x - wheel.cx);
    const leaveHint = Math.atan2(endPt.y - wheel.cy, endPt.x - wheel.cx);

    let bestCw = true;
    let bestScore = -Infinity;
    for (const cw of [true, false]) {
      const e = tangentFromFreePoint(wheel, startPt, cw, true);
      const l = tangentFromFreePoint(wheel, endPt, cw, false);
      let score = 0;
      const travel = Math.abs(wrapTravelRaw(e, l, cw));
      if (travel < MIN_WRAP_TRAVEL - 1e-6 || travel > MAX_WRAP_TRAVEL + 1e-6) {
        score -= 10000;
      } else {
        score -= travel * 4;
      }

      const midIdx = Math.floor((start + end) / 2);
      const midAng = Math.atan2(
        points[midIdx].y - wheel.cy,
        points[midIdx].x - wheel.cx
      );
      if (arcContainsAngle(e, l, cw, midAng)) score += 40;
      if (arcContainsAngle(e, l, cw, enterHint)) score += 30;
      if (arcContainsAngle(e, l, cw, leaveHint)) score += 30;

      const enterP = pointOnCircle(wheel, e);
      const leaveP = pointOnCircle(wheel, l);
      score += tangentAlign(wheel, e, cw, startPt, enterP) * 50;
      score += tangentAlign(wheel, l, cw, leaveP, endPt) * 50;

      if (score > bestScore) {
        bestScore = score;
        bestCw = cw;
      }
    }
    return bestCw ? "cw" : "ccw";
  }

  function sameWheel(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    if (a.el && b.el) return a.el === b.el;
    return dist(a, b) < 4 && Math.abs(a.r - b.r) < 4;
  }

  function closestPointOnSegment(p0, p1, target) {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) return { x: p0.x, y: p0.y };
    const t = clamp(
      ((target.x - p0.x) * dx + (target.y - p0.y) * dy) / lenSq,
      0,
      1
    );
    return { x: p0.x + t * dx, y: p0.y + t * dy };
  }

  function segmentClosestDist(p0, p1, wheel) {
    const q = closestPointOnSegment(p0, p1, { x: wheel.cx, y: wheel.cy });
    return Math.hypot(q.x - wheel.cx, q.y - wheel.cy);
  }

  /** Úsek jde skrz kladku nebo těsně podél obvodu (má se obepnout, ne obejít). */
  function segmentTouchesWheel(p0, p1, wheel, pad = WRAP_TOUCH_PAD) {
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
  function supplementMissedWraps(pts, picked, excludeIds = null) {
    const wheels = collectWheels().filter(
      (w) => !wheelExcludedFromWrap(w, excludeIds)
    );
    for (let guard = 0; guard < wheels.length + 2; guard += 1) {
      let added = false;
      for (const wheel of wheels) {
        if (picked.some((p) => sameWheel(p.wheel, wheel))) continue;
        const ranges = freeRangesOfStroke(pts, picked);
        for (const range of ranges) {
          if (range.end - range.start < 1) continue;
          let hit = false;
          for (let i = range.start; i < range.end; i += 1) {
            if (segmentTouchesWheel(pts[i], pts[i + 1], wheel)) {
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

  function pickWrapEvents(pts, excludeIds = null) {
    const wheels = collectWheels().filter(
      (w) => !wheelExcludedFromWrap(w, excludeIds)
    );
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

    supplementMissedWraps(pts, picked, excludeIds);
    return picked;
  }

  /** Najde úsek tahu, který prochází vnitřkem / těsně podél kladky. */
  function findPiercingSpan(pts, wheel, fromIdx = 0, toIdx = pts.length - 1) {
    const lo = Math.max(0, fromIdx);
    const hi = Math.min(pts.length - 1, toIdx);
    let first = -1;
    let last = -1;
    for (let i = lo; i < hi; i += 1) {
      if (segmentTouchesWheel(pts[i], pts[i + 1], wheel)) {
        if (first < 0) first = i;
        last = i + 1;
      }
    }
    if (first < 0) {
      const distTo = (p) => Math.hypot(p.x - wheel.cx, p.y - wheel.cy);
      for (let i = lo; i <= hi; i += 1) {
        if (isPointInWheelHub(pts[i], wheel)) continue;
        if (distTo(pts[i]) < wheel.r + WRAP_POINT_PAD) {
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

  /**
   * Drží lano na kole, nebo by po oblouku sklouzlo?
   *
   * Lano umí kolo jen tlačit. Výslednice tahů obou ramen musí proto mířit
   * dovnitř oblouku (proti jeho středu). Když míří stejným směrem, jako se
   * oblouk vyklání, jde o obepnutí „přes vršek“, které by se samo rozpadlo.
   * Vrací hodnotu od −1 (pevně dosedlé) do +1 (sklouzne).
   */
  function wrapSlipMeasure(wheel, enterAng, leaveAng, clockwise, fromP, toP) {
    if (!fromP || !toP) return -1;
    const enterP = pointOnCircle(wheel, enterAng);
    const leaveP = pointOnCircle(wheel, leaveAng);
    const uIn = unitVec(enterP, fromP);
    const uOut = unitVec(leaveP, toP);
    const sx = uIn.x + uOut.x;
    const sy = uIn.y + uOut.y;
    const pull = Math.hypot(sx, sy);
    if (pull < 1e-6) return 0;
    const mid = enterAng + wrapTravelRaw(enterAng, leaveAng, clockwise) / 2;
    return (Math.cos(mid) * sx + Math.sin(mid) * sy) / pull;
  }

  /** Sklouzlo by lano z takto vedeného oblouku? */
  function wrapWouldSlip(wheel, enterAng, leaveAng, clockwise, fromP, toP) {
    return (
      wrapSlipMeasure(wheel, enterAng, leaveAng, clockwise, fromP, toP) > 0.05
    );
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

  function strokeHintAngle(pts, index, wheel, which = "enter") {
    return wheelApproachAngle(wheel, pts, index, which);
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
          strokeHintAngle(pts, a.end, a.wheel, "leave"),
          strokeHintAngle(pts, b.start, b.wheel, "enter"),
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
            strokeHintAngle(pts, a.end, a.wheel, "leave"),
            strokeHintAngle(pts, b.start, b.wheel, "enter"),
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
          enterAng[i] = strokeHintAngle(pts, wraps[i].start, wraps[i].wheel, "enter");
        }
        if (leaveAng[i] == null) {
          leaveAng[i] = strokeHintAngle(pts, wraps[i].end, wraps[i].wheel, "leave");
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
        } else if (travel > LONG_WRAP_TRAVEL) {
          // Nad půlkruhem je OK (volná kladka v oku), kratší oblouk je běžnější
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
        if (
          wrapWouldSlip(w.wheel, enterAng[i], leaveAng[i], cws[i], fromP, toP)
        ) {
          score -= 6000;
        }
      }
      return { score, enterAng, leaveAng, cws: cws.slice() };
    }

    // Vyzkoušej kombinace smyslu oblouku
    const hint = wraps.map((w) => w.clockwise);
    let best = null;
    const limit = Math.min(n, MAX_WRAP_DIRECTION_SEARCH);
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
  function ensureWrapsAgainstCrossing(pts, wraps, excludeIds = null) {
    const wheels = collectWheels().filter(
      (w) => !wheelExcludedFromWrap(w, excludeIds)
    );
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
            segmentTouchesWheel(seg.a, seg.b, wheel)
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
              segmentTouchesWheel(pts[i], pts[i + 1], wheel)
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

  /** Úsek tahu nejblíž ke kolu — náhrada rozpětí, když detekce nic nenašla. */
  function nearestStrokeSpan(pts, wheel) {
    if (!pts || pts.length < 2) return { start: 0, end: 1 };
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const d = Math.hypot(pts[i].x - wheel.cx, pts[i].y - wheel.cy);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const start = Math.max(0, Math.min(bestIdx - 1, pts.length - 2));
    return { start, end: Math.min(pts.length - 1, start + 2) };
  }

  /**
   * Lepkavé obepnutí — jednou detekovaná kladka zůstane, i když je kurzor už daleko
   * (simplify jinak wrap zahodí a lano „odskočí“).
   */
  function wrapsFromStickyIds(pts, stickyIds, detected = []) {
    if (!stickyIds || !stickyIds.length) return [];
    const wheels = collectWheels();
    const out = [];
    for (const id of stickyIds) {
      const wheel = wheels.find((w) => w.id === id);
      if (!wheel) continue;
      if (out.some((w) => sameWheel(w.wheel, wheel))) continue;
      // Rozpětí v tahu je vodítkem pro směr oblouku i pro polohu volných
      // úseků — vymyšlené indexy z něj dělají nesmysl.
      const found = detected.find((w) => sameWheel(w.wheel, wheel));
      const span = found || nearestStrokeSpan(pts, wheel);
      out.push({
        start: span.start,
        end: span.end,
        wheel,
        clockwise: found ? found.clockwise : true,
        detected: !!found,
      });
    }
    return out;
  }

  function mergeStickyWraps(pts, wraps, stickyIds) {
    if (!stickyIds || !stickyIds.length) return wraps;
    const sticky = wrapsFromStickyIds(pts, stickyIds, wraps);
    if (!sticky.length) return wraps;
    // Pořadí podle tahu bere jen tehdy, když detekce našla všechna rozpětí;
    // u kladky odtažené od tahu je odhad rozpětí nejistý.
    if (sticky.every((w) => w.detected)) {
      sticky.sort((a, b) => a.start - b.start || a.end - b.end);
    }
    return sticky;
  }

  function buildRopePath(
    rawPoints,
    closed = false,
    stickyIds = null,
    excludeIds = null,
    opts = {}
  ) {
    if (rawPoints.length < 2) return pointsToPolyline(rawPoints);

    const exclude =
      excludeIds instanceof Set
        ? excludeIds
        : new Set(excludeIds || []);

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

    const sticky = (stickyIds || []).filter((id) => !exclude.has(id));
    let wraps;
    if (opts.preserveWraps) {
      wraps = sticky.length ? mergeStickyWraps(pts, [], sticky) : [];
    } else {
      wraps = pickWrapEvents(pts, exclude);
      if (!sticky.length) {
        wraps = ensureWrapsAgainstCrossing(pts, wraps, exclude);
      }
      // Lepkavé kladky mají přednost — nenech wrap zmizet ve vzdálenosti
      wraps = mergeStickyWraps(pts, wraps, sticky);
    }
    wraps = wraps.filter((w) => !wheelExcludedFromWrap(w.wheel, exclude));
    wraps = stripCenterAdjacentWraps(
      wraps,
      opts.edgeSnap?.start,
      opts.edgeSnap?.end
    );

    if (!wraps.length) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      // Při zachování tvaru nepřidávej nové obepnutí z průchodu diskem
      if (!opts.preserveWraps) {
        const hitWheel = collectWheels().find(
          (w) =>
            !wheelExcludedFromWrap(w, exclude) &&
            !wheelIsCenterAttachedEndpoint(w, a) &&
            !wheelIsCenterAttachedEndpoint(w, b) &&
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
      }
      if (closed) return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} Z`;
      return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} L${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }

    let geom = solveWrapGeometry(wraps, pts, closed);

    // Po vyřešení: volné úseky nesmí jít skrz cizí kladku
    {
      const allWheels = collectWheels().filter(
        (w) => !wheelExcludedFromWrap(w, exclude)
      );
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
      const extraIds = sticky.slice();
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
        wraps = wraps.filter((w) => !wheelExcludedFromWrap(w.wheel, exclude));
        wraps = stripCenterAdjacentWraps(
          wraps,
          opts.edgeSnap?.start,
          opts.edgeSnap?.end
        );
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
  function computeRopeModel(rope, opts = {}) {
    let pts = simplify(rope.points, 0.9);
    if (pts.length < 2) pts = rope.points.slice();

    const exclude = pulleyCenterExcludeIdsForStroke(
      pts,
      rope.wrapIds,
      rope.edgeSnap.start,
      rope.edgeSnap.end
    );
    const sticky = (rope.wrapIds || rope.wrapKinds || []).filter(
      (id) => !exclude.has(id)
    );

    let wraps;
    if (opts.preserveWraps) {
      // Neměň topologii (např. po přimknutí navijáku) — jen sticky / žádné obepnutí
      wraps = sticky.length ? mergeStickyWraps(pts, [], sticky) : [];
    } else {
      wraps = pickWrapEvents(pts, exclude);
      if (!sticky.length) {
        wraps = ensureWrapsAgainstCrossing(pts, wraps, exclude);
      }
      wraps = mergeStickyWraps(pts, wraps, sticky);
    }
    wraps = wraps.filter((w) => !wheelExcludedFromWrap(w.wheel, exclude));
    wraps = stripCenterAdjacentWraps(
      wraps,
      rope.edgeSnap?.start,
      rope.edgeSnap?.end
    );

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
    // Konkrétní kladka se nenahrazuje jinou téhož druhu — po smazání kladky
    // by lano potichu přeskočilo na cizí kolo. Druh slouží jen starším scénám
    // bez id.
    if (ref.wheelId) {
      return wheels.find((w) => w.id === ref.wheelId) || null;
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

    // Stejný model se stejnými konci se ptá opakovaně (délka, tečny, kreslení)
    const memoKey = `${wheelGeometryToken()}|${startPt.x.toFixed(
      2
    )},${startPt.y.toFixed(2)}|${endPt.x.toFixed(2)},${endPt.y.toFixed(2)}|${model.wraps
      .map((w) => `${w.wheelId}:${w.clockwise ? 1 : 0}`)
      .join(",")}`;
    if (model.liveMemoKey === memoKey) return model.liveMemo;

    const wheels = model.wraps.map((w) => resolveModelWheel(w));
    if (wheels.some((w) => !w)) {
      model.liveMemoKey = memoKey;
      model.liveMemo = null;
      return null;
    }

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
        } else if (travel > LONG_WRAP_TRAVEL) {
          score -= (travel - Math.PI) * 8;
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

        // Lano musí na kolo dosednout, ne po něm sklouznout
        if (
          wrapWouldSlip(wheels[i], enterAng[i], leaveAng[i], cws[i], fromP, toP)
        ) {
          score -= 6000;
        }

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
    const limit = Math.min(n, MAX_WRAP_DIRECTION_SEARCH);
    const total = 1 << limit;
    for (let mask = 0; mask < total; mask += 1) {
      const cws = hint.slice();
      for (let i = 0; i < limit; i += 1) {
        if (mask & (1 << i)) cws[i] = !hint[i];
      }
      const cand = scoreCws(cws);
      if (!best || cand.score > best.score) best = cand;
    }
    model.liveMemoKey = memoKey;
    model.liveMemo = best;
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
      const hubWheel = findWheelHubAtPoint(endPt);
      if (
        hubWheel &&
        pen &&
        !isPointAtPulleyCenter(endPt) &&
        segmentCrossesWheel(pen, endPt, hubWheel, 1)
      ) {
        const ang = Math.atan2(pen.y - hubWheel.cy, pen.x - hubWheel.cx);
        lineTo(pointOnCircle(hubWheel, ang));
      }
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

  /**
   * Zkrať geometrii lana na restLength.
   * Pevné konce (naviják / okraj) se nehýbou — posouvá se jen volný konec.
   */
  function enforceRopeLength(model, startPt, endPt, restLength, opts = {}) {
    let s = { x: startPt.x, y: startPt.y };
    let e = { x: endPt.x, y: endPt.y };
    const startFixed = !!opts.startFixed;
    const endFixed = !!opts.endFixed;

    for (let i = 0; i < 12; i += 1) {
      const L = measureModelLength(model, s, e);
      if (L <= restLength + 0.5) break;
      const excess = L - restLength;
      const tang = modelTangentPoints(model, s, e);
      if (!tang) break;

      if (startFixed && endFixed) {
        // Oba konce pevné — řeší enforceRopeLengthViaFreePulley
        break;
      }
      if (startFixed) {
        e = moveToward(e, tang.end, excess);
        continue;
      }
      if (endFixed) {
        s = moveToward(s, tang.start, excess);
        continue;
      }

      const legA = dist(s, tang.start);
      const legB = dist(tang.end, e);
      const total = legA + legB + 1e-6;
      s = moveToward(s, tang.start, excess * (legA / total));
      e = moveToward(e, tang.end, excess * (legB / total));
    }

    return { start: s, end: e };
  }

  function ropeEndIsFixed(rope, which) {
    if (winchOnRopeEnd(rope, which)) return true;
    if (weightOnRopeEnd(rope, which)) return false;
    // Konec na ose volné kladky řídí těleso kladky, ne zkracování lana
    if (isRopeEndOnFreePulleyCenter(rope, which)) return true;
    return isRopeEndAnchored(rope, which);
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
    const nextTop = (parseFloat(el.style.top) || 0) + dy;
    el.style.top = `${running ? Math.max(0, nextTop) : clamp(nextTop, 0, maxTop)}px`;
  }

  /**
   * Když jsou oba konce lana pevné (naviják / okraj / osa volné kladky),
   * enforceRopeLength nemůže nic zkrátit — přebytek délky rozdělí mezi volné
   * kladky podle jejich vlastních gradientů délky (nejmenší nutný posun).
   */
  function enforceRopeLengthViaFreePulley(
    model,
    startPt,
    endPt,
    restLength,
    freePulley,
    rope
  ) {
    const movables = getRopeMovableFreePulleys(rope, model);
    if (!movables.length) return;

    for (let i = 0; i < 10; i += 1) {
      const pts = endpointsWithPulleyCenters(rope, startPt, endPt, movables[0]);
      const L = measureModelLength(model, pts.start, pts.end);
      if (L <= restLength + 0.5) break;
      const excess = L - restLength;

      const grads = movables.map((pulley) =>
        pulleyLengthGradient(model, startPt, endPt, pulley, rope)
      );
      let g2 = 0;
      for (const g of grads) g2 += g.x * g.x + g.y * g.y;
      if (g2 < 1e-8) break;

      const lambda = excess / g2;
      for (let k = 0; k < movables.length; k += 1) {
        setFreePulleyPositionDelta(
          movables[k],
          -lambda * grads[k].x,
          -lambda * grads[k].y
        );
        syncRodWeightForPulley(movables[k], null);
      }
      rebuildAllRopes();
    }
  }

  /** Gradient délky lana podle polohy jedné volné kladky. */
  function pulleyLengthGradient(model, startPt, endPt, pulley, rope) {
    return numericalLengthGradient(model, startPt, endPt, {
      pulleyFree: true,
      pulleyEl: pulley.el,
      rope,
    }).pulley;
  }

  function initRopeSimulation() {
    for (const rope of ropes) {
      if (rope.closed || !rope.el.isConnected) {
        delete rope.sim;
        continue;
      }
      const model = computeRopeModel(rope);
      const startPt = { ...getRopeSimEndpoint(rope, "start") };
      const endPt = { ...getRopeSimEndpoint(rope, "end") };
      const restLength = measureModelLength(model, startPt, endPt);
      if (restLength < 1) {
        delete rope.sim;
        continue;
      }
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

    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const startWinch = winchOnRopeEnd(rope, "start");
    const endWinch = winchOnRopeEnd(rope, "end");

    const corrected = enforceRopeLength(model, startPt, endPt, restLength, {
      startFixed: ropeEndIsFixed(rope, "start"),
      endFixed: ropeEndIsFixed(rope, "end"),
    });

    if (startWinch) {
      corrected.start = getWinchHookWorld(startWinch);
    } else if (isRopeEndSnapped(rope, "start") && !startW) {
      corrected.start = getRopeEndPoint(rope, "start");
    }
    if (endWinch) {
      corrected.end = getWinchHookWorld(endWinch);
    } else if (isRopeEndSnapped(rope, "end") && !endW) {
      corrected.end = getRopeEndPoint(rope, "end");
    }

    rope.sim.startPt = { ...corrected.start };
    rope.sim.endPt = { ...corrected.end };

    if (startW) {
      placeWeightAtHook(startW, {
        x: corrected.start.x,
        y: corrected.start.y,
      });
      rope.points[0] = { ...corrected.start };
    } else if (startWinch) {
      rope.points[0] = { ...corrected.start };
    } else if (isRopeEndSnapped(rope, "start")) {
      syncRopeEdgePoint(rope, "start");
    } else {
      rope.points[0] = { ...corrected.start };
    }

    if (endW) {
      placeWeightAtHook(endW, {
        x: corrected.end.x,
        y: corrected.end.y,
      });
      rope.points[rope.points.length - 1] = { ...corrected.end };
    } else if (endWinch) {
      rope.points[rope.points.length - 1] = { ...corrected.end };
    } else if (isRopeEndSnapped(rope, "end")) {
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
    const startSnapped =
      isRopeEndSnapped(rope, "start") && !startW && !startWinch;
    const endSnapped = isRopeEndSnapped(rope, "end") && !endW && !endWinch;
    const startFixed =
      !!startWinch || (isRopeEndAnchored(rope, "start") && !startW);
    const endFixed = !!endWinch || (isRopeEndAnchored(rope, "end") && !endW);

    let startPt = startWinch
      ? getWinchHookWorld(startWinch)
      : startSnapped
        ? getRopeEndPoint(rope, "start")
        : startW
          ? getWeightHookWorld(startW)
          : { ...rope.sim.startPt };
    let endPt = endWinch
      ? getWinchHookWorld(endWinch)
      : endSnapped
        ? getRopeEndPoint(rope, "end")
        : endW
          ? getWeightHookWorld(endW)
          : { ...rope.sim.endPt };

    const corrected = enforceRopeLength(model, startPt, endPt, restLength, {
      startFixed,
      endFixed,
    });

    if (startWinch) corrected.start = getWinchHookWorld(startWinch);
    else if (startSnapped) corrected.start = getRopeEndPoint(rope, "start");
    else if (startW) corrected.start = getWeightHookWorld(startW);
    if (endWinch) corrected.end = getWinchHookWorld(endWinch);
    else if (endSnapped) corrected.end = getRopeEndPoint(rope, "end");
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

  /**
   * Lomená čára lana: konce + tečné body obepnutí. Obepnutí s nedostupnou
   * kladkou (smazaná za běhu) se přeskočí, aby indexy zůstaly konzistentní.
   */
  function modelChain(model, startPt, endPt) {
    const pts = [startPt];
    const items = [];
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
      items.push({
        wrap: w,
        wheel,
        enterIdx: pts.length,
        enterAng,
        leaveAng,
        clockwise,
      });
      pts.push(
        pointOnCircle(wheel, enterAng),
        pointOnCircle(wheel, leaveAng)
      );
    }
    pts.push(endPt);
    return { pts, items };
  }

  /** Směry napětí v laně u konců a u volné kladky (bez změny obepnutí). */
  function getRopeAttachmentVectors(model, startPt, endPt) {
    const { pts: chain, items } = modelChain(model, startPt, endPt);

    const startU = unitVec(chain[0], chain[1]);
    const endU = unitVec(chain[chain.length - 1], chain[chain.length - 2]);

    let freeEnterU = { x: 0, y: 0 };
    let freeLeaveU = { x: 0, y: 0 };
    let freeEnterPt = null;
    let freeLeavePt = null;

    /** Body dotyku lana s každou kladkou + směr tahu na kladku. */
    const contacts = [];
    for (const item of items) {
      const prev = chain[item.enterIdx - 1];
      const enter = chain[item.enterIdx];
      const leave = chain[item.enterIdx + 1];
      const next = chain[item.enterIdx + 2];
      const enterU = unitVec(prev, enter);
      const leaveU = unitVec(leave, next);
      contacts.push({
        wheelKind: item.wrap.wheelKind,
        wheelId: item.wrap.wheelId,
        enterPt: { x: enter.x, y: enter.y },
        leavePt: { x: leave.x, y: leave.y },
        /** Síla lana na kladku u vstupu (směr od kladky po laně ven). */
        enterPull: { x: -enterU.x, y: -enterU.y },
        leavePull: { x: leaveU.x, y: leaveU.y },
      });
      if (item.wrap.wheelKind === "free" && !freeEnterPt) {
        freeEnterU = enterU;
        freeLeaveU = leaveU;
        freeEnterPt = { x: enter.x, y: enter.y };
        freeLeavePt = { x: leave.x, y: leave.y };
      }
    }

    return {
      startU,
      endU,
      freeEnterU,
      freeLeaveU,
      freeEnterPt,
      freeLeavePt,
      contacts,
    };
  }

  function vecDot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  /** Když je konec lana na středu dané kladky, vrať aktuální střed. */
  function endpointIfPulleyCenter(rope, which, pulley) {
    if (!rope || !pulley) return null;
    const snap = rope.edgeSnap?.[which];
    if (!isPulleyCenterSnap(snap)) return null;
    if (snap.pulleyId && snap.pulleyId !== pulley.id) return null;
    const c = getPulleyCenterWorld(snap.pulleyId || pulley.id);
    return c ? { x: c.x, y: c.y } : null;
  }

  function endpointsWithPulleyCenters(rope, startPt, endPt, pulley) {
    return {
      start: endpointIfPulleyCenter(rope, "start", pulley) || startPt,
      end: endpointIfPulleyCenter(rope, "end", pulley) || endPt,
    };
  }

  function numericalLengthGradient(model, startPt, endPt, opts) {
    const eps = 1.5;
    const rope = opts.rope || null;
    const pulley = opts.pulleyEl ? findPulleyByEl(opts.pulleyEl) : null;
    const basePts = endpointsWithPulleyCenters(rope, startPt, endPt, pulley);
    const base = measureModelLength(model, basePts.start, basePts.end);
    const grad = {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      pulley: { x: 0, y: 0 },
    };

    if (opts.startFree) {
      grad.start.x =
        (measureModelLength(
          model,
          { x: startPt.x + eps, y: startPt.y },
          endPt
        ) -
          base) /
        eps;
      grad.start.y =
        (measureModelLength(
          model,
          { x: startPt.x, y: startPt.y + eps },
          endPt
        ) -
          base) /
        eps;
    }
    if (opts.endFree) {
      grad.end.x =
        (measureModelLength(model, startPt, {
          x: endPt.x + eps,
          y: endPt.y,
        }) -
          base) /
        eps;
      grad.end.y =
        (measureModelLength(model, startPt, {
          x: endPt.x,
          y: endPt.y + eps,
        }) -
          base) /
        eps;
    }
    // Kladkou se hýbe jen v cache geometrie — zápis do DOM by na každý gradient
    // vynutil přepočet layoutu.
    if (opts.pulleyFree && pulley) {
      setWheelProbeOffset({ id: pulley.id, dx: eps, dy: 0 });
      {
        const pts = endpointsWithPulleyCenters(rope, startPt, endPt, pulley);
        const movedX = measureModelLength(model, pts.start, pts.end);
        grad.pulley.x = (movedX - base) / eps;
      }
      setWheelProbeOffset({ id: pulley.id, dx: 0, dy: eps });
      {
        const pts = endpointsWithPulleyCenters(rope, startPt, endPt, pulley);
        const movedY = measureModelLength(model, pts.start, pts.end);
        grad.pulley.y = (movedY - base) / eps;
      }
      setWheelProbeOffset(null);
    }

    return grad;
  }

  /**
   * Síla lana na volnou kladku: obepnutí (tečny) nebo tah za střed, pokud
   * je konec lana přimknutý k ose.
   */
  function freePulleyRopeForceUnit(attach, rope, freePulley) {
    let fx = 0;
    let fy = 0;
    // Každé obepnutí přidá dvě ramena — kladka může být obepnutá i víckrát
    for (const contact of freePulleyContacts(attach, freePulley)) {
      fx += contact.enterPull.x + contact.leavePull.x;
      fy += contact.enterPull.y + contact.leavePull.y;
    }
    if (endpointIfPulleyCenter(rope, "start", freePulley)) {
      fx += attach.startU.x;
      fy += attach.startU.y;
    }
    if (endpointIfPulleyCenter(rope, "end", freePulley)) {
      fx += attach.endU.x;
      fy += attach.endU.y;
    }
    return { x: fx, y: fy };
  }

  /**
   * Všechny dotyky lana s danou volnou kladkou. Geometrie zatím dovolí jedno
   * obepnutí na kladku a lano, takže víc dotyků vzniká jen z různých lan;
   * součet je připravený i na vícenásobné obepnutí jedním lanem.
   */
  function freePulleyContacts(attach, freePulley) {
    if (!freePulley || !attach?.contacts?.length) return [];
    return attach.contacts.filter(
      (c) => c.wheelKind === "free" && c.wheelId === freePulley.id
    );
  }

  /**
   * Počet závaží nesených daným závažím (včetně něj). Zavěšená i postavená
   * vedle se pohybují s ním, takže zatěžují stejné lano.
   */
  function countAttachedWeights(root) {
    if (!root?.el?.isConnected) return 0;
    let count = 1;
    for (const w of weights) {
      if (w !== root && w.snap.type === "weight" && w.snap.weight === root) {
        count += countAttachedWeights(w);
      }
    }
    return count;
  }

  function massOfWeightStack(weight) {
    return countAttachedWeights(weight) * WEIGHT_MASS;
  }

  function setFreePulleyPositionDelta(pulley, dx, dy) {
    const el = pulley?.el;
    if (!el || isDocked(el)) return;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
    const { width, height } = stageSize();
    const maxLeft = Math.max(0, width - el.offsetWidth);
    const maxTop = Math.max(0, height - el.offsetHeight);
    const left = clamp(parseFloat(el.style.left) + dx, 0, maxLeft);
    const nextTop = parseFloat(el.style.top) + dy;
    const top = running ? Math.max(0, nextTop) : clamp(nextTop, 0, maxTop);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function syncRodWeightForPulley(pulley, vel) {
    const rodW = weights.find(
      (w) => w.snap.type === "rod" && w.snap.pulley === pulley.el
    );
    if (!rodW) return;
    if (vel) {
      rodW.vel.x = vel.x;
      rodW.vel.y = vel.y;
    }
    const rod = getFreeRodEnd(pulley.el);
    if (rod) placeWeightAtHook(rodW, rod);
  }

  /** Všechny volné kladky, které lano obepíná (v pořadí podél lana). */
  function getRopeFreePulleys(rope, model) {
    const result = [];
    const seen = new Set();
    const wraps = model?.wraps || [];
    for (const wrap of wraps) {
      if (wrap.wheelKind !== "free") continue;
      const wheel = resolveModelWheel(wrap);
      let pulley = null;
      if (wheel?.el) pulley = findPulleyByEl(wheel.el);
      else if (wrap.wheelId) pulley = findPulleyById(wrap.wheelId);
      if (pulley && !isDocked(pulley.el) && !seen.has(pulley.id)) {
        seen.add(pulley.id);
        result.push(pulley);
      }
    }
    if (rope?.wrapIds) {
      for (const id of rope.wrapIds) {
        if (seen.has(id)) continue;
        const pulley = findPulleyById(id);
        if (pulley && pulley.kind === "free" && !isDocked(pulley.el)) {
          seen.add(id);
          result.push(pulley);
        }
      }
    }
    return result;
  }

  /**
   * Volné kladky nesené lanem — obepnuté i ty, ke kterým je lano uvázané
   * za osu (pohyblivý blok kladkostroje).
   */
  function getRopeMovableFreePulleys(rope, model) {
    const list = getRopeFreePulleys(rope, model);
    const seen = new Set(list.map((p) => p.id));
    ensureRopeEdgeSnap(rope);
    for (const which of ["start", "end"]) {
      const snap = rope.edgeSnap[which];
      if (!isPulleyCenterSnap(snap) || !snap.pulleyId) continue;
      if (seen.has(snap.pulleyId)) continue;
      const pulley = findPulleyById(snap.pulleyId);
      if (!pulley || pulley.kind !== "free" || isDocked(pulley.el)) continue;
      seen.add(pulley.id);
      list.push(pulley);
    }
    return list;
  }

  function freePulleyMass(pulleyEl) {
    if (!pulleyEl) return PULLEY_MASS;
    const rodW = weights.find(
      (w) => w.snap.type === "rod" && w.snap.pulley === pulleyEl
    );
    if (!rodW) return PULLEY_MASS;
    return PULLEY_MASS + massOfWeightStack(rodW);
  }

  function getRopeFreePulley(rope, model) {
    const movables = getRopeMovableFreePulleys(rope, model);
    if (movables.length) return movables[0];
    const all = getRopeFreePulleys(rope, model);
    if (all.length) return all[0];
    if (rope?.edgeSnap) {
      for (const which of ["start", "end"]) {
        const snap = rope.edgeSnap[which];
        if (!isPulleyCenterSnap(snap) || !snap.pulleyId) continue;
        const p = findPulleyById(snap.pulleyId);
        if (p && p.kind === "free" && !isDocked(p.el)) return p;
      }
    }
    return null;
  }

  /**
   * Podmínka konstantní délky pro jedno lano: pro každé volné těleso (závaží
   * na konci, pohyblivá kladka) gradient délky a jednotkový tah lana.
   * Napětí se pak řeší pro všechna lana najednou — jedna kladka může viset
   * na víc lanech.
   */
  function buildRopeConstraint(rope, model, startPt, endPt, bodies) {
    const attach = getRopeAttachmentVectors(model, startPt, endPt);
    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const startMass = startW ? massOfWeightStack(startW) : 0;
    const endMass = endW ? massOfWeightStack(endW) : 0;
    const endGrad = numericalLengthGradient(model, startPt, endPt, {
      startFree: !!startW,
      endFree: !!endW,
      pulleyFree: false,
      rope,
    });

    const terms = [];
    const termByObj = new Map();
    const addTerm = (term) => {
      terms.push(term);
      termByObj.set(term.obj, term);
      if (bodies && !bodies.has(term.obj)) {
        bodies.set(term.obj, {
          kind: term.kind,
          obj: term.obj,
          mass: term.mass,
          force: { x: 0, y: 0 },
          accel: { x: 0, y: 0 },
        });
      }
    };

    if (startW && startMass > 1e-8) {
      addTerm({
        kind: "weight",
        obj: startW,
        which: "start",
        mass: startMass,
        grad: endGrad.start,
        u: attach.startU,
      });
    }
    if (endW && endMass > 1e-8) {
      addTerm({
        kind: "weight",
        obj: endW,
        which: "end",
        mass: endMass,
        grad: endGrad.end,
        u: attach.endU,
      });
    }

    const freePulleys = getRopeMovableFreePulleys(rope, model);
    for (const pulley of freePulleys) {
      const mass = Math.max(freePulleyMass(pulley.el), MIN_BODY_MASS);
      addTerm({
        kind: "pulley",
        obj: pulley,
        mass,
        grad: pulleyLengthGradient(model, startPt, endPt, pulley, rope),
        u: freePulleyRopeForceUnit(attach, rope, pulley),
        contacts: freePulleyContacts(attach, pulley),
      });
    }

    const length = measureModelLength(model, startPt, endPt);
    const restLength = rope.sim?.restLength;
    // Prověšené lano netáhne — napětí drží jen napnuté lano
    const slack = restLength != null && length < restLength - ROPE_SLACK_TOL;

    return {
      rope,
      model,
      startPt,
      endPt,
      attach,
      terms,
      termByObj,
      freePulleys,
      length,
      slack,
      canCarry: ropeCanCarryTension(rope, model),
      tension: 0,
    };
  }

  /**
   * Osa zátěže tělesa — směr nejsilnějšího tahu lana. Jen podél ní se
   * nezatížená kladka chová jako nehmotná.
   */
  function assignBodyAxes(constraints, bodies) {
    for (const body of bodies.values()) {
      body.light = body.mass <= MIN_BODY_MASS * 1.001;
      body.axis = null;
      if (!body.light) continue;
      let longest = 0;
      for (const c of constraints) {
        const term = c.termByObj.get(body.obj);
        if (!term) continue;
        const len = Math.hypot(term.u.x, term.u.y);
        if (len > longest) {
          longest = len;
          body.axis = { x: term.u.x / len, y: term.u.y / len };
        }
      }
    }
  }

  /** Zrychlení od síly: M⁻¹·F, u nezatížené kladky směrově odlišené. */
  function accelFromForce(body, f) {
    if (!body?.light || !body.axis) {
      return { x: f.x / body.mass, y: f.y / body.mass };
    }
    const along = f.x * body.axis.x + f.y * body.axis.y;
    const ax = along * body.axis.x;
    const ay = along * body.axis.y;
    return {
      x: ax / body.mass + (f.x - ax) / SWING_BODY_MASS,
      y: ay / body.mass + (f.y - ay) / SWING_BODY_MASS,
    };
  }

  /**
   * Soustava pro napětí zadané sady lan.
   * A_kl = Σ_i ∇_i L_k · M_i⁻¹ u_l,i, b_k = −Σ_i ∇_i L_k · M_i⁻¹ Fg_i.
   */
  function ropeTensionSystem(active, bodies) {
    const n = active.length;
    const A = [];
    const b = [];
    for (let k = 0; k < n; k += 1) {
      const row = new Array(n).fill(0);
      let rhs = 0;
      for (const term of active[k].terms) {
        const body = bodies?.get(term.obj) || { mass: term.mass };
        const g = accelFromForce(body, { x: 0, y: term.mass * GRAVITY });
        rhs -= vecDot(term.grad, g);
        for (let l = 0; l < n; l += 1) {
          const other = active[l].termByObj.get(term.obj);
          if (!other) continue;
          row[l] += vecDot(term.grad, accelFromForce(body, other.u));
        }
      }
      A.push(row);
      b.push(rhs);
    }
    return { A, b };
  }

  /** Gauss–Jordan s výběrem pivota. Vrací null pro singulární soustavu. */
  function solveDenseSystem(A, b) {
    const n = b.length;
    const m = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col += 1) {
      let pivot = col;
      for (let r = col + 1; r < n; r += 1) {
        if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
      }
      if (!(Math.abs(m[pivot][col]) > 1e-9)) return null;
      if (pivot !== col) {
        const tmp = m[pivot];
        m[pivot] = m[col];
        m[col] = tmp;
      }
      for (let r = 0; r < n; r += 1) {
        if (r === col) continue;
        const f = m[r][col] / m[col][col];
        if (!f) continue;
        for (let c = col; c <= n; c += 1) m[r][c] -= f * m[col][c];
      }
    }
    const x = new Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = m[i][n] / m[i][i];
      if (!Number.isFinite(x[i])) return null;
    }
    return x;
  }

  /** Záloha pro singulární soustavu — projekční Gauss–Seidel. */
  function gaussSeidelTensions(A, b) {
    const n = b.length;
    const T = new Array(n).fill(0);
    for (let iter = 0; iter < 200; iter += 1) {
      let delta = 0;
      for (let k = 0; k < n; k += 1) {
        if (Math.abs(A[k][k]) < 1e-9) {
          T[k] = 0;
          continue;
        }
        let sum = b[k];
        for (let l = 0; l < n; l += 1) {
          if (l !== k) sum -= A[k][l] * T[l];
        }
        const next = Math.max(0, sum / A[k][k]);
        delta = Math.max(delta, Math.abs(next - T[k]));
        T[k] = next;
      }
      if (delta < 1e-6) break;
    }
    return T;
  }

  /**
   * Napětí ve všech lanech současně, s podmínkou T ≥ 0 (lano jen táhne).
   *
   * Soustava bývá silně nevyvážená — pohyblivý blok bez zátěže má proti závaží
   * zanedbatelnou hmotnost, takže jeho řádky jsou o několik řádů větší. Iterace
   * by konvergovala příliš pomalu, řeší se proto přímo; lano, které by muselo
   * tlačit, se ze soustavy vyřadí a zbytek se dopočítá znovu.
   */
  function solveRopeTensions(constraints, bodies) {
    const candidates = [];
    for (const c of constraints) {
      c.tension = 0;
      if (c.canCarry && !c.slack && c.terms.length) candidates.push(c);
    }
    if (!candidates.length) return;

    let active = candidates;
    for (let guard = 0; guard <= candidates.length; guard += 1) {
      if (!active.length) return;
      const { A, b } = ropeTensionSystem(active, bodies);
      const T = solveDenseSystem(A, b) || gaussSeidelTensions(A, b);

      let worst = -1;
      let worstValue = -1e-9;
      for (let k = 0; k < T.length; k += 1) {
        if (T[k] < worstValue) {
          worstValue = T[k];
          worst = k;
        }
      }
      if (worst < 0) {
        for (let k = 0; k < active.length; k += 1) {
          active[k].tension = Math.max(0, T[k]);
        }
        return;
      }
      active = active.filter((_, k) => k !== worst);
    }
  }

  /** Všechna lana, tělesa, napětí a výsledné síly pro aktuální geometrii. */
  function buildRopeSystem() {
    const bodies = new Map();
    const constraints = [];
    for (const rope of ropes) {
      const state = getRopeForceState(rope);
      if (!state) continue;
      constraints.push(
        buildRopeConstraint(rope, state.model, state.startPt, state.endPt, bodies)
      );
    }
    assignBodyAxes(constraints, bodies);
    solveRopeTensions(constraints, bodies);

    for (const c of constraints) {
      if (c.rope.sim) c.rope.sim.tension = c.tension;
    }

    // Tíha se každému tělesu započítá jednou, tahy sečte přes všechna lana
    for (const body of bodies.values()) {
      let fx = 0;
      let fy = body.mass * GRAVITY;
      for (const c of constraints) {
        if (c.tension <= 0) continue;
        const term = c.termByObj.get(body.obj);
        if (!term) continue;
        fx += c.tension * term.u.x;
        fy += c.tension * term.u.y;
      }
      body.force = { x: fx, y: fy };
      body.accel = accelFromForce(body, body.force);
    }

    return { bodies, constraints };
  }

  function constraintForRope(system, rope) {
    return system?.constraints.find((c) => c.rope === rope) || null;
  }

  /**
   * Rovnovážný tah pro zobrazení, když lano nemůže nést napětí (volný konec).
   * Ideální volná kladka: obě ramena by nesla T = Fg/(cos θ₁ + cos θ₂);
   * rameno k volnému konci se nekreslí, takže zbude výslednice směrem dolů.
   */
  function freePulleyDisplayTension(term) {
    const gy = term.mass * GRAVITY;
    if (!(gy > 1e-8)) return 0;
    let up = 0;
    for (const contact of term.contacts || []) {
      up += Math.max(0, -contact.enterPull.y);
      up += Math.max(0, -contact.leavePull.y);
    }
    if (up < 0.05) return 0;
    return gy / up;
  }

  /** Tah pro šipky u pevných kladek a kotev, když spočítané napětí je nulové. */
  function fallbackDisplayTension(c) {
    let best = 0;
    for (const term of c.terms) {
      if (term.kind !== "pulley") continue;
      best = Math.max(best, freePulleyDisplayTension(term));
    }
    return best;
  }

  /** Stav lana pro výpočet sil — i mimo simulaci. */
  function getRopeForceState(rope) {
    if (!rope?.el?.isConnected || rope.closed) return null;
    if (rope.sim?.model) {
      return {
        model: rope.sim.model,
        startPt: { ...rope.sim.startPt },
        endPt: { ...rope.sim.endPt },
      };
    }
    syncRopeEdgePoints(rope);
    syncRopeEndpointsFromWeights(rope);
    const model = computeRopeModel(rope);
    const startPt = getRopeSimEndpoint(rope, "start");
    const endPt = getRopeSimEndpoint(rope, "end");
    if (dist(startPt, endPt) < 1e-6) return null;
    return {
      model,
      startPt: { ...startPt },
      endPt: { ...endPt },
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
    overlay.setAttribute("overflow", "visible");
  }

  function clearForceArrows() {
    if (forceLayer) forceLayer.replaceChildren();
  }

  /** Délka šipky je přímo úměrná velikosti síly (110 px na tíhu jednoho závaží). */
  function scaleForceArrow(fx, fy) {
    const mag = Math.hypot(fx, fy);
    if (mag < 1e-6) return null;
    const unit = WEIGHT_MASS * GRAVITY;
    const len = Math.min((mag / unit) * FORCE_ARROW_UNIT_LEN, FORCE_ARROW_MAX);
    if (len < 1) return null;
    return {
      x: (fx / mag) * len,
      y: (fy / mag) * len,
      len,
      mag,
    };
  }

  /** Kreslit výslednici, jen když není nulová (jinak by to byl šum). */
  function shouldDrawNetForce(nx, ny) {
    return Math.hypot(nx, ny) > WEIGHT_FORCE * 0.002;
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
    const head = clamp(scaled.len * 0.3, 5, 14);
    const hx1 = x2 - head * Math.cos(ang - 0.42);
    const hy1 = y2 - head * Math.sin(ang - 0.42);
    const hx2 = x2 - head * Math.cos(ang + 0.42);
    const hy2 = y2 - head * Math.sin(ang + 0.42);

    const shaft = document.createElementNS("http://www.w3.org/2000/svg", "line");
    shaft.classList.add("force-arrow-shaft");
    shaft.setAttribute("x1", origin.x.toFixed(1));
    shaft.setAttribute("y1", origin.y.toFixed(1));
    shaft.setAttribute("x2", x2.toFixed(1));
    shaft.setAttribute("y2", y2.toFixed(1));
    g.appendChild(shaft);

    const headEl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    headEl.classList.add("force-arrow-head");
    headEl.setAttribute(
      "points",
      `${hx1.toFixed(1)},${hy1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${hx2.toFixed(1)},${hy2.toFixed(1)}`
    );
    g.appendChild(headEl);

    const newtons = simForceToNewtons(scaled.mag);
    if (newtons >= 0.5) {
      const along = scaled.len < 36 ? 1.08 : 0.62;
      const px = origin.x + scaled.x * along;
      const py = origin.y + scaled.y * along;
      const side = scaled.len < 36 ? 0 : 13;
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.classList.add("force-arrow-label");
      label.setAttribute("x", (px - Math.sin(ang) * side).toFixed(1));
      label.setAttribute("y", (py + Math.cos(ang) * side).toFixed(1));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.textContent = `${Math.round(newtons)} N`;
      g.appendChild(label);
    }

    layer.appendChild(g);
  }

  /** Tažná síla lana — šipky ve směru tíhy (dolů) kvůli přehlednosti nekreslíme. */
  function drawTensionArrow(origin, fx, fy) {
    if (fy > Math.hypot(fx, fy) * 0.02) return;
    drawForceArrow(origin, fx, fy, "tension");
  }

  function syncForcesToggleUi() {
    if (!btnForces) return;
    btnForces.classList.toggle("is-active", showForces);
    btnForces.setAttribute("aria-pressed", String(showForces));
    if (appRoot) appRoot.classList.toggle("is-show-forces", showForces);
  }

  function setShowForces(next) {
    showForces = !!next;
    syncForcesToggleUi();
    updateForceArrows();
  }

  function simForceToNewtons(f) {
    return (f / WEIGHT_FORCE) * WEIGHT_FORCE_N;
  }

  function ensureWinchForceLabel(winch) {
    const svg = winch.el.querySelector("svg");
    let label = winch.el.querySelector(".winch-force-text");
    if (!label && svg) {
      label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.classList.add("winch-force-text");
      label.setAttribute("x", "67");
      label.setAttribute("y", "119.5");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("fill", "#4A43E8");
      label.setAttribute("font-size", "15");
      label.setAttribute("font-weight", "700");
      label.setAttribute(
        "font-family",
        "ui-sans-serif, system-ui, -apple-system, sans-serif"
      );
      svg.appendChild(label);
    }
    return label;
  }

  /** Štítek navijáku ukazuje skutečné napětí v laně, i když přesáhne 150 N. */
  function updateWinchForceLabels(system) {
    for (const winch of winches) {
      const label = ensureWinchForceLabel(winch);
      if (!label) continue;
      const constraint =
        winch.snap?.type === "rope"
          ? constraintForRope(system, winch.snap.rope)
          : null;
      if (
        !running ||
        isDocked(winch.el) ||
        isStockTemplate(winch.el) ||
        !constraint
      ) {
        label.textContent = "";
        label.style.visibility = "hidden";
        continue;
      }

      const pullN = simForceToNewtons(constraint.tension);
      if (pullN < 0.5) {
        label.textContent = "";
        label.style.visibility = "hidden";
        continue;
      }

      label.textContent = `${Math.round(pullN)} N`;
      label.style.visibility = "visible";
      label.classList.toggle(
        "is-at-max",
        pullN >= WINCH_MAX_FORCE_N - 0.5 && pullN <= WINCH_MAX_FORCE_N + 0.5
      );
      label.classList.toggle(
        "is-overloaded",
        pullN > WINCH_MAX_FORCE_N + 0.5 ||
          winch.el.classList.contains("is-overload")
      );
    }
  }

  function updateForceArrows() {
    syncForceOverlay();
    const system = buildRopeSystem();
    updateWinchForceLabels(system);
    clearForceArrows();
    if (!showForces) return;
    // Těleso může viset na víc lanech — tíhu i výslednici kresli jednou
    const netByBody = new Map();
    for (const constraint of system.constraints) {
      drawRopeForces(constraint, netByBody);
    }
    for (const entry of netByBody.values()) {
      if (shouldDrawNetForce(entry.fx, entry.fy)) {
        drawForceArrow(entry.origin, entry.fx, entry.fy, "net");
      }
    }
  }

  function drawRopeForces(c, netByBody) {
    const T = c.tension;
    for (const term of c.terms) {
      if (term.kind === "weight") drawWeightForces(term, T, netByBody);
      else drawFreePulleyForces(c, term, T, netByBody);
    }
    drawFixedWheelForces(c, T);
    drawWinchForces(c, T);
  }

  /**
   * Součet sil na těleso pro šipku výslednice. Při prvním lanu se přidá tíha
   * a nakreslí její šipka, tahy dalších lan se přičtou.
   */
  function bodyNetEntry(netByBody, obj, origin, gy) {
    let entry = netByBody?.get(obj);
    if (!entry) {
      entry = { origin, fx: 0, fy: gy };
      netByBody?.set(obj, entry);
      drawForceArrow(origin, 0, gy, "gravity");
    }
    return entry;
  }

  function drawWeightForces(term, T, netByBody) {
    const origin = getWeightHookWorld(term.obj);
    const net = bodyNetEntry(netByBody, term.obj, origin, term.mass * GRAVITY);
    if (T <= 1e-6) return;
    const tx = T * term.u.x;
    const ty = T * term.u.y;
    drawTensionArrow(origin, tx, ty);
    net.fx += tx;
    net.fy += ty;
  }

  function drawFreePulleyForces(c, term, T, netByBody) {
    const rope = c.rope;
    const wheel = getWheelWorld(term.obj.el, "free");
    if (!wheel) return;
    const origin = { x: wheel.cx, y: wheel.cy };
    const net = bodyNetEntry(netByBody, term.obj, origin, term.mass * GRAVITY);
    // Volný konec lana ⇒ T = 0; pro ukázku rovnováhy dopočti ideální tah
    const Tp = T > 1e-6 ? T : freePulleyDisplayTension(term);
    if (Tp <= 1e-6) return;

    for (const contact of term.contacts || []) {
      for (const side of ["enter", "leave"]) {
        if (!strandResistsTension(rope, side)) continue;
        const pull = side === "enter" ? contact.enterPull : contact.leavePull;
        if (Math.hypot(pull.x, pull.y) < 0.15) continue;
        const at = side === "enter" ? contact.enterPt : contact.leavePt;
        drawTensionArrow(at, Tp * pull.x, Tp * pull.y);
        net.fx += Tp * pull.x;
        net.fy += Tp * pull.y;
      }
    }
    // Lano uvázané za osu kladky
    for (const which of ["start", "end"]) {
      if (!endpointIfPulleyCenter(rope, which, term.obj)) continue;
      const other = which === "start" ? "end" : "start";
      if (!ropeEndResistsTension(rope, other)) continue;
      const u = which === "start" ? c.attach.startU : c.attach.endU;
      drawTensionArrow(origin, Tp * u.x, Tp * u.y);
      net.fx += Tp * u.x;
      net.fy += Tp * u.y;
    }
  }

  /** Tahy lana na pevné kladky — v drážce i v ose, ke které je lano uvázané. */
  function drawFixedWheelForces(c, T) {
    const rope = c.rope;
    const Tshow = T > 1e-6 ? T : fallbackDisplayTension(c);
    if (Tshow <= 1e-6) return;

    for (const which of ["start", "end"]) {
      if (!ropeEndResistsTension(rope, which)) continue;
      ensureRopeEdgeSnap(rope);
      const snap = rope.edgeSnap[which];
      if (!isPulleyCenterSnap(snap)) continue;
      const pulley = findPulleyById(snap.pulleyId);
      if (!pulley || pulley.kind !== "fixed") continue;
      const center = getPulleyCenterWorld(pulley.id);
      if (!center) continue;
      const u = which === "start" ? c.attach.startU : c.attach.endU;
      drawTensionArrow({ x: center.x, y: center.y }, Tshow * u.x, Tshow * u.y);
    }

    for (const contact of c.attach.contacts || []) {
      if (contact.wheelKind !== "fixed") continue;
      for (const side of ["enter", "leave"]) {
        if (!strandResistsTension(rope, side)) continue;
        const pull = side === "enter" ? contact.enterPull : contact.leavePull;
        if (Math.hypot(pull.x, pull.y) < 0.15) continue;
        const at = side === "enter" ? contact.enterPt : contact.leavePt;
        drawTensionArrow(at, Tshow * pull.x, Tshow * pull.y);
      }
    }
  }

  /** Síla navijáku — skutečné napětí v laně, směr do bubnu. */
  function drawWinchForces(c, T) {
    if (T <= 1e-6) return;
    for (const which of ["start", "end"]) {
      const winch = winchOnRopeEnd(c.rope, which);
      if (!winch) continue;
      const origin = getWinchHookWorld(winch);
      const u = which === "start" ? c.attach.startU : c.attach.endU;
      // Napětí táhne konec směrem u; naviják drží opačně (do bubnu)
      drawForceArrow(origin, -u.x * T, -u.y * T, "winch");
    }
  }

  /**
   * Volný konec blízko obepnuté kladky → lano sklouzne (odeber obepnutí).
   * Délka lana (restLength) se nemění.
   */
  function trySlipWrapsAtLooseEnd(rope, startPt, endPt) {
    if (!rope?.sim?.model?.wraps?.length) return false;
    const model = rope.sim.model;
    const attempts = [];
    if (!ropeEndResistsTension(rope, "start")) {
      attempts.push({ pt: startPt, wrapIndex: 0, useEnter: true });
    }
    if (!ropeEndResistsTension(rope, "end")) {
      attempts.push({
        pt: endPt,
        wrapIndex: model.wraps.length - 1,
        useEnter: false,
      });
    }
    if (!attempts.length) return false;

    let slipped = false;
    for (const a of attempts) {
      if (a.wrapIndex < 0 || a.wrapIndex >= model.wraps.length) continue;
      const wrap = model.wraps[a.wrapIndex];
      const wheel = resolveModelWheel(wrap);
      if (!wheel || wheel.r < 1) continue;
      const ang = a.useEnter ? wrap.enterAng : wrap.leaveAng;
      const contact = pointOnCircle(wheel, ang);
      const dContact = dist(a.pt, contact);
      const dCenter = Math.hypot(a.pt.x - wheel.cx, a.pt.y - wheel.cy);
      const freeAng = Math.atan2(a.pt.y - wheel.cy, a.pt.x - wheel.cx);
      const inArc = arcContainsAngle(
        wrap.enterAng,
        wrap.leaveAng,
        wrap.clockwise,
        freeAng
      );
      const slipR = Math.max(28, wheel.r * 0.85);
      const nearRim = dCenter < wheel.r * 1.25;
      const nearContact = dContact < slipR;
      // Volný konec vjel do oblouku / k dotyku → sklouznutí z drážky
      if (!nearContact && !(inArc && nearRim)) continue;

      const id = wrap.wheelId;
      if (id && rope.wrapIds) {
        rope.wrapIds = rope.wrapIds.filter((x) => x !== id);
      }
      model.wraps.splice(a.wrapIndex, 1);
      slipped = true;
      break;
    }
    return slipped;
  }

  /** Po sklouznutí přepočti zamrzlý model z zbývajících wrapIds. */
  function refreshSimModelAfterSlip(rope, startPt, endPt) {
    if (!rope.sim) return;
    if (rope.points.length >= 2) {
      rope.points[0] = { ...startPt };
      rope.points[rope.points.length - 1] = { ...endPt };
    }
    const model = computeRopeModel(rope, { preserveWraps: true });
    if (model.wraps.length && !rope.closed) {
      const live = liveWrapGeometry(model, startPt, endPt);
      if (live) {
        for (let i = 0; i < model.wraps.length; i += 1) {
          model.wraps[i].clockwise = live.cws[i];
          model.wraps[i].enterAng = live.enterAng[i];
          model.wraps[i].leaveAng = live.leaveAng[i];
        }
      }
    }
    rope.sim.model = model;
  }

  function integrateRopePhysics(rope, dt) {
    if (!rope.sim || rope.closed || !rope.el.isConnected) return;

    const { model } = rope.sim;
    const { width } = stageSize();

    let startPt = { ...rope.sim.startPt };
    let endPt = { ...rope.sim.endPt };

    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const startWinch = winchOnRopeEnd(rope, "start");
    const endWinch = winchOnRopeEnd(rope, "end");
    const movableFreePulleys = getRopeMovableFreePulleys(rope, model);
    const freePulley = movableFreePulleys[0] || getRopeFreePulley(rope, model);
    const hasFree = movableFreePulleys.length > 0;

    if (startWinch) startPt = getWinchHookWorld(startWinch);
    if (endWinch) endPt = getWinchHookWorld(endWinch);

    // Rychlosti už jsou integrované ze sil (integrateBodyVelocities)
    if (startW) {
      startPt.x += startW.vel.x * dt;
      startPt.y += startW.vel.y * dt;
    } else if (startWinch) {
      startPt = getWinchHookWorld(startWinch);
    } else if (isRopeEndSnapped(rope, "start")) {
      startPt = getRopeEndPoint(rope, "start");
    }

    if (endW) {
      endPt.x += endW.vel.x * dt;
      endPt.y += endW.vel.y * dt;
    } else if (endWinch) {
      endPt = getWinchHookWorld(endWinch);
    } else if (isRopeEndSnapped(rope, "end")) {
      endPt = getRopeEndPoint(rope, "end");
    }

    const offS = startW ? getWeightHookOffset(startW) : { x: 0, y: 0 };
    const offE = endW ? getWeightHookOffset(endW) : { x: 0, y: 0 };
    const startMinX = offS.x;
    const startMaxX = width - (startW?.el.offsetWidth || 70) + offS.x;
    const endMinX = offE.x;
    const endMaxX = width - (endW?.el.offsetWidth || 70) + offE.x;
    if (startW && (startPt.x <= startMinX || startPt.x >= startMaxX)) {
      startW.vel.x = 0;
    }
    if (endW && (endPt.x <= endMinX || endPt.x >= endMaxX)) {
      endW.vel.x = 0;
    }
    startPt.x = clamp(startPt.x, startMinX, startMaxX);
    endPt.x = clamp(endPt.x, endMinX, endMaxX);

    // Nejdřív sklouznutí, ať se lano nezkracuje do rozbitého obepnutí
    if (trySlipWrapsAtLooseEnd(rope, startPt, endPt)) {
      refreshSimModelAfterSlip(rope, startPt, endPt);
    }

    let corrected = enforceRopeLength(
      rope.sim.model,
      startPt,
      endPt,
      rope.sim.restLength,
      {
        startFixed: ropeEndIsFixed(rope, "start"),
        endFixed: ropeEndIsFixed(rope, "end"),
      }
    );

    if (startWinch) {
      corrected.start = getWinchHookWorld(startWinch);
    } else if (isRopeEndSnapped(rope, "start") && !startW) {
      corrected.start = getRopeEndPoint(rope, "start");
    }
    if (endWinch) {
      corrected.end = getWinchHookWorld(endWinch);
    } else if (isRopeEndSnapped(rope, "end") && !endW) {
      corrected.end = getRopeEndPoint(rope, "end");
    }

    // Volný konec u kladky → sklouznutí (ne zkracování lana do obepnutí)
    if (trySlipWrapsAtLooseEnd(rope, corrected.start, corrected.end)) {
      refreshSimModelAfterSlip(rope, corrected.start, corrected.end);
      corrected = enforceRopeLength(
        rope.sim.model,
        corrected.start,
        corrected.end,
        rope.sim.restLength,
        {
          startFixed: ropeEndIsFixed(rope, "start"),
          endFixed: ropeEndIsFixed(rope, "end"),
        }
      );
      if (startWinch) corrected.start = getWinchHookWorld(startWinch);
      else if (isRopeEndSnapped(rope, "start") && !startW) {
        corrected.start = getRopeEndPoint(rope, "start");
      }
      if (endWinch) corrected.end = getWinchHookWorld(endWinch);
      else if (isRopeEndSnapped(rope, "end") && !endW) {
        corrected.end = getRopeEndPoint(rope, "end");
      }
    }

    // Oba konce pevné → zkrácení lana zvedne volnou kladku.
    // Když je jeden konec volný, lano sklouzne / odvíjí se — kladka smí padat.
    if (
      hasFree &&
      freePulley &&
      ropeEndIsFixed(rope, "start") &&
      ropeEndIsFixed(rope, "end")
    ) {
      enforceRopeLengthViaFreePulley(
        rope.sim.model,
        corrected.start,
        corrected.end,
        rope.sim.restLength,
        freePulley,
        rope
      );
      if (isRopeEndSnapped(rope, "start") && !startW && !startWinch) {
        corrected.start = getRopeEndPoint(rope, "start");
      }
      if (isRopeEndSnapped(rope, "end") && !endW && !endWinch) {
        corrected.end = getRopeEndPoint(rope, "end");
      }
    }

    applyRopeSimEndpoints(rope, corrected.start, corrected.end);

    for (const pulley of movableFreePulleys) {
      syncRodWeightForPulley(pulley, pulley.vel);
    }
  }

  function simulateRopes(dt) {
    for (const rope of ropes) {
      integrateRopePhysics(rope, dt);
    }
  }

  /** Navíjení: zkracuj lano, dokud napětí nepřekročí max. sílu navijáku. */
  function applyWinchReeling(system, dt) {
    for (const winch of winches) {
      if (
        isDocked(winch.el) ||
        isStockTemplate(winch.el) ||
        winch.snap?.type !== "rope"
      ) {
        setWinchWinding(winch, false);
        continue;
      }
      const rope = winch.snap.rope;
      if (!rope?.sim) {
        setWinchWinding(winch, false);
        continue;
      }
      const c = constraintForRope(system, rope);
      const tension = c?.tension ?? 0;
      const canReel = tension < WINCH_MAX_FORCE - 1e-6;
      setWinchWinding(winch, canReel ? "winding" : "overload");
      if (canReel) {
        const minLen = 40;
        rope.sim.restLength = Math.max(
          minLen,
          rope.sim.restLength - WINCH_REEL_SPEED * dt
        );
      }
    }
  }

  /** Buben se točí přes SVG transform — CSS animace na <g> v Safari/iPadu neběží. */
  function tickWinchSpin(dt) {
    for (const winch of winches) {
      const drum = winch.el.querySelector(".winch-drum");
      if (!drum) continue;
      if (winch.winding) {
        winch.spinAngle = (winch.spinAngle || 0) + WINCH_SPIN_DEG_PER_S * dt;
      }
      const angle = ((winch.spinAngle || 0) % 360).toFixed(2);
      drum.setAttribute("transform", `rotate(${angle})`);
    }
  }

  /** Setrvačnost: rychlost se integruje ze zrychlení, ne z něj přímo plyne. */
  function integrateBodyVelocities(system, dt) {
    for (const body of system.bodies.values()) {
      const vel = body.obj?.vel;
      if (!vel) continue;
      vel.x += body.accel.x * dt;
      vel.y += body.accel.y * dt;
      clampBodySpeed(vel);
    }
  }

  function clampBodySpeed(vel) {
    const speed = Math.hypot(vel.x, vel.y);
    if (speed <= MAX_BODY_SPEED || speed < 1e-9) return;
    vel.x = (vel.x / speed) * MAX_BODY_SPEED;
    vel.y = (vel.y / speed) * MAX_BODY_SPEED;
  }

  /**
   * Napnuté lano se nesmí prodlužovat: odečti složku rychlostí podél gradientu
   * délky (ráz v laně). Bez toho by soustava po dopnutí lana kmitala.
   */
  function projectBodyVelocities(system) {
    for (let iter = 0; iter < 4; iter += 1) {
      let maxRate = 0;
      for (const c of system.constraints) {
        if (!c.canCarry || c.slack || !c.terms.length) continue;
        let rate = 0;
        let denom = 0;
        for (const term of c.terms) {
          const vel = term.obj?.vel;
          if (!vel) continue;
          rate += vecDot(term.grad, vel);
          denom +=
            (term.grad.x * term.grad.x + term.grad.y * term.grad.y) / term.mass;
        }
        if (denom < 1e-9 || rate <= 1e-6) continue;
        maxRate = Math.max(maxRate, rate);
        const lambda = rate / denom;
        for (const term of c.terms) {
          const vel = term.obj?.vel;
          if (!vel) continue;
          vel.x -= (lambda * term.grad.x) / term.mass;
          vel.y -= (lambda * term.grad.y) / term.mass;
        }
      }
      if (maxRate < 1e-6) break;
    }
  }

  /** Posuň volné kladky podle jejich rychlosti (každou zvlášť). */
  function moveFreePulleyBodies(system, dt) {
    const { width } = stageSize();
    let moved = false;
    for (const body of system.bodies.values()) {
      if (body.kind !== "pulley") continue;
      const pulley = body.obj;
      const dx = pulley.vel.x * dt;
      const dy = pulley.vel.y * dt;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
      setFreePulleyPositionDelta(pulley, dx, dy);
      syncRodWeightForPulley(pulley, pulley.vel);
      moved = true;
      const maxLeft = Math.max(0, width - (pulley.el.offsetWidth || 0));
      const left = parseFloat(pulley.el.style.left) || 0;
      if (left <= 0.5 || left >= maxLeft - 0.5) pulley.vel.x = 0;
    }
    if (moved) rebuildAllRopes();
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
    return svgUserToStage(svg, x, y) || { x: 0, y: 0 };
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
    const { width } = stageSize();
    const w = weight.el.offsetWidth || 70;
    const left = clamp(point.x - off.x, 0, Math.max(0, width - w));
    const top = Math.max(0, point.y - off.y);
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
        pt = getWeightHookWorld(weight);
        syncRopeEndpointsFromWeights(rope);
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
      const hook = getWeightHookWorld(weight);
      if (target.which === "start") target.rope.points[0] = { ...hook };
      else {
        target.rope.points[target.rope.points.length - 1] = { ...hook };
      }
      placeWeightAtHook(weight, hook);
      rebuildRope(target.rope, { preserveWraps: true });
    }
    syncRopeEndHandles();
    updateForceArrows();
  }

  function enableWeightDrag(weight) {
    let dragging = false;
    let pointerId = null;
    let grabOffsetX = 0;
    let grabOffsetY = 0;

    function stagePoint(e) {
      return pointerToStage(e);
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
      syncRopeEndHandles();
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
    if (!ensureMoveToolForStock()) return;
    if (e.button != null && e.button !== 0) return;
    clearPulleySelection();
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

  function ensureMoveToolForStock() {
    if (running || tool === "run") return false;
    if (tool === "pencil" || tool === "freehand" || tool === "erase") {
      setTool("move");
    }
    return tool === "move";
  }

  function beginPulleySpawnDrag(kind, e) {
    if (!ensureMoveToolForStock()) return;
    if (e.button != null && e.button !== 0) return;
    clearPulleySelection();
    beginUserAction();
    const pulley = createPulleyInstance(kind);
    if (!pulley) return;
    const el = pulley.el;
    if (kind === "free") {
      const { rect, width, height } = stageSize();
      moveFreePulleyWheelTo(el, e.clientX - rect.left, e.clientY - rect.top);
      const w = el.getBoundingClientRect().width || el.offsetWidth || 104;
      const h = el.getBoundingClientRect().height || el.offsetHeight || 160;
      el.style.left = `${clamp(parseFloat(el.style.left) || 0, 0, Math.max(0, width - w))}px`;
      el.style.top = `${clamp(parseFloat(el.style.top) || 0, 0, Math.max(0, height - h))}px`;
    } else {
      placeElUnderPointer(el, e.clientX, e.clientY);
    }
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
        moveFreePulleyWheelTo(
          el,
          ev.clientX - rect.left,
          ev.clientY - rect.top
        );
        const w = el.getBoundingClientRect().width || el.offsetWidth || 104;
        const h = el.getBoundingClientRect().height || el.offsetHeight || 160;
        el.style.left = `${clamp(parseFloat(el.style.left) || 0, 0, Math.max(0, width - w))}px`;
        el.style.top = `${clamp(parseFloat(el.style.top) || 0, 0, Math.max(0, height - h))}px`;
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

  function enableStockMoveSwitch() {
    if (!stockSection) return;
    stockSection.addEventListener(
      "pointerdown",
      (e) => {
        if (running || tool === "run") return;
        if (tool === "pencil" || tool === "freehand" || tool === "erase") {
          ensureMoveToolForStock();
        }
      },
      true
    );
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
    rebuildRope(target.rope, { preserveWraps: true });
    syncRopeEndHandles();
    hideSnapMarker();
    syncWinchAttachedLight(winch);
    updateForceArrows();
  }

  function enableWinchDrag(winch) {
    let dragging = false;
    let pointerId = null;
    let grabOffsetX = 0;
    let grabOffsetY = 0;

    function stagePoint(e) {
      return pointerToStage(e);
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
      const w = winch.el.offsetWidth || 110;
      const h = winch.el.offsetHeight || 98;
      winch.el.style.left = `${clamp(p.x - grabOffsetX, 0, Math.max(0, width - w))}px`;
      winch.el.style.top = `${clamp(p.y - grabOffsetY, 0, Math.max(0, height - h))}px`;
      const snap = findWinchSnapTarget(winch);
      if (snap) {
        winch.el.classList.add("is-snapping");
      } else {
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
      else syncRopeEndHandles();
      updateForceArrows();
      endUserAction();
    }

    winch.el.addEventListener("pointerup", finish);
    winch.el.addEventListener("pointercancel", finish);
  }

  function beginWinchSpawnDrag(e) {
    if (!ensureMoveToolForStock()) return;
    if (e.button != null && e.button !== 0) return;
    clearPulleySelection();
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
      const w = winch.el.offsetWidth || 110;
      const h = winch.el.offsetHeight || 98;
      winch.el.style.left = `${clamp(ev.clientX - rect.left - grabOffsetX, 0, Math.max(0, width - w))}px`;
      winch.el.style.top = `${clamp(ev.clientY - rect.top - grabOffsetY, 0, Math.max(0, height - h))}px`;
      const snap = findWinchSnapTarget(winch);
      if (snap) {
        winch.el.classList.add("is-snapping");
      } else {
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
      else syncRopeEndHandles();
      updateForceArrows();
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
        // Konec na středu kladky neslučovat — umožní upevnit další lano ke stejnému středu.
        if (isRopeEndAtPulleyCenter(rope, end.which)) continue;
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

  /**
   * Obepnutí lana v pořadí, v jakém je projde spojený tah. Když se lano
   * připojuje obráceně (concatPoints jeho body převrací), musí se převrátit
   * i pořadí obepnutí — jinak vznikne špatně navlečená topologie.
   */
  function wrapIdsAlongMerge(rope, which, position /* "before" | "after" */) {
    const ids = (rope?.wrapIds || []).slice();
    const reversed =
      position === "before" ? which === "start" : which === "end";
    return reversed ? ids.reverse() : ids;
  }

  /** Spojí seznamy obepnutí, zachová pořadí a vynechá duplicity. */
  function joinWrapIds(...lists) {
    const out = [];
    for (const list of lists) {
      for (const id of list || []) {
        if (id && !out.includes(id)) out.push(id);
      }
    }
    return out;
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

  function maybeStraightenCenterAnchoredRope(rope) {
    if (!rope || rope.closed) return;
    ensureRopeEdgeSnap(rope);
    const startSnap = rope.edgeSnap.start;
    const endSnap = rope.edgeSnap.end;
    const startCenter = isPulleyCenterSnap(startSnap);
    const endCenter = isPulleyCenterSnap(endSnap);
    if (!startCenter && !endCenter) return;

    const startPt = getRopeEndPoint(rope, "start");
    const endPt = getRopeEndPoint(rope, "end");

    if (
      startCenter &&
      endCenter &&
      startSnap.pulleyId &&
      endSnap.pulleyId &&
      startSnap.pulleyId !== endSnap.pulleyId
    ) {
      rope.points = [startPt, endPt];
      rope.wrapIds = [];
      return;
    }

    const exclude = pulleyCenterExcludeIdsForStroke(
      rope.points,
      rope.wrapIds,
      rope.edgeSnap.start,
      rope.edgeSnap.end
    );
    const draft = {
      points: rope.points,
      closed: false,
      edgeSnap: rope.edgeSnap,
      wrapIds: (rope.wrapIds || []).filter((id) => !exclude.has(id)),
    };
    const model = computeRopeModel(draft);
    if (model.wraps.length > 0) return;

    rope.points = [startPt, endPt];
    rope.wrapIds = (rope.wrapIds || []).filter((id) => !exclude.has(id));
  }

  function commitRope(el, points, closed, edgeSnap, stickyIds) {
    const nextEdge = edgeSnap || { start: null, end: null };
    const exclude = pulleyCenterExcludeIdsForStroke(
      points,
      stickyIds,
      nextEdge.start,
      nextEdge.end
    );
    const filteredSticky = (stickyIds || []).filter((id) => !exclude.has(id));
    const d = buildRopePath(points, closed, filteredSticky, exclude, {
      edgeSnap: nextEdge,
    });
    el.classList.remove("is-draft", "is-snapping");
    el.setAttribute("d", d);
    if (closed) el.dataset.closed = "true";
    else delete el.dataset.closed;

    const existing = ropes.find((r) => r.el === el);
    const draft = {
      el,
      points,
      closed,
      edgeSnap: nextEdge,
      wrapIds: filteredSticky.slice(),
    };
    const model = computeRopeModel(draft);
    const modelIds = model.wraps.map((w) => w.wheelId).filter(Boolean);
    // Sticky zachovej jen pokud po ořezu sousedního středového obepnutí zůstalo v modelu
    const wrapIds = (
      filteredSticky.length
        ? filteredSticky.filter((id) => modelIds.includes(id))
        : modelIds
    ).filter((id) => !exclude.has(id));
    // Pokud model má obepnutí (např. střední obepnutí téže kladky), přidej je
    for (const id of modelIds) {
      if (!wrapIds.includes(id)) wrapIds.push(id);
    }

    if (existing) {
      existing.points = points;
      existing.closed = closed;
      existing.wrapIds = wrapIds;
      if (edgeSnap) existing.edgeSnap = nextEdge;
      else ensureRopeEdgeSnap(existing);
      maybeStraightenCenterAnchoredRope(existing);
    } else {
      const rope = {
        el,
        points,
        closed,
        edgeSnap: nextEdge,
        wrapIds,
      };
      ropes.push(rope);
      maybeStraightenCenterAnchoredRope(rope);
    }
    const rope = ropes.find((r) => r.el === el);
    if (rope) {
      const excludeAfter = pulleyCenterExcludeIdsForStroke(
        rope.points,
        rope.wrapIds,
        rope.edgeSnap.start,
        rope.edgeSnap.end
      );
      const renderPts = rope.points.slice();
      if (!rope.closed) {
        renderPts[0] = { ...getRopeEndPoint(rope, "start") };
        renderPts[renderPts.length - 1] = {
          ...getRopeEndPoint(rope, "end"),
        };
      }
      rope.el.setAttribute(
        "d",
        buildRopePath(renderPts, rope.closed, rope.wrapIds, excludeAfter, {
          edgeSnap: rope.edgeSnap,
        })
      );
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
    if (tool !== "move" && tool !== "pencil" && tool !== "freehand") return;

    for (const rope of ropes) {
      if (!rope.el.isConnected || rope.closed) continue;
      for (const end of ropeEnds(rope)) {
        if (tool === "move") {
          if (isRopeEndTaken(rope, end.which, null, null)) continue;
          // Střed kladky je sám kotva — bez překrývajícího kolečka
          if (isRopeEndAtPulleyCenter(rope, end.which)) continue;
        }
        if (
          (tool === "pencil" || tool === "freehand") &&
          isRopeEndAtPulleyCenter(rope, end.which)
        ) {
          continue;
        }
        const handle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle"
        );
        handle.classList.add("rope-end-handle");
        if (tool === "pencil" || tool === "freehand") {
          handle.classList.add("is-pencil-hint");
        }
        handle.setAttribute("r", String(END_GRAB_RADIUS));
        handle.setAttribute("cx", end.point.x.toFixed(2));
        handle.setAttribute("cy", end.point.y.toFixed(2));
        handle.setAttribute("role", "button");
        handle.setAttribute(
          "aria-label",
          end.which === "start" ? "Začátek lana" : "Konec lana"
        );
        if (tool === "pencil" || tool === "freehand") {
          handle.setAttribute("aria-hidden", "true");
        }
        ropeLayer.appendChild(handle);
        endHandles.push({ el: handle, rope, which: end.which });
      }
    }
  }

  function attachRopeEndToWeight(rope, which, weight) {
    ensureRopeEdgeSnap(rope);
    const wn = winchOnRopeEnd(rope, which);
    if (wn) {
      wn.snap = { type: "free" };
      setWinchWinding(wn, false);
    }
    rope.edgeSnap[which] = null;
    weight.snap = { type: "rope", rope, which };
    const hook = getWeightHookWorld(weight);
    if (which === "start") rope.points[0] = { ...hook };
    else rope.points[rope.points.length - 1] = { ...hook };
    placeWeightAtHook(weight, hook);
    rebuildRope(rope, { preserveWraps: true });
    syncRopeEndHandles();
    syncAllWeightsToSnap();
    updateForceArrows();
  }

  function attachRopeEndToWinch(rope, which, winch) {
    ensureRopeEdgeSnap(rope);
    const w = weightOnRopeEnd(rope, which);
    if (w) w.snap = { type: "free" };
    const oldWinch = winchOnRopeEnd(rope, which);
    if (oldWinch && oldWinch !== winch) {
      oldWinch.snap = { type: "free" };
      setWinchWinding(oldWinch, false);
    }
    rope.edgeSnap[which] = null;
    winch.snap = { type: "rope", rope, which };
    const hook = getWinchHookWorld(winch);
    if (which === "start") rope.points[0] = { ...hook };
    else rope.points[rope.points.length - 1] = { ...hook };
    placeWinchAtHook(winch, hook);
    rebuildRope(rope, { preserveWraps: true });
    syncRopeEndHandles();
    syncAllWeightsToSnap();
    syncWinchAttachedLight(winch);
    updateForceArrows();
  }

  function attachRopeEndToTarget(rope, which, snap, handleEl) {
    if (snap?.type === "weight") {
      attachRopeEndToWeight(rope, which, snap.weight);
      return;
    }
    if (snap?.type === "winch") {
      attachRopeEndToWinch(rope, which, snap.winch);
      return;
    }
    attachRopeEndToEdge(rope, which, snap, handleEl);
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
    if (isPulleyCenterSnap(rope.edgeSnap[which]) && rope.edgeSnap[which].pulleyId) {
      const pid = rope.edgeSnap[which].pulleyId;
      const exclude = pulleyCenterExcludeIdsForStroke(
        rope.points,
        rope.wrapIds,
        rope.edgeSnap.start,
        rope.edgeSnap.end
      );
      // Odstraň P z wrapIds jen když od středu nevede tah přes jinou kladku
      if (exclude.has(pid) && rope.wrapIds) {
        rope.wrapIds = rope.wrapIds.filter((id) => id !== pid);
      } else if (rope.wrapIds) {
        // I při jiné kladce ořež přilehlé obepnutí u středu z topologie sticky
        const probe = pickWrapEvents(simplify(rope.points, 0.9), null);
        const kept = stripCenterAdjacentWraps(
          probe,
          rope.edgeSnap.start,
          rope.edgeSnap.end
        );
        const keptIds = new Set(
          kept.map((w) => w.wheel?.id || w.wheelId).filter(Boolean)
        );
        if (!keptIds.has(pid)) {
          rope.wrapIds = rope.wrapIds.filter((id) => id !== pid);
        }
      }
    }
    syncRopeEdgePoint(rope, which);
    maybeStraightenCenterAnchoredRope(rope);
    rebuildRope(rope);
    syncRopeEndHandles();
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
      return pointerToStage(e);
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
        const anchorSnap = snapTargetForAttachedEnd(p, attached);
        if (anchorSnap) {
          attachRopeEndToTarget(
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
      ensureRopeEdgeSnap(dragging.rope);
      const wasAttached = dragging.rope.edgeSnap[dragging.which];
      const ropeSnap = findSnapTarget(p, dragging.rope);
      const anchorSnap = ropeSnap
        ? null
        : snapTargetForAttachedEnd(p, wasAttached);

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
        attachRopeEndToTarget(
          dragging.rope,
          dragging.which,
          anchorSnap,
          dragging.el
        );
      } else {
        updateRopeEndPoint(dragging.rope, dragging.which, p);
      }

      syncRopeEndHandles();
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
    /** @type {null | typeof weights[0]} */
    let startWeightSnap = null;
    /** @type {null | typeof winches[0]} */
    let startWinchSnap = null;
    /** @type {string[]} kladky, kterých se tah už dotkl — zůstanou i daleko */
    let stickyIds = [];

    function stagePoint(e) {
      return pointerToStage(e);
    }

    function effectivePoints() {
      if (!attachFrom) return points;
      return concatPoints(attachFrom.rope, attachFrom.which, points);
    }

    function draftExcludeIds(pts, endAnchorSnap) {
      return pulleyCenterExcludeIdsForStroke(
        pts,
        stickyIds,
        startEdgeSnap,
        endAnchorSnap,
        attachFrom?.rope?.edgeSnap?.start,
        attachFrom?.rope?.edgeSnap?.end
      );
    }

    function rememberStickyFromPoints(pts, excludeIds, endAnchorSnap) {
      const simplified = simplify(pts, 0.9);
      let wraps = pickWrapEvents(simplified, excludeIds);
      wraps = ensureWrapsAgainstCrossing(simplified, wraps, excludeIds);
      wraps = stripCenterAdjacentWraps(wraps, startEdgeSnap, endAnchorSnap);
      for (const w of wraps) {
        const id = w.wheel && w.wheel.id;
        if (id && !excludeIds?.has(id) && !stickyIds.includes(id)) {
          stickyIds.push(id);
        }
      }
      stickyIds = stickyIds.filter((id) => !excludeIds?.has(id));
    }

    function updateDraft() {
      if (!draft) return;
      const pts = effectivePoints();
      const endSnap = findSnapTarget(
        pts[pts.length - 1],
        attachFrom && attachFrom.rope
      );
      const selfClose =
        !attachFrom &&
        pts.length >= 4 &&
        dist(pts[pts.length - 1], pts[0]) <= CLOSE_SNAP_RADIUS;
      const endEdgeSnap =
        endSnap || selfClose ? null : findAnchorSnapTarget(pts[pts.length - 1]);
      const exclude = draftExcludeIds(pts, endEdgeSnap);
      rememberStickyFromPoints(pts, exclude, endEdgeSnap);
      const pathOpts = {
        edgeSnap: { start: startEdgeSnap, end: endEdgeSnap },
      };

      if (selfClose) {
        showSnapMarker(pts[0]);
        draft.classList.add("is-snapping");
        draft.setAttribute(
          "d",
          buildRopePath(pts, true, stickyIds, exclude, pathOpts)
        );
      } else if (endSnap) {
        showSnapMarker(endSnap.point);
        draft.classList.add("is-snapping");
        const preview = pts.slice();
        preview[preview.length - 1] = {
          x: endSnap.point.x,
          y: endSnap.point.y,
        };
        draft.setAttribute(
          "d",
          buildRopePath(preview, false, stickyIds, exclude, pathOpts)
        );
      } else if (endEdgeSnap) {
        showSnapMarker(endEdgeSnap.point);
        draft.classList.add("is-snapping");
        const preview = pts.slice();
        preview[preview.length - 1] = {
          x: endEdgeSnap.point.x,
          y: endEdgeSnap.point.y,
        };
        draft.setAttribute(
          "d",
          buildRopePath(preview, false, stickyIds, exclude, {
            edgeSnap: {
              start: startEdgeSnap,
              end: endEdgeSnap,
            },
          })
        );
      } else {
        hideSnapMarker();
        draft.classList.remove("is-snapping");
        draft.setAttribute(
          "d",
          buildRopePath(pts, false, stickyIds, exclude, pathOpts)
        );
      }
    }

    ropeLayer.addEventListener("pointerdown", (e) => {
      if (tool !== "pencil") return;
      if (e.button != null && e.button !== 0) return;
      beginUserAction();
      syncRopeViewBox();
      const p = stagePoint(e);
      startEdgeSnap = null;
      startWeightSnap = null;
      startWinchSnap = null;
      stickyIds = [];
      attachFrom = findSnapTarget(p, null);
      if (attachFrom) {
        points = [{ x: attachFrom.point.x, y: attachFrom.point.y }];
        stickyIds = wrapIdsAlongMerge(
          attachFrom.rope,
          attachFrom.which,
          "before"
        );
      } else {
        const anchorSnap = findAnchorSnapTarget(p);
        if (anchorSnap?.type === "weight") {
          startWeightSnap = anchorSnap.weight;
          points = [{ x: anchorSnap.point.x, y: anchorSnap.point.y }];
        } else if (anchorSnap?.type === "winch") {
          startWinchSnap = anchorSnap.winch;
          points = [{ x: anchorSnap.point.x, y: anchorSnap.point.y }];
        } else if (anchorSnap) {
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

    function stickyForEdgeSnap(edgeSnapObj, ids, strokePts) {
      const exclude = strokePts
        ? pulleyCenterExcludeIdsForStroke(
            strokePts,
            ids,
            edgeSnapObj?.start,
            edgeSnapObj?.end
          )
        : pulleyCenterExcludeIds(edgeSnapObj?.start, edgeSnapObj?.end);
      return (ids || []).filter((id) => !exclude.has(id));
    }

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
        startWeightSnap = null;
        startWinchSnap = null;
        stickyIds = [];
        cancelUserAction();
        return;
      }

      let pts = effectivePoints();
      pts = nudgeEndpointOffPulleyInterior(pts);
      let closed = false;
      let edgeSnap = { start: null, end: null };
      let endWeightSnap = null;
      let endWinchSnap = null;

      const selfClose =
        !attachFrom &&
        !startEdgeSnap &&
        !startWeightSnap &&
        !startWinchSnap &&
        pts.length >= 4 &&
        dist(pts[pts.length - 1], pts[0]) <= CLOSE_SNAP_RADIUS;

      const endSnap = findSnapTarget(
        pts[pts.length - 1],
        attachFrom && attachFrom.rope
      );
      let endEdgeSnap = endSnap || selfClose
        ? null
        : findAnchorSnapTarget(pts[pts.length - 1]);

      if (startEdgeSnap) edgeSnap.start = normalizeEndSnap(startEdgeSnap);
      if (endEdgeSnap) {
        pts[pts.length - 1] = {
          x: endEdgeSnap.point.x,
          y: endEdgeSnap.point.y,
        };
        if (endEdgeSnap.type === "weight") {
          endWeightSnap = endEdgeSnap.weight;
        } else if (endEdgeSnap.type === "winch") {
          endWinchSnap = endEdgeSnap.winch;
        } else {
          edgeSnap.end = normalizeEndSnap(endEdgeSnap);
        }
      }

      const exclude = draftExcludeIds(pts, endEdgeSnap);
      rememberStickyFromPoints(pts, exclude);
      stickyIds = stickyForEdgeSnap(edgeSnap, stickyIds, pts);

      if (selfClose) {
        pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
        closed = true;
        commitRope(draft, pts, true, null, stickyIds);
      } else if (endSnap) {
        ensureRopeEdgeSnap(endSnap.rope);
        rememberStickyFromPoints(pts, exclude);
        stickyIds = joinWrapIds(
          attachFrom
            ? wrapIdsAlongMerge(attachFrom.rope, attachFrom.which, "before")
            : [],
          stickyIds,
          wrapIdsAlongMerge(endSnap.rope, endSnap.which, "after")
        ).filter((id) => !exclude.has(id));
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
        stickyIds = stickyForEdgeSnap(mergedEdge, stickyIds, pts);
        removeRope(endSnap.rope);
        if (attachFrom) removeRope(attachFrom.rope);
        commitRope(draft, pts, false, mergedEdge, stickyIds);
      } else if (attachFrom) {
        ensureRopeEdgeSnap(attachFrom.rope);
        stickyIds = joinWrapIds(
          wrapIdsAlongMerge(attachFrom.rope, attachFrom.which, "before"),
          stickyIds
        ).filter((id) => !exclude.has(id));
        edgeSnap.start = attachFrom.rope.edgeSnap.start;
        if (attachFrom.which === "start") {
          edgeSnap.end =
            endEdgeSnap && endEdgeSnap.type !== "weight"
              ? normalizeEndSnap(endEdgeSnap)
              : null;
        } else {
          edgeSnap.end =
            endEdgeSnap && endEdgeSnap.type !== "weight"
              ? normalizeEndSnap(endEdgeSnap)
              : attachFrom.rope.edgeSnap.end;
        }
        stickyIds = stickyForEdgeSnap(edgeSnap, stickyIds, pts);
        removeRope(attachFrom.rope);
        commitRope(draft, pts, false, edgeSnap, stickyIds);
      } else {
        stickyIds = stickyForEdgeSnap(edgeSnap, stickyIds, pts);
        commitRope(draft, pts, false, edgeSnap, stickyIds);
      }

      const committedEl = draft;
      const rope = ropes.find((r) => r.el === committedEl);
      if (rope) {
        if (startWeightSnap) attachRopeEndToWeight(rope, "start", startWeightSnap);
        if (endWeightSnap) attachRopeEndToWeight(rope, "end", endWeightSnap);
        if (startWinchSnap) attachRopeEndToWinch(rope, "start", startWinchSnap);
        if (endWinchSnap) attachRopeEndToWinch(rope, "end", endWinchSnap);
      }

      draft = null;
      points = [];
      attachFrom = null;
      startEdgeSnap = null;
      startWeightSnap = null;
      startWinchSnap = null;
      stickyIds = [];
      endUserAction();
    }

    ropeLayer.addEventListener("pointerup", finish);
    ropeLayer.addEventListener("pointercancel", finish);
  }

  function enableFreehand() {
    let drawing = false;
    let pointerId = null;
    let draft = null;
    let points = [];
    /** @type {null | { rope: typeof ropes[0], which: "start"|"end", point: {x:number,y:number} }} */
    let attachFrom = null;
    /** @type {null | { rope: typeof ropes[0], which: "start"|"end", point: {x:number,y:number} }} */
    let attachTo = null;
    /** @type {null | { el: SVGPathElement, points: {x:number,y:number}[], attachFrom: typeof attachFrom, attachTo: typeof attachFrom }} */
    let pending = null;
    /** @type {SVGCircleElement[]} */
    let pendingHandles = [];
    /** @type {null | "start" | "end"} */
    let drawingFromEnd = null;

    function stagePoint(e) {
      return pointerToStage(e);
    }

    function setConfirmVisible(show) {
      if (!freehandConfirm) return;
      freehandConfirm.hidden = !show;
      if (appRoot) appRoot.classList.toggle("is-freehand-pending", !!show);
    }

    function restoreAttachFromOpacity() {
      if (attachFrom?.rope?.el) attachFrom.rope.el.style.opacity = "";
    }

    function restorePendingAttachOpacity() {
      if (pending?.attachFrom?.rope?.el) {
        pending.attachFrom.rope.el.style.opacity = "";
      }
      if (pending?.attachTo?.rope?.el) {
        pending.attachTo.rope.el.style.opacity = "";
      }
    }

    function clearPendingHandles() {
      for (const h of pendingHandles) h.remove();
      pendingHandles = [];
    }

    function syncPendingHandles() {
      if (!pending || pending.points.length < 2) {
        clearPendingHandles();
        return;
      }

      if (pendingHandles.length === 2) {
        for (const handle of pendingHandles) {
          const which =
            handle.dataset.pendingEnd === "start" ? "start" : "end";
          const pt =
            which === "start"
              ? pending.points[0]
              : pending.points[pending.points.length - 1];
          handle.setAttribute("cx", pt.x.toFixed(2));
          handle.setAttribute("cy", pt.y.toFixed(2));
        }
        return;
      }

      clearPendingHandles();
      for (const which of ["start", "end"]) {
        const pt =
          which === "start"
            ? pending.points[0]
            : pending.points[pending.points.length - 1];
        const handle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle"
        );
        handle.classList.add(
          "rope-end-handle",
          "is-pencil-hint",
          "is-freehand-pending-end"
        );
        handle.dataset.pendingEnd = which;
        handle.setAttribute("r", String(END_GRAB_RADIUS));
        handle.setAttribute("cx", pt.x.toFixed(2));
        handle.setAttribute("cy", pt.y.toFixed(2));
        handle.setAttribute("role", "button");
        handle.setAttribute(
          "aria-label",
          which === "start"
            ? "Začátek náčrtu — připojit ke konci lana"
            : "Konec náčrtu — připojit ke konci lana"
        );
        ropeLayer.appendChild(handle);
        pendingHandles.push(handle);
      }
    }

    function clearDraftState() {
      drawing = false;
      pointerId = null;
      draft = null;
      points = [];
      drawingFromEnd = null;
      attachTo = null;
      restoreAttachFromOpacity();
      attachFrom = null;
      hideSnapMarker();
    }

    function discardPending(cancelAction) {
      restorePendingAttachOpacity();
      clearPendingHandles();
      if (pending?.el?.isConnected) pending.el.remove();
      pending = null;
      setConfirmVisible(false);
      if (draft?.isConnected) draft.remove();
      clearDraftState();
      if (cancelAction) cancelUserAction();
    }

    discardFreehandPending = () => {
      if (pending || draft) discardPending(true);
    };

    function stickyFromStroke(pts, excludeIds, edgeStart = null, edgeEnd = null) {
      const simplified = simplify(pts, 0.9);
      let wraps = pickWrapEvents(simplified, excludeIds);
      wraps = ensureWrapsAgainstCrossing(simplified, wraps, excludeIds);
      wraps = stripCenterAdjacentWraps(wraps, edgeStart, edgeEnd);
      const ids = [];
      for (const w of wraps) {
        const id = w.wheel && w.wheel.id;
        if (id && !excludeIds?.has(id) && !ids.includes(id)) ids.push(id);
      }
      return ids.filter((id) => !excludeIds?.has(id));
    }

    function effectivePoints() {
      if (!attachFrom) return points;
      return concatPoints(attachFrom.rope, attachFrom.which, points);
    }

    function updateDraftRaw() {
      if (!draft) return;
      const preview = effectivePoints();
      const activeEnd =
        drawingFromEnd === "start"
          ? preview[0]
          : preview[preview.length - 1];
      const activeAttach =
        drawingFromEnd === "start" ? attachFrom : attachTo;
      const excludeRope =
        drawingFromEnd === "start"
          ? attachTo?.rope || null
          : attachFrom?.rope || null;

      if (activeAttach) {
        showSnapMarker(activeAttach.point);
        draft.classList.add("is-snapping");
      } else if (preview.length >= 2 && activeEnd) {
        const ropeSnap = findSnapTarget(activeEnd, excludeRope);
        if (ropeSnap) {
          showSnapMarker(ropeSnap.point);
          draft.classList.add("is-snapping");
        } else if (drawingFromEnd !== "start") {
          const endAnchor = findFreehandEndpointSnapTarget(activeEnd);
          if (endAnchor) {
            showSnapMarker(endAnchor.point);
            draft.classList.add("is-snapping");
          } else {
            hideSnapMarker();
            draft.classList.remove("is-snapping");
          }
        } else {
          hideSnapMarker();
          draft.classList.remove("is-snapping");
        }
      } else {
        hideSnapMarker();
        draft.classList.remove("is-snapping");
      }

      draft.setAttribute("d", pointsToPolyline(preview));
    }

    function updatePendingPath() {
      if (!pending?.el) return;
      pending.el.setAttribute("d", pointsToPolyline(pending.points));
      syncPendingHandles();
    }

    function resumeDrawingFromEndpoint(which, handPt, ptrId, ropeSnap = null) {
      if (!pending) return;

      clearPendingHandles();
      setConfirmVisible(false);

      attachFrom = pending.attachFrom || null;
      attachTo = pending.attachTo || null;
      if (ropeSnap) {
        if (which === "start") attachFrom = ropeSnap;
        else attachTo = ropeSnap;
      }

      if (attachFrom?.rope?.el) attachFrom.rope.el.style.opacity = "0.25";
      if (attachTo?.rope?.el && attachTo.rope !== attachFrom?.rope) {
        attachTo.rope.el.style.opacity = "0.25";
      }

      points = pending.points.slice();
      drawingFromEnd = which;
      if (which === "end") {
        if (points.length) {
          points[points.length - 1] = { x: handPt.x, y: handPt.y };
        } else {
          points.push({ x: handPt.x, y: handPt.y });
        }
      } else if (points.length) {
        points[0] = { x: handPt.x, y: handPt.y };
      } else {
        points.push({ x: handPt.x, y: handPt.y });
      }

      draft = pending.el;
      draft.classList.remove("is-freehand-pending");
      draft.classList.add("is-freehand-draft");
      pending = null;
      drawing = true;
      pointerId = ptrId;

      try {
        ropeLayer.setPointerCapture(ptrId);
      } catch (_) {}

      updateDraftRaw();
    }

    function resumeDrawingFromHand(which, snap, handPt, ptrId) {
      if (!pending || !snap) return;
      resumeDrawingFromEndpoint(which, handPt, ptrId, snap);
    }

    function preferredPendingEndForSnap(snap) {
      if (!pending) return "end";
      const pts = pending.points;
      return dist(snap.point, pts[0]) <= dist(snap.point, pts[pts.length - 1])
        ? "start"
        : "end";
    }

    function ropeEndSnapFromHandle(handle) {
      for (const end of ropeEnds(handle.rope)) {
        if (end.which === handle.which) return end;
      }
      return null;
    }

    function confirmPending() {
      if (!pending) return;
      restorePendingAttachOpacity();
      const el = pending.el;
      let pts = simplify(pending.points, 0.7);
      pts = nudgeEndpointOffPulleyInterior(pts);
      if (pts.length < 2) {
        discardPending(true);
        return;
      }

      const selfClose =
        pts.length >= 4 && dist(pts[pts.length - 1], pts[0]) <= CLOSE_SNAP_RADIUS;

      let edgeSnap = { start: null, end: null };
      let startWeightSnap = null;
      let endWeightSnap = null;
      let startWinchSnap = null;
      let endWinchSnap = null;
      let mergeStart = null;
      let mergeEnd = null;

      if (!selfClose) {
        mergeStart = pending.attachFrom || findSnapTarget(pts[0], null);
        mergeEnd =
          pending.attachTo ||
          findSnapTarget(pts[pts.length - 1], pending.attachFrom?.rope || null);
        if (mergeStart && mergeEnd && mergeStart.rope === mergeEnd.rope) {
          mergeEnd = null;
        }

        if (!mergeStart) {
          const startAnchor = findFreehandEndpointSnapTarget(pts[0]);
          if (startAnchor) {
            if (startAnchor.type === "weight") {
              startWeightSnap = startAnchor.weight;
              pts[0] = { x: startAnchor.point.x, y: startAnchor.point.y };
            } else if (startAnchor.type === "winch") {
              startWinchSnap = startAnchor.winch;
              pts[0] = { x: startAnchor.point.x, y: startAnchor.point.y };
            } else {
              edgeSnap.start = normalizeEndSnap(startAnchor);
              pts[0] = { x: startAnchor.point.x, y: startAnchor.point.y };
            }
          }
        } else {
          pts[0] = { x: mergeStart.point.x, y: mergeStart.point.y };
        }

        if (!mergeEnd) {
          const endAnchor = findFreehandEndpointSnapTarget(pts[pts.length - 1]);
          if (endAnchor) {
            if (endAnchor.type === "weight") {
              endWeightSnap = endAnchor.weight;
              pts[pts.length - 1] = {
                x: endAnchor.point.x,
                y: endAnchor.point.y,
              };
            } else if (endAnchor.type === "winch") {
              endWinchSnap = endAnchor.winch;
              pts[pts.length - 1] = {
                x: endAnchor.point.x,
                y: endAnchor.point.y,
              };
            } else {
              edgeSnap.end = normalizeEndSnap(endAnchor);
              pts[pts.length - 1] = {
                x: endAnchor.point.x,
                y: endAnchor.point.y,
              };
            }
          }
        } else {
          pts[pts.length - 1] = { x: mergeEnd.point.x, y: mergeEnd.point.y };
        }
      } else {
        pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
      }

      const exclude = pulleyCenterExcludeIdsForStroke(
        pts,
        stickyFromStroke(
          simplify(pending.points, 0.5),
          new Set(),
          edgeSnap.start,
          edgeSnap.end
        ),
        edgeSnap.start,
        edgeSnap.end
      );
      let stickyIds = stickyFromStroke(
        simplify(pending.points, 0.5),
        exclude,
        edgeSnap.start,
        edgeSnap.end
      );

      if (selfClose) {
        commitRope(el, pts, true, null, stickyIds);
      } else if (mergeStart && mergeEnd) {
        ensureRopeEdgeSnap(mergeStart.rope);
        ensureRopeEdgeSnap(mergeEnd.rope);
        stickyIds = joinWrapIds(
          wrapIdsAlongMerge(mergeStart.rope, mergeStart.which, "before"),
          stickyIds,
          wrapIdsAlongMerge(mergeEnd.rope, mergeEnd.which, "after")
        );
        let mergedPts = concatPoints(
          { points: mergeStart.rope.points, closed: false },
          mergeStart.which,
          pts
        );
        mergedPts = concatPoints(
          { points: mergedPts, closed: false },
          "end",
          mergeEnd.which === "end"
            ? mergeEnd.rope.points.slice().reverse()
            : mergeEnd.rope.points.slice()
        );
        const mergedEdge = outerEdgeSnaps(
          mergeStart.rope,
          mergeStart.which,
          mergeEnd.rope,
          mergeEnd.which
        );
        stickyIds = stickyIds.filter(
          (id) =>
            !pulleyCenterExcludeIdsForStroke(
              mergedPts,
              stickyIds,
              mergedEdge.start,
              mergedEdge.end
            ).has(id)
        );
        removeRope(mergeEnd.rope);
        removeRope(mergeStart.rope);
        commitRope(el, mergedPts, false, mergedEdge, stickyIds);
      } else if (mergeStart) {
        ensureRopeEdgeSnap(mergeStart.rope);
        stickyIds = joinWrapIds(
          wrapIdsAlongMerge(mergeStart.rope, mergeStart.which, "before"),
          stickyIds
        ).filter((id) => !exclude.has(id));
        const mergedPts = concatPoints(
          { points: mergeStart.rope.points, closed: false },
          mergeStart.which,
          pts
        );
        const mergedEdge = {
          start:
            mergeStart.which === "end"
              ? mergeStart.rope.edgeSnap.start
              : mergeStart.rope.edgeSnap.end,
          end: edgeSnap.end,
        };
        stickyIds = stickyIds.filter(
          (id) =>
            !pulleyCenterExcludeIdsForStroke(
              mergedPts,
              stickyIds,
              mergedEdge.start,
              mergedEdge.end
            ).has(id)
        );
        removeRope(mergeStart.rope);
        commitRope(el, mergedPts, false, mergedEdge, stickyIds);
      } else if (mergeEnd) {
        ensureRopeEdgeSnap(mergeEnd.rope);
        stickyIds = joinWrapIds(
          stickyIds,
          wrapIdsAlongMerge(mergeEnd.rope, mergeEnd.which, "after")
        ).filter((id) => !exclude.has(id));
        const mergedPts = concatPoints(
          { points: pts, closed: false },
          "end",
          mergeEnd.which === "end"
            ? mergeEnd.rope.points.slice().reverse()
            : mergeEnd.rope.points.slice()
        );
        const mergedEdge = {
          start: edgeSnap.start,
          end:
            mergeEnd.which === "start"
              ? mergeEnd.rope.edgeSnap.end
              : mergeEnd.rope.edgeSnap.start,
        };
        stickyIds = stickyIds.filter(
          (id) =>
            !pulleyCenterExcludeIdsForStroke(
              mergedPts,
              stickyIds,
              mergedEdge.start,
              mergedEdge.end
            ).has(id)
        );
        removeRope(mergeEnd.rope);
        commitRope(el, mergedPts, false, mergedEdge, stickyIds);
      } else {
        stickyIds = stickyIds.filter((id) => !exclude.has(id));
        commitRope(el, pts, false, edgeSnap, stickyIds);
      }

      const rope = ropes.find((r) => r.el === el);
      if (rope) {
        if (startWeightSnap) attachRopeEndToWeight(rope, "start", startWeightSnap);
        if (endWeightSnap) attachRopeEndToWeight(rope, "end", endWeightSnap);
        if (startWinchSnap) attachRopeEndToWinch(rope, "start", startWinchSnap);
        if (endWinchSnap) attachRopeEndToWinch(rope, "end", endWinchSnap);
      }

      pending = null;
      clearPendingHandles();
      setConfirmVisible(false);
      restorePendingAttachOpacity();
      clearDraftState();
      endUserAction();
    }

    ropeLayer.addEventListener("pointerdown", (e) => {
      if (tool !== "freehand" || running) return;
      if (e.button != null && e.button !== 0) return;

      if (pending && !drawing) {
        const pendingHandle = pendingHandles.find((h) => h === e.target);
        if (pendingHandle) {
          const which =
            pendingHandle.dataset.pendingEnd === "start" ? "start" : "end";
          resumeDrawingFromEndpoint(
            which,
            stagePoint(e),
            e.pointerId
          );
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const ropeHandle = endHandles.find((h) => h.el === e.target);
        if (ropeHandle) {
          const snap = ropeEndSnapFromHandle(ropeHandle);
          if (snap) {
            resumeDrawingFromHand(
              preferredPendingEndForSnap(snap),
              snap,
              stagePoint(e),
              e.pointerId
            );
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        const near = findSnapTarget(stagePoint(e), null);
        if (near) {
          resumeDrawingFromHand(
            preferredPendingEndForSnap(near),
            near,
            stagePoint(e),
            e.pointerId
          );
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      beginUserAction();
      syncRopeViewBox();
      const p = stagePoint(e);
      attachTo = null;
      attachFrom = findSnapTarget(p, null);
      if (attachFrom) {
        points = [{ x: attachFrom.point.x, y: attachFrom.point.y }];
        attachFrom.rope.el.style.opacity = "0.25";
      } else {
        points = [p];
      }
      drawing = true;
      pointerId = e.pointerId;
      draft = document.createElementNS("http://www.w3.org/2000/svg", "path");
      draft.classList.add("rope-path", "is-freehand-draft");
      draft.setAttribute("d", pointsToPolyline(points));
      ropeLayer.appendChild(draft);
      ropeLayer.setPointerCapture(e.pointerId);
      e.preventDefault();
      updateDraftRaw();
    });

    ropeLayer.addEventListener("pointermove", (e) => {
      if (pending && !drawing) {
        const snap = findSnapTarget(stagePoint(e), null);
        if (snap) showSnapMarker(snap.point);
        else hideSnapMarker();
        return;
      }
      if (!drawing || e.pointerId !== pointerId) return;
      const p = stagePoint(e);
      if (drawingFromEnd === "start") {
        const first = points[0];
        if (!first || dist(first, p) >= 1.5) {
          points.unshift({ x: p.x, y: p.y });
        }
      } else {
        const last = points[points.length - 1];
        if (!last || dist(last, p) >= 1.5) {
          points.push(p);
        }
      }

      const preview = effectivePoints();
      if (drawingFromEnd === "start") {
        const near = findSnapTarget(preview[0], attachTo?.rope || null);
        if (near) attachFrom = near;
      } else {
        const near = findSnapTarget(
          preview[preview.length - 1],
          attachFrom?.rope || null
        );
        if (near) attachTo = near;
      }

      updateDraftRaw();
    });

    function finishStroke(e) {
      if (!drawing || (e && e.pointerId !== pointerId)) return;
      drawing = false;
      pointerId = null;

      if (!draft || points.length < 2) {
        if (draft) draft.remove();
        clearDraftState();
        cancelUserAction();
        return;
      }

      const preview = effectivePoints();
      if (!attachTo && preview.length >= 2 && drawingFromEnd !== "start") {
        attachTo = findSnapTarget(
          preview[preview.length - 1],
          attachFrom?.rope || null
        );
      }
      if (!attachFrom && preview.length >= 2 && drawingFromEnd === "start") {
        attachFrom = findSnapTarget(preview[0], attachTo?.rope || null);
      }
      drawingFromEnd = null;

      draft.classList.remove("is-freehand-draft");
      draft.classList.add("is-freehand-pending");
      pending = {
        el: draft,
        points: points.slice(),
        attachFrom,
        attachTo,
      };
      if (pending.attachFrom?.rope?.el) {
        pending.attachFrom.rope.el.style.opacity = "0.25";
      }
      if (
        pending.attachTo?.rope?.el &&
        pending.attachTo.rope !== pending.attachFrom?.rope
      ) {
        pending.attachTo.rope.el.style.opacity = "0.25";
      }
      attachFrom = null;
      attachTo = null;
      draft = null;
      points = [];
      hideSnapMarker();
      updatePendingPath();
      setConfirmVisible(true);
      syncRopeEndHandles();
    }

    ropeLayer.addEventListener("pointerup", (e) => {
      finishStroke(e);
    });
    ropeLayer.addEventListener("pointercancel", (e) => {
      finishStroke(e);
    });

    if (freehandConfirmOk) {
      freehandConfirmOk.addEventListener("click", () => confirmPending());
    }
    if (freehandConfirmCancel) {
      freehandConfirmCancel.addEventListener("click", () => {
        discardPending(true);
      });
    }
  }

  function enableFreeDrag(el) {
    let dragging = false;
    let moved = false;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    let startX = 0;
    let startY = 0;
    let pointerId = null;

    function onMove(ev) {
      if (!dragging || ev.pointerId !== pointerId) return;
      const overStock = isOverStock(ev.clientX, ev.clientY);
      setStockDropTarget(overStock);
      if (overStock) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START_SLOP) {
        return;
      }
      moved = true;
      const { rect, width, height } = stageSize();
      const elRect = el.getBoundingClientRect();
      const w = elRect.width;
      const h = elRect.height;
      el.style.left = `${clamp(
        ev.clientX - rect.left - grabOffsetX,
        0,
        Math.max(0, width - w)
      )}px`;
      el.style.top = `${clamp(
        ev.clientY - rect.top - grabOffsetY,
        0,
        Math.max(0, height - h)
      )}px`;
      pruneRopeWraps();
      rebuildAllRopes();
      syncAllWeightsToSnap();
      updateForceArrows();
      syncPulleyResizeHandle();
    }

    function endDrag(ev) {
      if (!dragging || (ev && ev.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      el.classList.remove("is-dragging");
      setStockDropTarget(false);
      if (ev && isOverStock(ev.clientX, ev.clientY)) {
        returnPulleyToStock(el);
      } else if (moved) {
        resettleRopeWraps();
      }
      endUserAction();
    }

    el.addEventListener("pointerdown", (e) => {
      if (tool !== "move" || running) return;
      if (e.button != null && e.button !== 0) return;
      if (isStockTemplate(el)) return;
      beginUserAction();
      const { rect } = stageSize();
      const elRect = el.getBoundingClientRect();
      // Vykreslený obdélník bývá zaokrouhlený na pixely, styl drží přesnou polohu
      const styleLeft = parseFloat(el.style.left);
      const styleTop = parseFloat(el.style.top);
      const startLeft = Number.isFinite(styleLeft)
        ? styleLeft
        : elRect.left - rect.left;
      const startTop = Number.isFinite(styleTop) ? styleTop : elRect.top - rect.top;
      el.style.left = `${startLeft}px`;
      el.style.top = `${startTop}px`;
      grabOffsetX = e.clientX - rect.left - startLeft;
      grabOffsetY = e.clientY - rect.top - startTop;
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      moved = false;
      pointerId = e.pointerId;
      el.classList.add("is-dragging");
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {
        /* iPad Safari — window listenery níže */
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
      e.preventDefault();
    });
  }

  function enableFixedEdgeDrag(el, initial) {
    let edge = initial?.edge || el.dataset.edge || "top";
    let along = initial?.along != null ? initial.along : 0;
    let dragging = false;
    let moved = false;
    let pointerId = null;
    let grabOffsetAlong = 0;
    let startX = 0;
    let startY = 0;

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
      syncPulleyResizeHandle();
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

    /** Cíl tažení se drží místa, za které kladku držíme — jinak by ucukla. */
    function dragTarget(x, y) {
      const nextEdge = nearestEdge(x, y);
      if (nextEdge !== edge) grabOffsetAlong = 0;
      return { edge: nextEdge, along: alongForEdge(nextEdge, x, y) - grabOffsetAlong };
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
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      moved = false;
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
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_START_SLOP) {
        return;
      }
      const { rect } = stageSize();
      const target = dragTarget(e.clientX - rect.left, e.clientY - rect.top);
      moved = true;
      apply(target.edge, target.along);
      if (pruneRopeWraps()) rebuildAllRopes();
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
      if (moved) {
        if (e) {
          const { rect } = stageSize();
          const target = dragTarget(e.clientX - rect.left, e.clientY - rect.top);
          apply(target.edge, target.along);
        }
        resettleRopeWraps();
      }
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
    const { width } = stageSize();
    const off = getWeightHookOffset(weight);
    return {
      x: clamp(
        point.x,
        off.x,
        width - (weight.el.offsetWidth - off.x)
      ),
      y: Math.max(off.y, point.y),
    };
  }

  const SIM_TOUCH_EPS = 1;

  function getWeightBounds(weight) {
    const left = parseFloat(weight.el.style.left) || 0;
    const top = parseFloat(weight.el.style.top) || 0;
    const w = weight.el.offsetWidth || 70;
    const h = weight.el.offsetHeight || 67;
    return { left, top, right: left + w, bottom: top + h };
  }

  function circleIntersectsRect(cx, cy, r, rect) {
    const closestX = clamp(cx, rect.left, rect.right);
    const closestY = clamp(cy, rect.top, rect.bottom);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= r * r;
  }

  function isWeightExcludedFromPulleyTouch(weight, pulley) {
    if (weight.snap.type === "rod" && weight.snap.pulley === pulley.el) return true;
    if (weight.snap.type === "rope" && weight.snap.rope) {
      ensureRopeEdgeSnap(weight.snap.rope);
      const snap = weight.snap.rope.edgeSnap[weight.snap.which];
      if (isPulleyCenterSnap(snap) && snap.pulleyId === pulley.id) return true;
    }
    return false;
  }

  function weightTouchesPulley(weight, pulley) {
    if (isWeightExcludedFromPulleyTouch(weight, pulley)) return false;
    const wheel = getWheelWorld(pulley.el, pulley.kind);
    return circleIntersectsRect(
      wheel.cx,
      wheel.cy,
      wheel.r,
      getWeightBounds(weight)
    );
  }

  function pulleysTouch(a, b) {
    const wa = getWheelWorld(a.el, a.kind);
    const wb = getWheelWorld(b.el, b.kind);
    const d = Math.hypot(wa.cx - wb.cx, wa.cy - wb.cy);
    return d < wa.r + wb.r - SIM_TOUCH_EPS;
  }

  /** Volná kladka u horního/levého/pravého okraje — spodní okraj je povolený. */
  function isFreePulleyTouchingNonBottomEdge(pulley) {
    const el = pulley.el;
    const { width } = stageSize();
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    const w = el.offsetWidth || 0;
    if (left <= SIM_TOUCH_EPS) return true;
    if (top <= SIM_TOUCH_EPS) return true;
    if (left >= width - w - SIM_TOUCH_EPS) return true;
    return false;
  }

  function shouldAbortSimulation() {
    const active = pulleys.filter((p) => !isDocked(p.el));

    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        if (pulleysTouch(active[i], active[j])) return true;
      }
    }

    for (const pulley of active) {
      if (pulley.kind === "free" && isFreePulleyTouchingNonBottomEdge(pulley)) {
        return true;
      }
    }

    for (const weight of weights) {
      if (isDocked(weight.el)) continue;
      for (const pulley of active) {
        if (weightTouchesPulley(weight, pulley)) return true;
      }
    }

    return false;
  }

  function freePulleyIsOnRope(pulley) {
    for (const rope of ropes) {
      if (!rope.el.isConnected || rope.closed) continue;
      const model = rope.sim?.model || computeRopeModel(rope);
      if (getRopeFreePulleys(rope, model).some((p) => p.id === pulley.id)) {
        return true;
      }
      ensureRopeEdgeSnap(rope);
      for (const which of ["start", "end"]) {
        const snap = rope.edgeSnap[which];
        if (isPulleyCenterSnap(snap) && snap.pulleyId === pulley.id) return true;
      }
    }
    return false;
  }

  function ropeSegmentPoints(rope) {
    const pts = rope.points.slice();
    if (!pts.length) return pts;
    if (running && rope.sim && !rope.closed) {
      pts[0] = { ...rope.sim.startPt };
      pts[pts.length - 1] = { ...rope.sim.endPt };
    } else {
      pts[0] = { ...getRopeEndPoint(rope, "start") };
      pts[pts.length - 1] = { ...getRopeEndPoint(rope, "end") };
    }
    return pts;
  }

  function distPointToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-8) return dist(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = clamp(t, 0, 1);
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }

  function segmentSupportsWheel(a, b, wheel, tol) {
    const bottomY = wheel.cy + wheel.r * 0.92;
    const left = wheel.cx - wheel.r * 1.05;
    const right = wheel.cx + wheel.r * 1.05;
    const contact = { x: wheel.cx, y: bottomY };
    if (distPointToSegment(contact, a, b) <= tol) {
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (x >= left && x <= right && y >= bottomY - tol && y <= bottomY + tol * 2) {
          return true;
        }
      }
    }
    return false;
  }

  function freePulleyHasRopeSupport(pulley) {
    const wheel = getWheelWorld(pulley.el, "free");
    const tol = Math.max(14, wheel.r * 0.4);
    for (const rope of ropes) {
      if (!rope.el.isConnected) continue;
      const pts = ropeSegmentPoints(rope);
      for (let i = 0; i < pts.length - 1; i += 1) {
        if (segmentSupportsWheel(pts[i], pts[i + 1], wheel, tol)) return true;
      }
    }
    return false;
  }

  function simulateFreePulleys(dt) {
    for (const pulley of pulleys) {
      if (pulley.kind !== "free" || isDocked(pulley.el)) continue;
      if (freePulleyIsOnRope(pulley)) continue;
      if (freePulleyHasRopeSupport(pulley)) continue;

      pulley.vel.x = 0;
      pulley.vel.y += GRAVITY * dt;
      clampBodySpeed(pulley.vel);
      moveFreePulleyBy(pulley, 0, pulley.vel.y * dt);

      const rodW = weights.find(
        (w) => w.snap.type === "rod" && w.snap.pulley === pulley.el
      );
      if (rodW) {
        const rod = getFreeRodEnd(pulley.el);
        if (rod) placeWeightAtHook(rodW, rod);
      }
    }
  }

  function moveFreePulleyBy(pulley, dx, dy) {
    setFreePulleyPositionDelta(pulley, dx, dy);
    rebuildAllRopes();
  }

  /** Model lana pro zkušební sadu obepnutí — do lana nic nezapisuje. */
  function modelForWrapIds(rope, ids) {
    return computeRopeModel(
      {
        points: rope.points,
        closed: false,
        edgeSnap: rope.edgeSnap,
        wrapIds: ids,
      },
      { preserveWraps: true }
    );
  }

  /**
   * O kolik nejméně by se lano muselo prodloužit, aby se kola ještě dotklo.
   * Velká hodnota znamená, že lano ke kladce vede (nesená kladka), malá, že se
   * jí jen otírá. Když lano diskem prochází, obepnutí je nutné → Infinity.
   */
  function minWrapDetour(rope, ids, wheel, startPt, endPt) {
    const rest = ids.filter((x) => x !== wheel.id);
    const { pts } = modelChain(modelForWrapIds(rope, rest), startPt, endPt);
    const center = { x: wheel.cx, y: wheel.cy };
    let best = Infinity;

    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const q = closestPointOnSegment(a, b, center);
      if (dist(q, center) < wheel.r) return Infinity;
      const touch = moveToward(center, q, wheel.r);
      best = Math.min(best, dist(a, touch) + dist(touch, b) - dist(a, b));
    }
    return best;
  }

  /**
   * Uvolní obepnutí, které lano nijak nevede — kladku uživatel odtáhl a lano se
   * jí jen otírá. Nesená kladka (lano k ní zajíždí) i kladka, kterou by lano
   * jinak procházelo, zůstávají.
   */
  function wrapIdsWithoutStale(rope, startPt, endPt) {
    let ids = (rope.wrapIds || []).slice();
    if (ids.length < 1) return ids;

    for (let guard = 0; guard <= ids.length; guard += 1) {
      const wheels = collectWheels();
      let stale = null;

      for (const id of ids) {
        const wheel = wheels.find((w) => w.id === id);
        if (!wheel) continue;
        if (minWrapDetour(rope, ids, wheel, startPt, endPt) < WRAP_STALE_DETOUR) {
          stale = id;
          break;
        }
      }

      if (!stale) break;
      ids = ids.filter((x) => x !== stale);
    }
    return ids;
  }

  /** Rovné úseky lana mezi obepnutími (a od konců k prvnímu/poslednímu). */
  function modelStraightSegments(model, startPt, endPt) {
    const { pts, items } = modelChain(model, startPt, endPt);
    const out = [];
    let from = 0;
    for (const item of items) {
      out.push([pts[from], pts[item.enterIdx]]);
      from = item.enterIdx + 1;
    }
    out.push([pts[from], pts[pts.length - 1]]);
    return out;
  }

  /**
   * Navlečení, kterým lano projít nemůže: obepnutí v tomto pořadí nevznikne,
   * nebo by rovný úsek musel projít diskem kladky.
   */
  function wrapOrderIsImpossible(rope, ids, startPt, endPt) {
    const model = modelForWrapIds(rope, ids);
    if (model.wraps.length !== ids.length) return true;
    const wheels = collectWheels().filter((w) => ids.includes(w.id));
    for (const [a, b] of modelStraightSegments(model, startPt, endPt)) {
      for (const wheel of wheels) {
        if (segmentPiercesWheel(a, b, wheel, 3)) return true;
      }
    }
    return false;
  }

  /**
   * Obepnutí kladky hned u konce uvázaného za její osu se při kreslení zahodí
   * (z osy jde lano rovně), takže takové pořadí by obepnutí tiše smazalo.
   */
  function wrapOrderKeepsCenterTies(rope, ids) {
    const start = normalizeEndSnap(rope.edgeSnap?.start);
    const end = normalizeEndSnap(rope.edgeSnap?.end);
    if (isPulleyCenterSnap(start) && ids[0] === start.pulleyId) return false;
    if (isPulleyCenterSnap(end) && ids[ids.length - 1] === end.pulleyId) {
      return false;
    }
    return true;
  }

  /**
   * Navlečené lano si pořadí kladek nevybírá, i kdyby jiné bylo kratší — pořadí
   * proto měníme jen tehdy, když se stávajícím po přesunu kladky lano projít
   * nedá. Z průchodných pořadí pak vezmeme nejkratší.
   */
  function wrapIdsInTautOrder(rope, ids, startPt, endPt) {
    if (ids.length < 2) return ids;
    if (!wrapOrderIsImpossible(rope, ids, startPt, endPt)) return ids;

    const seen = new Set([ids.join("|")]);
    const queue = [ids.slice()];
    let best = null;
    let bestLen = Infinity;

    while (queue.length && seen.size <= WRAP_REORDER_MAX_TRIES) {
      const cur = queue.shift();
      for (let i = 0; i + 1 < cur.length; i += 1) {
        const cand = cur.slice();
        cand[i] = cur[i + 1];
        cand[i + 1] = cur[i];
        const key = cand.join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(cand);
        if (!wrapOrderKeepsCenterTies(rope, cand)) continue;
        if (wrapOrderIsImpossible(rope, cand, startPt, endPt)) continue;
        const len = measureModelLength(
          modelForWrapIds(rope, cand),
          startPt,
          endPt
        );
        if (len < bestLen) {
          best = cand;
          bestLen = len;
        }
      }
    }
    return best || ids;
  }

  function setRopeWrapIds(rope, ids) {
    const prev = rope.wrapIds || [];
    if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) {
      return false;
    }
    rope.wrapIds = ids;
    return true;
  }

  /**
   * Body lana srovná s vykresleným tvarem (konce + tečné body). Bez toho by
   * původní tah po přesunu kladek tvrdil starou topologii a hned obnovil
   * obepnutí, které geometrie zrušila.
   */
  function syncRopePointsToShape(rope) {
    if (rope.closed) return;
    const startPt = getRopeEndPoint(rope, "start");
    const endPt = getRopeEndPoint(rope, "end");
    const { pts } = modelChain(
      modelForWrapIds(rope, rope.wrapIds || []),
      startPt,
      endPt
    );
    if (pts.length >= 2) {
      rope.points = pts.map((p) => ({ x: p.x, y: p.y }));
    }
  }

  function ropesWithWraps() {
    return ropes.filter(
      (rope) => rope.el.isConnected && !rope.closed && rope.wrapIds?.length
    );
  }

  /** Během tažení kladky: uvolni obepnutí, která lano už nedrží. */
  function pruneRopeWraps() {
    if (running) return false;
    let changed = false;
    for (const rope of ropesWithWraps()) {
      const startPt = getRopeEndPoint(rope, "start");
      const endPt = getRopeEndPoint(rope, "end");
      if (setRopeWrapIds(rope, wrapIdsWithoutStale(rope, startPt, endPt))) {
        syncRopePointsToShape(rope);
        changed = true;
      }
    }
    return changed;
  }

  /** Po dotažení kladky: uvolni odpadlá obepnutí a oprav jejich pořadí. */
  function resettleRopeWraps() {
    if (running) return;
    let changed = false;
    for (const rope of ropesWithWraps()) {
      const startPt = getRopeEndPoint(rope, "start");
      const endPt = getRopeEndPoint(rope, "end");
      const pruned = wrapIdsWithoutStale(rope, startPt, endPt);
      const ordered = wrapIdsInTautOrder(rope, pruned, startPt, endPt);
      if (setRopeWrapIds(rope, ordered)) changed = true;
      syncRopePointsToShape(rope);
    }
    if (changed) {
      rebuildAllRopes();
      syncAllWeightsToSnap();
      updateForceArrows();
    }
  }

  function rebuildRope(rope, opts = {}) {
    syncRopeEdgePoints(rope);
    if (!opts.preserveWraps) {
      maybeStraightenCenterAnchoredRope(rope);
    }
    const exclude = pulleyCenterExcludeIdsForStroke(
      rope.points,
      rope.wrapIds,
      rope.edgeSnap.start,
      rope.edgeSnap.end
    );
    if (running && rope.sim) {
      rope.el.setAttribute(
        "d",
        buildRopeFromModel(rope.sim.model, rope.sim.startPt, rope.sim.endPt)
      );
      return;
    }

    const startPt = getRopeEndPoint(rope, "start");
    const endPt = getRopeEndPoint(rope, "end");
    const model = computeRopeModel(rope, opts);

    if (model.wraps.length && !rope.closed) {
      const live = liveWrapGeometry(model, startPt, endPt);
      if (live) {
        for (let i = 0; i < model.wraps.length; i += 1) {
          model.wraps[i].clockwise = live.cws[i];
          model.wraps[i].enterAng = live.enterAng[i];
          model.wraps[i].leaveAng = live.leaveAng[i];
        }
      }
      if (!opts.preserveWraps) {
        rope.wrapIds = model.wraps
          .map((w) => w.wheelId)
          .filter(Boolean)
          .filter((id) => !exclude.has(id));
      }
      rope.el.setAttribute("d", buildRopeFromModel(model, startPt, endPt));
      return;
    }

    if (!opts.preserveWraps) {
      rope.wrapIds = (rope.wrapIds || []).filter((id) => !exclude.has(id));
    }
    const renderPts = rope.points.slice();
    if (!rope.closed) {
      renderPts[0] = { ...startPt };
      renderPts[renderPts.length - 1] = { ...endPt };
    }
    rope.el.setAttribute(
      "d",
      buildRopePath(renderPts, rope.closed, rope.wrapIds, exclude, {
        ...opts,
        edgeSnap: rope.edgeSnap,
      })
    );
  }

  /**
   * Volný konec lana, který leží na ose kladky, se za ni uváže. Když kladka
   * konci přijede osou pod ruku (posun, změna velikosti, krok zpět), lano jinak
   * vypadá uvázané, ale nenese žádný tah. Spouští se až po dokončení úkonu, aby
   * kladka tažená přes plochu nesbírala konce, kterých se jen mimochodem dotkne.
   */
  function adoptRopeEndsAtPulleyCenters() {
    if (running || settling) return false;
    let tied = false;
    const wheels = collectWheels();
    for (const rope of ropes) {
      if (!rope.el.isConnected || rope.closed) continue;
      ensureRopeEdgeSnap(rope);
      for (const which of ["start", "end"]) {
        if (rope.edgeSnap[which]) continue;
        if (isRopeEndTaken(rope, which, null, null)) continue;
        const p = getRopeEndPoint(rope, which);
        let best = null;
        for (const wheel of wheels) {
          const d = dist(p, { x: wheel.cx, y: wheel.cy });
          if (d > pulleyCenterSnapRadius(wheel)) continue;
          if (!best || d < best.d) best = { id: wheel.id, d };
        }
        if (!best) continue;

        rope.edgeSnap[which] = { type: "pulleyCenter", pulleyId: best.id };
        // Z osy jde lano rovně, přilehlé obepnutí téže kladky proto odpadá
        const ids = (rope.wrapIds || []).slice();
        const at = which === "start" ? 0 : ids.length - 1;
        if (ids[at] === best.id) {
          ids.splice(at, 1);
          rope.wrapIds = ids;
        }
        syncRopeEdgePoint(rope, which);
        tied = true;
      }
    }
    return tied;
  }

  function tieRopeEndsAtPulleyCenters() {
    if (!adoptRopeEndsAtPulleyCenters()) return;
    rebuildAllRopes();
    syncRopeEndHandles();
  }

  function rebuildAllRopes() {
    for (const rope of ropes) {
      if (rope.el.isConnected) rebuildRope(rope);
    }
    if (!running) updateForceArrows();
  }

  function physicsStep(dt) {
    const system = buildRopeSystem();
    applyWinchReeling(system, dt);
    tickWinchSpin(dt);
    integrateBodyVelocities(system, dt);
    projectBodyVelocities(system);
    moveFreePulleyBodies(system, dt);
    simulateRopes(dt);
    simulateFreePulleys(dt);

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
      weight.vel.y += GRAVITY * dt;
      clampBodySpeed(weight.vel);
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
    if (shouldAbortSimulation()) {
      runBlocked = true;
      setTool("move");
      return;
    }
    physicsFrame = requestAnimationFrame(physicsLoop);
  }

  function startSimulation() {
    if (running || runBlocked) return;
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
    updateWinchOverloadMessage();
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
    updateWinchOverloadMessage();
    if (physicsFrame != null) {
      cancelAnimationFrame(physicsFrame);
      physicsFrame = null;
    }
  }

  /** Poloměr zásahu gumy u lana — prst na tabletu, ne šířka tahu. */
  const ERASE_ROPE_HIT_PX = 44;

  function distToRenderedRope(rope, p) {
    const el = rope.el;
    if (el && typeof el.getTotalLength === "function") {
      try {
        const len = el.getTotalLength();
        if (len > 1) {
          const steps = Math.max(16, Math.min(100, Math.ceil(len / 8)));
          let best = Infinity;
          for (let i = 0; i <= steps; i += 1) {
            const q = el.getPointAtLength((len * i) / steps);
            const d = Math.hypot(p.x - q.x, p.y - q.y);
            if (d < best) best = d;
          }
          return best;
        }
      } catch (_) {
        /* getTotalLength umí selhat u prázdné cesty */
      }
    }
    const pts = rope.points;
    if (!pts || pts.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 1; i < pts.length; i += 1) {
      best = Math.min(best, distPointToSegment(p, pts[i - 1], pts[i]));
    }
    return best;
  }

  function findNearestRope(p, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const rope of ropes) {
      if (!rope.el?.isConnected) continue;
      if (rope.el.classList.contains("is-draft")) continue;
      const d = distToRenderedRope(rope, p);
      if (d <= bestD) {
        bestD = d;
        best = rope;
      }
    }
    return best;
  }

  function pointHitsPulleySolid(pulley, p) {
    if (!pulley || isDocked(pulley.el) || isStockTemplate(pulley.el)) {
      return false;
    }
    const wheel = getWheelWorld(pulley.el, pulley.kind);
    if (wheel && Math.hypot(p.x - wheel.cx, p.y - wheel.cy) <= wheel.r + 16) {
      return true;
    }
    if (pulley.kind === "free" && wheel) {
      const tip = getFreeRodEnd(pulley.el);
      if (tip && distPointToSegment(p, { x: wheel.cx, y: wheel.cy }, tip) <= 24) {
        return true;
      }
    }
    return false;
  }

  function clientHitsElement(el, clientX, clientY, pad = 10) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    );
  }

  /**
   * Guma: předměty jen při klepnutí na viditelnou část (ne celý box kladky).
   * Lano má široký zásah a maže se i tahem.
   */
  function eraseAtPointer(e, allowObjects) {
    const p = pointerToStage(e);

    if (allowObjects) {
      for (const weight of weights) {
        if (isDocked(weight.el) || isStockTemplate(weight.el)) continue;
        if (clientHitsElement(weight.el, e.clientX, e.clientY, 12)) {
          destroyWeight(weight);
          return true;
        }
      }
      for (const winch of winches) {
        if (isDocked(winch.el) || isStockTemplate(winch.el)) continue;
        if (clientHitsElement(winch.el, e.clientX, e.clientY, 12)) {
          destroyWinch(winch);
          return true;
        }
      }
      for (const pulley of pulleys) {
        if (pointHitsPulleySolid(pulley, p)) {
          destroyPulley(pulley.el);
          return true;
        }
      }
    }

    const rope = findNearestRope(p, ERASE_ROPE_HIT_PX);
    if (rope) {
      removeRope(rope);
      return true;
    }
    return false;
  }

  function enableEraser() {
    let stroke = null;

    const onDown = (e) => {
      if (tool !== "erase" || running) return;
      if (e.button != null && e.button !== 0) return;
      if (isOverStock(e.clientX, e.clientY)) return;
      beginUserAction();
      stroke = { pointerId: e.pointerId, changed: false };
      try {
        stage.setPointerCapture(e.pointerId);
      } catch (_) {
        /* capture není nutný, tah i tak chytneme na window */
      }
      if (eraseAtPointer(e, true)) stroke.changed = true;
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e) => {
      if (!stroke || e.pointerId !== stroke.pointerId) return;
      if (tool !== "erase" || running) return;
      if (eraseAtPointer(e, false)) stroke.changed = true;
      e.preventDefault();
    };

    const onUp = (e) => {
      if (!stroke || (e && e.pointerId !== stroke.pointerId)) return;
      if (stroke.changed) endUserAction();
      else cancelUserAction();
      stroke = null;
    };

    stage.addEventListener("pointerdown", onDown, true);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
  }

  function enablePulleySelection() {
    stage.addEventListener(
      "pointerdown",
      (e) => {
        if (tool !== "move" || running) return;
        if (e.target.closest(".pulley-resize-handle")) return;
        const pulleyEl = e.target.closest(".pulley");
        if (
          pulleyEl &&
          stage.contains(pulleyEl) &&
          !isStockTemplate(pulleyEl)
        ) {
          return;
        }
        clearPulleySelection();
      },
      true
    );
  }

  if (btnMove) {
    btnMove.addEventListener("click", () => setTool("move"));
  }
  if (btnRope) {
    btnRope.addEventListener("click", () => setTool("pencil"));
  }
  if (btnFreehand) {
    btnFreehand.addEventListener("click", () => setTool("freehand"));
  }
  if (btnRun) {
    btnRun.addEventListener("click", () => {
      if (tool === "run") setTool("move");
      else setTool("run");
    });
  }
  if (btnErase) {
    btnErase.addEventListener("click", () => {
      setTool(tool === "erase" ? "move" : "erase");
    });
  }

  if (btnUndo) btnUndo.addEventListener("click", () => undoLastStep());
  if (btnReset) btnReset.addEventListener("click", () => resetToPreRun());
  if (btnForces) {
    btnForces.addEventListener("click", () => setShowForces(!showForces));
  }
  if (pulleySizeSlider) {
    pulleySizeSlider.addEventListener("input", onPulleySizeSliderInput);
    applyGlobalStageScale(Number(pulleySizeSlider.value) / 100);
  }

  enablePencil();
  enableFreehand();
  enableRopeEndDrag();
  enableStockSpawning();
  enableStockMoveSwitch();
  enableEraser();
  enablePulleySelection();

  syncRopeViewBox();
  updateClearEnabled();
  syncPulleySizeSliderState();
  updateHistoryButtons();
  syncForcesToggleUi();
  bindStockTrayScaleSync();

  window.addEventListener("resize", () => {
    syncRopeViewBox();
    syncStockTrayScale();
    syncForceOverlay();
    syncAllRopeEdgePoints();
    rebuildAllRopes();
    syncRopeEndHandles();
    syncPulleyResizeHandle();
    syncAllWeightsToSnap();
    updateForceArrows();
  });

  requestAnimationFrame(() => updateForceArrows());
})();
