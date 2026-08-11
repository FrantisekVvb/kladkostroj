(function () {
  const stage = document.getElementById("stage");
  const ropeLayer = document.getElementById("rope-layer");
  const btnMove = document.getElementById("tool-move");
  const btnPencil = document.getElementById("tool-pencil");
  const btnRun = document.getElementById("tool-run");
  const btnClear = document.getElementById("tool-clear");

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

  const WEIGHT_COUNT = 5;
  const WEIGHT_SVG = `<svg width="280" height="269" viewBox="0 0 280 269" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="138" cy="50" r="45" stroke="#858585" stroke-width="10"/><path d="M267.34 269H12.3699C6.00343 269 1.2579 263.13 2.59185 256.905L43.3061 66.9047C44.2941 62.294 48.3688 59 53.0842 59H222.101C226.732 59 230.757 62.1791 231.829 66.6838L277.068 256.684C278.564 262.968 273.799 269 267.34 269Z" fill="#858585"/></svg>`;

  const GRAVITY = 520;
  const WEIGHT_MASS = 1;
  /** Hmotnost modré kladky — zanedbatelná. */
  const PULLEY_MASS = 0;
  const SETTLE_MS = 100;
  let running = false;
  let settling = false;
  let settleStartTime = 0;
  let physicsFrame = null;
  let lastPhysicsTime = 0;
  /** @type {HTMLElement | null} */
  let freePulleyEl = null;
  let freePulleyVel = { x: 0, y: 0 };
  /** @type {SVGGElement | null} */
  let forceLayer = null;
  const FORCE_ARROW_SCALE = 0.09;
  const FORCE_ARROW_MIN = 18;
  const FORCE_ARROW_MAX = 90;

  function updateClearEnabled() {
    btnClear.disabled = ropes.length === 0;
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

  function edgePointFromSnap(snap) {
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

  function isRopeEndOnEdge(rope, which) {
    ensureRopeEdgeSnap(rope);
    return rope.edgeSnap[which] != null;
  }

  function getRopeEndPoint(rope, which) {
    ensureRopeEdgeSnap(rope);
    const snap = rope.edgeSnap[which];
    if (snap) return edgePointFromSnap(snap);
    return which === "start"
      ? rope.points[0]
      : rope.points[rope.points.length - 1];
  }

  function syncRopeEdgePoint(rope, which) {
    ensureRopeEdgeSnap(rope);
    const snap = rope.edgeSnap[which];
    if (!snap) return;
    const pt = edgePointFromSnap(snap);
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

  function setTool(next) {
    if (running && next !== "run") stopSimulation();

    tool = next;
    stage.dataset.tool = next;
    btnMove.classList.toggle("is-active", next === "move");
    btnPencil.classList.toggle("is-active", next === "pencil");
    btnRun.classList.toggle("is-run", next === "run");
    btnMove.setAttribute("aria-pressed", String(next === "move"));
    btnPencil.setAttribute("aria-pressed", String(next === "pencil"));
    btnRun.setAttribute("aria-pressed", String(next === "run"));
    btnRun.textContent = next === "run" ? "Zastavit" : "Spustit";

    if (next === "run") startSimulation();
    else syncRopeEndHandles();
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
    const fixed = document.getElementById("fixed-pulley");
    const free = document.getElementById("free-pulley");
    if (fixed) {
      wheels.push({ ...getWheelWorld(fixed, "fixed"), kind: "fixed" });
    }
    if (free) {
      wheels.push({ ...getWheelWorld(free, "free"), kind: "free" });
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
    const p0 = pointOnCircle(wheel, a0);
    const p1 = pointOnCircle(wheel, a1);

    let travel = normalizeAngle(a1 - a0);
    if (clockwise && travel < 0) travel += 2 * Math.PI;
    if (!clockwise && travel > 0) travel -= 2 * Math.PI;
    if (Math.abs(travel) < 1e-6) {
      travel = clockwise ? 2 * Math.PI : -2 * Math.PI;
    }

    const large = Math.abs(travel) > Math.PI + 1e-6 ? 1 : 0;
    const sweep = clockwise ? 1 : 0;

    return {
      start: p0,
      end: p1,
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
      const total = travelFor(a, b, cw);
      const toMid = travelFor(a, m, cw);
      if (Math.sign(total) !== Math.sign(toMid) && Math.abs(toMid) > 0.05) {
        return false;
      }
      if (Math.abs(toMid) > Math.abs(total) + 0.1) return false;
      const fromMid = travelFor(m, b, cw);
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
    return dist(a, b) < 4 && Math.abs(a.r - b.r) < 4;
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
    }
    events.sort((a, b) => a.start - b.start);

    const picked = [];
    for (const ev of events) {
      const last = picked[picked.length - 1];
      // Slučuj jen překryvy na STEJNÉ kladce — jinak zůstanou obě (červená + modrá)
      if (last && ev.start <= last.end && sameWheel(last.wheel, ev.wheel)) {
        if (ev.end - ev.start > last.end - last.start) {
          picked[picked.length - 1] = ev;
        }
        continue;
      }
      picked.push(ev);
    }
    return picked;
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

  /** Směr oblouku podle směru obepnutí z tahu. */
  function resolveArcClockwise(enterAng, leaveAng, hintCw) {
    const hintT = Math.abs(travelFor(enterAng, leaveAng, hintCw));
    if (hintT >= 0.15) return hintCw;
    return !hintCw;
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

    let best = candidates[0];
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
      // Hlavní kritérium: tečna má ležet u nakresleného volného úseku
      if (hintMid) score += distPointToSegment(hintMid, p0, p1) * 3;
      if (hintLeaveAng != null) score += angDist(c.a0, hintLeaveAng) * 25;
      if (hintEnterAng != null) score += angDist(c.a1, hintEnterAng) * 25;

      if (segmentPiercesWheel(p0, p1, w0)) score += 200;
      if (segmentPiercesWheel(p0, p1, w1)) score += 200;

      if (knownEnterAng != null) {
        const arcT = Math.abs(travelFor(knownEnterAng, c.a0, leaveCw));
        if (arcT > Math.PI + 0.15) score += 100;
      }

      // Soft penalizace za nesoulad smyslu obepnutí
      score += Math.max(0, 0.4 - alignOut) * 30;
      score += Math.max(0, 0.4 - alignIn) * 30;

      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return { a0: best.a0, a1: best.a1 };
  }

  function travelFor(a0, a1, clockwise) {
    let travel = normalizeAngle(a1 - a0);
    if (clockwise && travel < 0) travel += 2 * Math.PI;
    if (!clockwise && travel > 0) travel -= 2 * Math.PI;
    if (Math.abs(travel) < 1e-4) {
      travel = clockwise ? 2 * Math.PI : -2 * Math.PI;
    }
    return travel;
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

  function buildRopePath(rawPoints, closed = false) {
    if (rawPoints.length < 2) return pointsToPolyline(rawPoints);

    let pts = simplify(rawPoints, 1.6);
    if (pts.length < 2) pts = rawPoints.slice();

    if (closed && pts.length >= 3) {
      if (dist(pts[0], pts[pts.length - 1]) > 1) {
        pts = pts.concat([{ x: pts[0].x, y: pts[0].y }]);
      } else {
        pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
      }
    }

    const wraps = pickWrapEvents(pts);
    if (!wraps.length) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (closed) return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} Z`;
      return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} L${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }

    const enterAng = new Array(wraps.length);
    const leaveAng = new Array(wraps.length);

    for (let i = 0; i < wraps.length; i += 1) {
      const w = wraps[i];
      if (i === 0 && !closed) {
        enterAng[i] = tangentFromFreePoint(w.wheel, pts[0], w.clockwise, true);
      }
      if (i === wraps.length - 1 && !closed) {
        leaveAng[i] = tangentFromFreePoint(
          w.wheel,
          pts[pts.length - 1],
          w.clockwise,
          false
        );
      }
    }

    for (let i = 0; i < wraps.length - 1; i += 1) {
      const a = wraps[i];
      const b = wraps[i + 1];
      const hintLeave = strokeHintAngle(pts, a.end, a.wheel);
      const hintEnter = strokeHintAngle(pts, b.start, b.wheel);
      const mid = freeSegmentMid(pts, a.end, b.start);
      const tang = commonTangentAngles(
        a.wheel,
        a.clockwise,
        b.wheel,
        b.clockwise,
        hintLeave,
        hintEnter,
        mid,
        enterAng[i] ?? null
      );
      leaveAng[i] = tang.a0;
      enterAng[i + 1] = tang.a1;
    }

    if (closed && wraps.length >= 1) {
      if (wraps.length === 1) {
        const mid = pts[Math.floor(pts.length / 2)];
        enterAng[0] = tangentFromFreePoint(
          wraps[0].wheel,
          mid,
          wraps[0].clockwise,
          true
        );
        leaveAng[0] = enterAng[0];
      } else {
        const a = wraps[wraps.length - 1];
        const b = wraps[0];
        const hintLeave = strokeHintAngle(pts, a.end, a.wheel);
        const hintEnter = strokeHintAngle(pts, b.start, b.wheel);
        const mid = freeSegmentMid(pts, a.end, pts.length - 1) ||
          freeSegmentMid(pts, 0, b.start);
        const tang = commonTangentAngles(
          a.wheel,
          a.clockwise,
          b.wheel,
          b.clockwise,
          hintLeave,
          hintEnter,
          mid
        );
        leaveAng[wraps.length - 1] = tang.a0;
        enterAng[0] = tang.a1;
      }
    }

    for (let i = 0; i < wraps.length; i += 1) {
      const w = wraps[i];
      if (enterAng[i] == null) {
        enterAng[i] = strokeHintAngle(pts, w.start, w.wheel);
      }
      if (leaveAng[i] == null) {
        leaveAng[i] = strokeHintAngle(pts, w.end, w.wheel);
      }
      w.clockwise = resolveArcClockwise(enterAng[i], leaveAng[i], w.clockwise);
      if (Math.abs(travelFor(enterAng[i], leaveAng[i], w.clockwise)) < 0.2) {
        leaveAng[i] =
          enterAng[i] + (w.clockwise ? Math.PI * 0.8 : -Math.PI * 0.8);
      }
    }

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
      lineTo(arc.start);
      const large = Math.abs(arc.travel) > Math.PI + 1e-6 ? 1 : 0;
      const sweep = clockwise ? 1 : 0;
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
    let pts = simplify(rope.points, 1.6);
    if (pts.length < 2) pts = rope.points.slice();

    const wraps = pickWrapEvents(pts);
    if (!wraps.length) return { wraps: [], closed: rope.closed };

    const enterAng = new Array(wraps.length);
    const leaveAng = new Array(wraps.length);

    for (let i = 0; i < wraps.length; i += 1) {
      const w = wraps[i];
      if (i === 0 && !rope.closed) {
        enterAng[i] = tangentFromFreePoint(w.wheel, pts[0], w.clockwise, true);
      }
      if (i === wraps.length - 1 && !rope.closed) {
        leaveAng[i] = tangentFromFreePoint(
          w.wheel,
          pts[pts.length - 1],
          w.clockwise,
          false
        );
      }
    }

    for (let i = 0; i < wraps.length - 1; i += 1) {
      const a = wraps[i];
      const b = wraps[i + 1];
      const tang = commonTangentAngles(
        a.wheel,
        a.clockwise,
        b.wheel,
        b.clockwise,
        strokeHintAngle(pts, a.end, a.wheel),
        strokeHintAngle(pts, b.start, b.wheel),
        freeSegmentMid(pts, a.end, b.start),
        enterAng[i] ?? null
      );
      leaveAng[i] = tang.a0;
      enterAng[i + 1] = tang.a1;
    }

    for (let i = 0; i < wraps.length; i += 1) {
      const w = wraps[i];
      if (enterAng[i] == null) {
        enterAng[i] = strokeHintAngle(pts, w.start, w.wheel);
      }
      if (leaveAng[i] == null) {
        leaveAng[i] = strokeHintAngle(pts, w.end, w.wheel);
      }
      w.clockwise = resolveArcClockwise(enterAng[i], leaveAng[i], w.clockwise);
      if (Math.abs(travelFor(enterAng[i], leaveAng[i], w.clockwise)) < 0.2) {
        leaveAng[i] =
          enterAng[i] + (w.clockwise ? Math.PI * 0.8 : -Math.PI * 0.8);
      }
    }

    const modelWraps = wraps.map((w, i) => ({
      wheelKind: w.wheel.kind || "free",
      enterAng: enterAng[i],
      leaveAng: leaveAng[i],
      clockwise: w.clockwise,
      hintEnterAng: enterAng[i],
      hintLeaveAng: leaveAng[i],
    }));

    return { wraps: modelWraps, closed: rope.closed };
  }

  function resolveModelWheel(kind) {
    const wheels = collectWheels();
    if (kind === "fixed") return wheels[0] || null;
    return wheels[1] || wheels[0] || null;
  }

  function wrapAnglesAtEndpoints(model, startPt, endPt, w, wheel, index, count) {
    let enterAng = w.enterAng;
    let leaveAng = w.leaveAng;
    if (!model.closed) {
      if (index === 0) {
        enterAng = tangentFromFreePoint(wheel, startPt, w.clockwise, true);
      }
      if (index === count - 1) {
        leaveAng = tangentFromFreePoint(wheel, endPt, w.clockwise, false);
      }
    }
    return { enterAng, leaveAng };
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
      const wheel = resolveModelWheel(w.wheelKind);
      if (!wheel) continue;
      const { enterAng, leaveAng } = wrapAnglesAtEndpoints(
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
      len += Math.abs(travelFor(enterAng, leaveAng, w.clockwise)) * wheel.r;
      prev = arcEnd;
    }
    len += dist(prev, endPt);
    return len;
  }

  function modelTangentPoints(model, startPt, endPt) {
    if (!model.wraps.length) return null;
    const first = model.wraps[0];
    const last = model.wraps[model.wraps.length - 1];
    const w0 = resolveModelWheel(first.wheelKind);
    const w1 = resolveModelWheel(last.wheelKind);
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
      lineTo(arc.start);
      const large = Math.abs(arc.travel) > Math.PI + 1e-6 ? 1 : 0;
      const sweep = clockwise ? 1 : 0;
      d += `A${wheel.r.toFixed(2)} ${wheel.r.toFixed(2)} 0 ${large} ${sweep} ${arc.end.x.toFixed(2)} ${arc.end.y.toFixed(2)}`;
      pen = arc.end;
    }

    if (!model.closed) lineTo(startPt);

    const count = model.wraps.length;
    for (let i = 0; i < count; i += 1) {
      const w = model.wraps[i];
      const wheel = resolveModelWheel(w.wheelKind);
      if (!wheel) continue;
      const { enterAng, leaveAng } = wrapAnglesAtEndpoints(
        model,
        startPt,
        endPt,
        w,
        wheel,
        i,
        count
      );
      addArc(wheel, enterAng, leaveAng, w.clockwise);
    }

    if (model.closed) {
      const w0 = resolveModelWheel(model.wraps[0].wheelKind);
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

  /** Aktuální simulační bod konce lana — háček závaží, okraj nebo tah. */
  function getRopeSimEndpoint(rope, which) {
    const w = weightOnRopeEnd(rope, which);
    if (w) return getWeightHookWorld(w);
    return getRopeEndPoint(rope, which);
  }

  function applyRopeSimEndpoints(rope, startPt, endPt) {
    const { model, restLength } = rope.sim;
    const { height } = stageSize();
    const floorY = height - 8;

    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const offS = startW ? getWeightHookOffset(startW) : { x: 0, y: 0 };
    const offE = endW ? getWeightHookOffset(endW) : { x: 0, y: 0 };

    const corrected = enforceRopeLength(model, startPt, endPt, restLength);

    if (isRopeEndOnEdge(rope, "start") && !startW) {
      corrected.start = getRopeEndPoint(rope, "start");
    }
    if (isRopeEndOnEdge(rope, "end") && !endW) {
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
    const startEdge = isRopeEndOnEdge(rope, "start") && !startW;
    const endEdge = isRopeEndOnEdge(rope, "end") && !endW;

    let startPt = startEdge
      ? getRopeEndPoint(rope, "start")
      : startW
        ? getWeightHookWorld(startW)
        : { ...rope.sim.startPt };
    let endPt = endEdge
      ? getRopeEndPoint(rope, "end")
      : endW
        ? getWeightHookWorld(endW)
        : { ...rope.sim.endPt };

    const corrected = enforceRopeLength(model, startPt, endPt, restLength);

    if (startEdge) corrected.start = getRopeEndPoint(rope, "start");
    else if (startW) corrected.start = getWeightHookWorld(startW);
    if (endEdge) corrected.end = getRopeEndPoint(rope, "end");
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
      const wheel = resolveModelWheel(w.wheelKind);
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
    if (opts.pulleyFree && freePulleyEl) {
      const left0 = parseFloat(freePulleyEl.style.left) || 0;
      const top0 = parseFloat(freePulleyEl.style.top) || 0;
      freePulleyEl.style.left = `${left0 + eps}px`;
      const movedX = measureModelLength(model, startPt, endPt);
      freePulleyEl.style.left = `${left0}px`;
      freePulleyEl.style.top = `${top0 + eps}px`;
      const movedY = measureModelLength(model, startPt, endPt);
      freePulleyEl.style.top = `${top0}px`;
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

  function freePulleyMass() {
    const rodW = weights.find((w) => w.snap.type === "rod");
    return PULLEY_MASS + (rodW ? WEIGHT_MASS : 0);
  }

  /**
   * Napětí v laně T a zrychlení volných těles z podmínky konstantní délky lana.
   * Závaží = hmotné body. Modrá kladka má zanedbatelnou hmotnost (+ závaží na tyči).
   */
  function computeRopeDynamics(rope, model, startPt, endPt) {
    const startW = weightOnRopeEnd(rope, "start");
    const endW = weightOnRopeEnd(rope, "end");
    const hasFree =
      model.wraps.some((w) => w.wheelKind === "free") ||
      ropeWrapsFreeWheel(rope);
    const rodW = weights.find((w) => w.snap.type === "rod");
    const pulleyMass = freePulleyMass();

    const attach = getRopeAttachmentVectors(model, startPt, endPt);
    const pulleyU = freePulleyRopeForceUnit(attach);
    const grad = numericalLengthGradient(model, startPt, endPt, {
      startFree: !!startW,
      endFree: !!endW,
      pulleyFree: hasFree && pulleyMass > 1e-8,
    });

    let numerator = 0;
    let denominator = 0;

    if (startW) {
      const Fg = { x: 0, y: WEIGHT_MASS * GRAVITY };
      numerator += vecDot(grad.start, Fg) / WEIGHT_MASS;
      denominator += vecDot(grad.start, attach.startU) / WEIGHT_MASS;
    }
    if (endW) {
      const Fg = { x: 0, y: WEIGHT_MASS * GRAVITY };
      numerator += vecDot(grad.end, Fg) / WEIGHT_MASS;
      denominator += vecDot(grad.end, attach.endU) / WEIGHT_MASS;
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

    if (startW) {
      netForce.start = {
        x: tension * attach.startU.x,
        y: WEIGHT_MASS * GRAVITY + tension * attach.startU.y,
      };
      accel.start = {
        x: netForce.start.x / WEIGHT_MASS,
        y: netForce.start.y / WEIGHT_MASS,
      };
    }
    if (endW) {
      netForce.end = {
        x: tension * attach.endU.x,
        y: WEIGHT_MASS * GRAVITY + tension * attach.endU.y,
      };
      accel.end = {
        x: netForce.end.x / WEIGHT_MASS,
        y: netForce.end.y / WEIGHT_MASS,
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

    return { tension, accel, netForce, attach, pulleyMass, pulleyU, rodW };
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
    const len = clamp(mag * FORCE_ARROW_SCALE, FORCE_ARROW_MIN, FORCE_ARROW_MAX);
    return {
      x: (fx / mag) * len,
      y: (fy / mag) * len,
      mag,
    };
  }

  function drawForceArrow(origin, fx, fy, kind, label) {
    const scaled = scaleForceArrow(fx, fy);
    if (!scaled) return;
    const layer = ensureForceLayer();
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("force-arrow", `is-${kind}`);

    const x2 = origin.x + scaled.x;
    const y2 = origin.y + scaled.y;
    const ang = Math.atan2(scaled.y, scaled.x);
    const head = 9;
    const hx1 = x2 - head * Math.cos(ang - 0.4);
    const hy1 = y2 - head * Math.sin(ang - 0.4);
    const hx2 = x2 - head * Math.cos(ang + 0.4);
    const hy2 = y2 - head * Math.sin(ang + 0.4);

    const shaft = document.createElementNS("http://www.w3.org/2000/svg", "line");
    shaft.classList.add("force-arrow-shaft");
    shaft.setAttribute("x1", origin.x.toFixed(1));
    shaft.setAttribute("y1", origin.y.toFixed(1));
    shaft.setAttribute("x2", x2.toFixed(1));
    shaft.setAttribute("y2", y2.toFixed(1));
    g.appendChild(shaft);

    const headEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    headEl.classList.add("force-arrow-head");
    headEl.setAttribute(
      "points",
      `${x2.toFixed(1)},${y2.toFixed(1)} ${hx1.toFixed(1)},${hy1.toFixed(1)} ${hx2.toFixed(1)},${hy2.toFixed(1)}`
    );
    g.appendChild(headEl);

    if (label) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.classList.add("force-arrow-label");
      text.setAttribute("x", (x2 + Math.cos(ang) * 10).toFixed(1));
      text.setAttribute("y", (y2 + Math.sin(ang) * 10).toFixed(1));
      text.textContent = label;
      g.appendChild(text);
    }

    layer.appendChild(g);
  }

  function updateForceArrows() {
    clearForceArrows();
    syncForceOverlay();

    for (const rope of ropes) {
      const state = getRopeForceState(rope);
      if (!state) continue;
      const { model, startPt, endPt } = state;
      const dyn = computeRopeDynamics(rope, model, startPt, endPt);
      const T = dyn.tension;
      const startW = weightOnRopeEnd(rope, "start");
      const endW = weightOnRopeEnd(rope, "end");
      const hasFree =
        model.wraps.some((w) => w.wheelKind === "free") ||
        ropeWrapsFreeWheel(rope);
      const rodW = dyn.rodW;

      if (startW) {
        const origin = getWeightHookWorld(startW);
        const gx = 0;
        const gy = WEIGHT_MASS * GRAVITY;
        const tx = T * dyn.attach.startU.x;
        const ty = T * dyn.attach.startU.y;
        drawForceArrow(origin, gx, gy, "gravity", "G");
        drawForceArrow(origin, tx, ty, "tension", "T");
        drawForceArrow(origin, gx + tx, gy + ty, "net", "Σ");
      }

      if (endW) {
        const origin = getWeightHookWorld(endW);
        const gx = 0;
        const gy = WEIGHT_MASS * GRAVITY;
        const tx = T * dyn.attach.endU.x;
        const ty = T * dyn.attach.endU.y;
        drawForceArrow(origin, gx, gy, "gravity", "G");
        drawForceArrow(origin, tx, ty, "tension", "T");
        drawForceArrow(origin, gx + tx, gy + ty, "net", "Σ");
      }

      if (hasFree) {
        const wheel = getFreePulleyWheel();
        if (!wheel) continue;
        const origin = { x: wheel.cx, y: wheel.cy };
        const gx = 0;
        const gy = dyn.pulleyMass * GRAVITY;
        const t1x = T * -dyn.attach.freeEnterU.x;
        const t1y = T * -dyn.attach.freeEnterU.y;
        const t2x = T * dyn.attach.freeLeaveU.x;
        const t2y = T * dyn.attach.freeLeaveU.y;
        if (dyn.pulleyMass > 1e-8) {
          drawForceArrow(origin, gx, gy, "gravity", "G");
        }
        drawForceArrow(origin, t1x, t1y, "tension", "T₁");
        drawForceArrow(origin, t2x, t2y, "tension", "T₂");
        drawForceArrow(
          origin,
          gx + t1x + t2x,
          gy + t1y + t2y,
          "net",
          "Σ"
        );

        if (rodW) {
          const hook = getWeightHookWorld(rodW);
          drawForceArrow(hook, gx, gy, "gravity", "G");
          drawForceArrow(
            hook,
            gx + t1x + t2x,
            gy + t1y + t2y,
            "net",
            "Σ"
          );
        }
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
    const hasFree = ropeWrapsFreeWheel(rope);
    const rodW = weights.find((w) => w.snap.type === "rod");

    const { tension, accel } = computeRopeDynamics(
      rope,
      rope.sim.model,
      startPt,
      endPt
    );
    rope.sim.tension = tension;

    // Bez setrvačnosti: rychlost = aktuální zrychlení ze sil (neakumuluje se)
    if (startW) {
      startW.vel.x = accel.start.x;
      startW.vel.y = accel.start.y;
      startPt.x += startW.vel.x * dt;
      startPt.y += startW.vel.y * dt;
    } else if (isRopeEndOnEdge(rope, "start")) {
      startPt = getRopeEndPoint(rope, "start");
    }

    if (endW) {
      endW.vel.x = accel.end.x;
      endW.vel.y = accel.end.y;
      endPt.x += endW.vel.x * dt;
      endPt.y += endW.vel.y * dt;
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

    if (hasFree) {
      freePulleyVel.x = accel.pulley.x;
      freePulleyVel.y = accel.pulley.y;
      moveFreePulleyBy(freePulleyVel.x * dt, freePulleyVel.y * dt);
      const maxTop = Math.max(0, height - (freePulleyEl?.offsetHeight || 0));
      const maxLeft = Math.max(0, width - (freePulleyEl?.offsetWidth || 0));
      if (parseFloat(freePulleyEl?.style.top) >= maxTop - 0.5) freePulleyVel.y = 0;
      if (parseFloat(freePulleyEl?.style.left) <= 0.5) freePulleyVel.x = 0;
      if (parseFloat(freePulleyEl?.style.left) >= maxLeft - 0.5) freePulleyVel.x = 0;
    }

    let corrected = enforceRopeLength(model, startPt, endPt, restLength);

    if (isRopeEndOnEdge(rope, "start") && !startW) {
      corrected.start = getRopeEndPoint(rope, "start");
    }
    if (isRopeEndOnEdge(rope, "end") && !endW) {
      corrected.end = getRopeEndPoint(rope, "end");
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

    if (rodW && hasFree) {
      rodW.vel.x = freePulleyVel.x;
      rodW.vel.y = freePulleyVel.y;
      const rod = getFreeRodEnd();
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

  function getFreeRodEnd() {
    const free = document.getElementById("free-pulley");
    if (!free) return null;
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

  function isRodTaken(excludeWeight) {
    return weights.some(
      (w) => w !== excludeWeight && w.snap.type === "rod"
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
    const rod = getFreeRodEnd();
    if (rod && !isRodTaken(excludeWeight)) {
      targets.push({ type: "rod", point: rod });
    }

    for (const rope of ropes) {
      if (!rope.el.isConnected || rope.closed) continue;
      for (const end of ropeEnds(rope)) {
        if (isRopeEndTakenByWeight(rope, end.which, excludeWeight)) continue;
        targets.push({
          type: "rope",
          point: end.point,
          rope: end.rope,
          which: end.which,
        });
      }
    }

    for (const w of weights) {
      if (w === excludeWeight || !w.el.isConnected) continue;
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
    if (weight.dragging) return;

    if (weight.snap.type === "rod") {
      const rod = getFreeRodEnd();
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
      weight.snap = { type: "rod" };
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

  function createWeight(id) {
    const el = document.createElement("div");
    el.className = "weight";
    el.id = id;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "Závaží");
    el.innerHTML = WEIGHT_SVG;
    stage.appendChild(el);
    return {
      el,
      snap: { type: "free" },
      vel: { x: 0, y: 0 },
      dragging: false,
    };
  }

  function layoutWeightsOnBottom() {
    const { width, height } = stageSize();
    const gap = 10;
    const w = weights[0]?.el.offsetWidth || 70;
    const h = weights[0]?.el.offsetHeight || 67;
    const total = weights.length * w + (weights.length - 1) * gap;
    const startX = Math.max(8, (width - total) / 2);
    const top = height - h - 10;
    weights.forEach((weight, i) => {
      weight.el.style.left = `${startX + i * (w + gap)}px`;
      weight.el.style.top = `${top}px`;
      weight.snap = { type: "free" };
      weight.vel = { x: 0, y: 0 };
    });
  }

  function initWeights() {
    for (let i = 0; i < WEIGHT_COUNT; i += 1) {
      const weight = createWeight(`weight-${i + 1}`);
      enableWeightDrag(weight);
      weights.push(weight);
    }
    layoutWeightsOnBottom();
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

      const snap = findWeightSnapTarget(weight);
      if (snap) applyWeightSnap(weight, snap);
      else updateForceArrows();
    }

    weight.el.addEventListener("pointerup", finish);
    weight.el.addEventListener("pointercancel", finish);
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

  function commitRope(el, points, closed, edgeSnap) {
    const d = buildRopePath(points, closed);
    el.classList.remove("is-draft", "is-snapping");
    el.setAttribute("d", d);
    if (closed) el.dataset.closed = "true";
    else delete el.dataset.closed;

    const existing = ropes.find((r) => r.el === el);
    const nextEdge = edgeSnap || { start: null, end: null };
    if (existing) {
      existing.points = points;
      existing.closed = closed;
      if (edgeSnap) existing.edgeSnap = nextEdge;
      else ensureRopeEdgeSnap(existing);
    } else {
      ropes.push({ el, points, closed, edgeSnap: nextEdge });
    }
    syncRopeCount();
    syncRopeEndHandles();
    updateForceArrows();
  }

  function removeRope(rope) {
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
    rope.edgeSnap[which] = { edge: snap.edge, along: clampEdgeAlong(snap.edge, snap.along) };
    syncRopeEdgePoint(rope, which);
    rope.el.setAttribute("d", buildRopePath(rope.points, rope.closed));
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
    rope.el.setAttribute("d", buildRopePath(rope.points, rope.closed));
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
        const edgeSnap = findEdgeSnapTarget(p);
        if (edgeSnap) {
          attachRopeEndToEdge(
            dragging.rope,
            dragging.which,
            edgeSnap,
            dragging.el
          );
          showSnapMarker(edgeSnap.point);
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
      const edgeSnap = ropeSnap ? null : findEdgeSnapTarget(p);
      const snapPoint = ropeSnap?.point || edgeSnap?.point;
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
      const edgeSnap = ropeSnap ? null : findEdgeSnapTarget(p);

      dragging.el.classList.remove("is-dragging", "is-snapping");
      hideSnapMarker();

      if (ropeSnap) {
        mergeRopesAtEnds(
          dragging.rope,
          dragging.which,
          ropeSnap.rope,
          ropeSnap.which
        );
      } else if (edgeSnap) {
        attachRopeEndToEdge(
          dragging.rope,
          dragging.which,
          edgeSnap,
          dragging.el
        );
      } else {
        updateRopeEndPoint(dragging.rope, dragging.which, p);
      }

      dragging = null;
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

    function stagePoint(e) {
      const { rect } = stageSize();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function effectivePoints() {
      if (!attachFrom) return points;
      return concatPoints(attachFrom.rope, attachFrom.which, points);
    }

    function updateDraft() {
      if (!draft) return;
      const pts = effectivePoints();
      const selfClose =
        !attachFrom &&
        pts.length >= 4 &&
        dist(pts[pts.length - 1], pts[0]) <= CLOSE_SNAP_RADIUS;
      const endSnap = findSnapTarget(
        pts[pts.length - 1],
        attachFrom && attachFrom.rope
      );
      const endEdgeSnap =
        endSnap || selfClose ? null : findEdgeSnapTarget(pts[pts.length - 1]);

      if (selfClose) {
        showSnapMarker(pts[0]);
        draft.classList.add("is-snapping");
        draft.setAttribute("d", buildRopePath(pts, true));
      } else if (endSnap) {
        showSnapMarker(endSnap.point);
        draft.classList.add("is-snapping");
        const preview = pts.slice();
        preview[preview.length - 1] = {
          x: endSnap.point.x,
          y: endSnap.point.y,
        };
        draft.setAttribute("d", buildRopePath(preview, false));
      } else if (endEdgeSnap) {
        showSnapMarker(endEdgeSnap.point);
        draft.classList.add("is-snapping");
        const preview = pts.slice();
        preview[preview.length - 1] = {
          x: endEdgeSnap.point.x,
          y: endEdgeSnap.point.y,
        };
        draft.setAttribute("d", buildRopePath(preview, false));
      } else {
        hideSnapMarker();
        draft.classList.remove("is-snapping");
        draft.setAttribute("d", buildRopePath(pts, false));
      }
    }

    ropeLayer.addEventListener("pointerdown", (e) => {
      if (tool !== "pencil") return;
      if (e.button != null && e.button !== 0) return;
      syncRopeViewBox();
      const p = stagePoint(e);
      startEdgeSnap = null;
      attachFrom = findSnapTarget(p, null);
      if (attachFrom) {
        points = [{ x: attachFrom.point.x, y: attachFrom.point.y }];
      } else {
        const edgeSnap = findEdgeSnapTarget(p);
        if (edgeSnap) {
          startEdgeSnap = { edge: edgeSnap.edge, along: edgeSnap.along };
          points = [{ x: edgeSnap.point.x, y: edgeSnap.point.y }];
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
        : findEdgeSnapTarget(pts[pts.length - 1]);

      if (startEdgeSnap) edgeSnap.start = startEdgeSnap;
      if (endEdgeSnap) {
        pts[pts.length - 1] = { x: endEdgeSnap.point.x, y: endEdgeSnap.point.y };
        edgeSnap.end = { edge: endEdgeSnap.edge, along: endEdgeSnap.along };
      }

      if (selfClose) {
        pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
        closed = true;
        commitRope(draft, pts, true);
      } else if (endSnap) {
        ensureRopeEdgeSnap(endSnap.rope);
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
            end: endSnap.which === "end" ? otherEdgeSnap.start : otherEdgeSnap.end,
          };
        }
        removeRope(endSnap.rope);
        if (attachFrom) removeRope(attachFrom.rope);
        commitRope(draft, pts, false, mergedEdge);
      } else if (attachFrom) {
        ensureRopeEdgeSnap(attachFrom.rope);
        edgeSnap.start = attachFrom.rope.edgeSnap.start;
        if (attachFrom.which === "start") {
          edgeSnap.end = endEdgeSnap
            ? { edge: endEdgeSnap.edge, along: endEdgeSnap.along }
            : null;
        } else {
          edgeSnap.end = endEdgeSnap
            ? { edge: endEdgeSnap.edge, along: endEdgeSnap.along }
            : attachFrom.rope.edgeSnap.end;
        }
        removeRope(attachFrom.rope);
        commitRope(draft, pts, false, edgeSnap);
      } else {
        commitRope(draft, pts, false, edgeSnap);
      }

      draft = null;
      points = [];
      attachFrom = null;
      startEdgeSnap = null;
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
      syncAllWeightsToSnap();
      updateForceArrows();
    }

    el.addEventListener("pointerdown", (e) => {
      if (tool !== "move" || running) return;
      if (e.button != null && e.button !== 0) return;
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
      moveTo(e.clientX, e.clientY);
    });

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      el.classList.remove("is-dragging");
    }

    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  }

  function enableFixedEdgeDrag(el) {
    let edge = "top";
    let along = 0;
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
      const { rect } = stageSize();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const nextEdge = nearestEdge(x, y);
      apply(nextEdge, alongForEdge(nextEdge, x, y));
      dragging = false;
      pointerId = null;
      el.classList.remove("is-dragging");
    }

    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);

    window.addEventListener("resize", () => {
      apply(edge, along);
      syncRopeViewBox();
    });

    requestAnimationFrame(() => {
      const { width: sw } = stageSize();
      apply("top", sw * 0.28);
      syncRopeViewBox();
    });
  }

  function getFreePulleyWheel() {
    const wheels = collectWheels();
    return wheels.length >= 2 ? wheels[1] : null;
  }

  function wheelsMatch(a, b) {
    if (!a || !b) return false;
    return dist(a, b) < 4 && Math.abs(a.r - b.r) < 4;
  }

  function ropeWrapsFreeWheel(rope) {
    if (rope.sim?.model?.wraps?.some((w) => w.wheelKind === "free")) {
      return true;
    }
    const freeWheel = getFreePulleyWheel();
    if (!freeWheel) return false;
    return pickWrapEvents(rope.points).some((ev) =>
      wheelsMatch(ev.wheel, freeWheel)
    );
  }

  function isRopeEndTaken(rope, which, excludeWeight) {
    return isRopeEndTakenByWeight(rope, which, excludeWeight);
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

  function moveFreePulleyBy(dx, dy) {
    if (!freePulleyEl) return;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
    const { width, height } = stageSize();
    const maxLeft = Math.max(0, width - freePulleyEl.offsetWidth);
    const maxTop = Math.max(0, height - freePulleyEl.offsetHeight);
    const left = clamp(parseFloat(freePulleyEl.style.left) + dx, 0, maxLeft);
    const top = clamp(parseFloat(freePulleyEl.style.top) + dy, 0, maxTop);
    freePulleyEl.style.left = `${left}px`;
    freePulleyEl.style.top = `${top}px`;
    rebuildAllRopes();
  }

  function rebuildRope(rope) {
    if (running && rope.sim) {
      rope.el.setAttribute(
        "d",
        buildRopeFromModel(rope.sim.model, rope.sim.startPt, rope.sim.endPt)
      );
    } else {
      syncRopeEdgePoints(rope);
      rope.el.setAttribute("d", buildRopePath(rope.points, rope.closed));
    }
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
    running = true;
    freePulleyVel = { x: 0, y: 0 };
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
    freePulleyVel = { x: 0, y: 0 };
    for (const weight of weights) weight.vel = { x: 0, y: 0 };
    clearRopeSimulation();
    rebuildAllRopes();
    syncAllWeightsToSnap();
    syncRopeEndHandles();
    updateForceArrows();
    if (physicsFrame != null) {
      cancelAnimationFrame(physicsFrame);
      physicsFrame = null;
    }
  }

  btnMove.addEventListener("click", () => setTool("move"));
  btnPencil.addEventListener("click", () => setTool("pencil"));
  btnRun.addEventListener("click", () => {
    if (tool === "run") setTool("move");
    else setTool("run");
  });
  btnClear.addEventListener("click", () => {
    ropeLayer.querySelectorAll(".rope-path").forEach((p) => p.remove());
    ropes = [];
    hideSnapMarker();
    clearEndHandles();
    updateClearEnabled();
    updateForceArrows();
  });

  enablePencil();
  enableRopeEndDrag();

  const free = document.getElementById("free-pulley");
  const fixed = document.getElementById("fixed-pulley");
  freePulleyEl = free;
  initWeights();
  if (free) {
    enableFreeDrag(free);
    requestAnimationFrame(() => {
      const { rect } = stageSize();
      const elRect = free.getBoundingClientRect();
      free.style.left = `${elRect.left - rect.left}px`;
      free.style.top = `${elRect.top - rect.top}px`;
    });
  }
  if (fixed) enableFixedEdgeDrag(fixed);

  syncRopeViewBox();
  updateClearEnabled();

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
