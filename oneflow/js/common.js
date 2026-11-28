// Shared helpers for the project-page figures: SVG construction, the palette, the fallback robot
// scene of the bottleneck figure, and a player that animates each figure
// with requestAnimationFrame while it is on screen.
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  // Palette, shared with styles.css: the neutral studio grays and one blue. Denoising runs from
  // light gray (source noise, a gray speckle) through light blue to the blue #0071E3 of a clean
  // action. An executed action and OneFlow+ are the deep blue #003A7A. Blue also marks whatever is
  // carried across replanning steps (alignment, appended tails, cross-step inputs), and structure
  // stays gray. A forward pass in progress is a moving light-to-deep blue outline (passRing).
  const C = {
    ink: '#1D1D1F', ink2: '#424245', muted: '#6E6E73', faint: '#86868B',
    line: '#E8E8ED', grid: '#D2D2D7', lane: '#F5F5F7', paper: '#FFFFFF',
    blue: '#0071E3', blueSoft: '#9CC8F4', tint: '#F2F7FD', deep: '#003A7A',
    no: '#86868B',
    noise: '#E8E8ED', noiseInk: '#A1A1A6', waveInk: '#515154', clean: '#0071E3', exec: '#003A7A', done: '#D2D2D7',
  };

  const rgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const mix = (a, b, w) => {
    const A = rgb(a), B = rgb(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * w).toString(16).padStart(2, '0')).join('');
  };
  // Fill of an intermediate action chunk at denoising timestep t_i of N.
  const level = (i, N) => mix(C.noise, C.clean, i / N);
  const inkOn = hex => {
    const [r, g, b] = rgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b < 150 ? '#FFFFFF' : C.ink;
  };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const lerp = (a, b, w) => a + (b - a) * w;

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // Set an attribute only when it changes; the players call this every frame.
  function attr(e, k, v) {
    const c = e.__c || (e.__c = {});
    if (c[k] !== v) { c[k] = v; e.setAttribute(k, v); }
  }
  // Rich text: plain strings, or {m, s} for an italic symbol m with subscript s (e.g. X_{k,i}).
  function rich(parent, x, y, parts, attrs) {
    const { fill, size, ...rest } = attrs || {};
    const e = el('text', { x, y, ...rest }, parent);
    // Class rules in the stylesheet outrank presentation attributes, so colour and size go inline.
    if (fill) e.style.fill = fill;
    if (size) e.style.fontSize = `${size}px`;
    return setRich(e, parts);
  }
  // Replace the content of a text element; skipped when the parts are unchanged.
  function setRich(e, parts) {
    parts = [].concat(parts);
    const key = JSON.stringify(parts);
    if (e.__rich === key) return e;
    e.__rich = key;
    e.textContent = '';
    const span = (s, a) => { const t = el('tspan', a, e); t.textContent = s; return t; };
    let back = null;                     // baseline shift to undo after a subscript
    for (const p of parts) {
      const reset = back ? { dy: back } : {};
      back = null;
      if (typeof p === 'string') { span(p, reset); continue; }
      span(p.m, { class: 'mt', ...reset });
      if (p.s != null && p.s !== '') {
        // 0.3em of the 0.72em subscript is 0.216em of the parent text.
        span(String(p.s), { class: 'mt', 'font-size': '0.72em', dy: '0.3em' });
        back = '-0.216em';
      }
    }
    return e;
  }
  const text = (parent, x, y, s, attrs) => rich(parent, x, y, [s], attrs);
  const sym = (m, s) => ({ m, s });

  // Per-SVG definitions: a speckle for source noise, the gradient of a forward pass in progress,
  // and arrowheads in the figure colours.
  let uid = 0;
  function defs(svg) {
    const id = `pf${++uid}`;
    const d = el('defs', {}, svg);
    const p = el('pattern', { id: `${id}-noise`, width: 13, height: 13, patternUnits: 'userSpaceOnUse' }, d);
    for (const [x, y, r] of [[1.4, 2.1, 0.8], [6.2, 1.1, 0.6], [10.6, 3.2, 0.9], [3.9, 5.6, 0.65], [8.3, 6.9, 0.8], [12.1, 8.4, 0.55], [1.9, 9.3, 0.9], [5.7, 11.2, 0.7], [10.1, 11.6, 0.6]]) {
      el('circle', { cx: x, cy: y, r, fill: C.noiseInk }, p);
    }
    const pass = el('linearGradient', { id: `${id}-pass`, x1: 0, y1: 0, x2: 1, y2: 1 }, d);
    el('stop', { offset: 0, 'stop-color': '#7DB8F5' }, pass);
    el('stop', { offset: 0.5, 'stop-color': '#0071E3' }, pass);
    el('stop', { offset: 1, 'stop-color': '#003A7A' }, pass);
    const heads = {};
    for (const [name, color] of Object.entries({ gray: C.faint, blue: C.blue, deep: C.deep, ink: C.ink })) {
      const m = el('marker', { id: `${id}-${name}`, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, d);
      el('path', { d: 'M0,1 L9,5 L0,9 Z', fill: color }, m);
      heads[name] = `url(#${id}-${name})`;
    }
    return { noise: `url(#${id}-noise)`, pass: `url(#${id}-pass)`, heads, root: d, id };
  }

  // ---------- Trajectory cells ----------
  // Every figure draws an action chunk the way the hero does: as a trajectory. A cell is one action
  // of a chunk; its fill encodes the denoising timestep, the speckle the remaining source noise, and
  // the curve crossing it the value of the chunk there, (1 − z) · estimate + z · noise for remaining
  // noise z. Neighbouring cells sample the same positions at their shared edge, so a row of cells
  // reads as one curve: jagged at t_0, the smooth action at t_N. All values are schematic.
  const signal = a => 0.5 + 0.27 * Math.sin(a * 0.78 + 0.6) + 0.11 * Math.sin(a * 1.93 + 1.4);
  const hash = (a, seed = 0) => { const s = Math.sin(seed * 127.1 + a * 311.7 + 12.9898) * 43758.5453; return s - Math.floor(s); };
  // Source noise at action position a (resolved to quarter steps), for the noise sample `seed`.
  const noiseAt = (a, seed = 0) => 0.06 + 0.88 * hash(Math.round(a * 4), seed);
  const blend = (est, z, a, seed = 0) => (1 - z) * est + z * noiseAt(a, seed);
  function cell(parent, x, y, w, h, noiseUrl, rx = 3) {
    const g = el('g', {}, parent);
    const r = el('rect', { x, y, width: w, height: h, rx }, g);
    const n = el('rect', { x, y, width: w, height: h, rx, fill: noiseUrl, 'pointer-events': 'none' }, g);
    const p = el('path', { fill: 'none', 'stroke-width': Math.max(1.1, Math.min(1.7, h / 13)), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    return { g, r, n, p, x, y, w, h };
  }
  // Colour of the curve on a cell with remaining noise z: gray on pale noise, deep blue on the
  // middle timesteps, white on the clean blue.
  const waveInk = z => z > 0.5 ? mix(C.exec, C.waveInk, clamp((z - 0.5) / 0.15)) : mix('#FFFFFF', C.exec, clamp((z - 0.2) / 0.15));
  // Paint a cell: remaining noise z, and optionally `exec` (executed action), `op` (opacity), `tail`
  // (strength of the dashed outline of an appended tail) and the curve: `a` is the action position of
  // the cell and `val(pos)` the chunk's value around it. `half` is half the cell width in action units.
  function paintCell(c, z, { exec = false, op = 1, tail = 0, a = null, val = null, half = 0.43 } = {}) {
    z = clamp(z);
    attr(c.r, 'fill', exec ? C.exec : level(Math.round((1 - z) * 40), 40));
    attr(c.r, 'opacity', op.toFixed(2));
    attr(c.n, 'opacity', exec ? 0 : (z * 0.8 * op).toFixed(2));
    attr(c.r, 'stroke', tail > 0.02 ? C.blue : 'none');
    attr(c.r, 'stroke-width', 1.3);
    attr(c.r, 'stroke-dasharray', '3 2');
    attr(c.r, 'stroke-opacity', tail.toFixed(2));
    if (!val) { attr(c.p, 'opacity', 0); return; }
    const Y = v => c.y + 3 + (1 - clamp(v)) * (c.h - 6), f = v => v.toFixed(1);
    // Five samples per cell: enough for noise to look like noise and for the action to look smooth.
    let d = '';
    for (let q = 0; q <= 4; q++) d += `${q ? 'L' : 'M'}${f(c.x + 0.5 + q * (c.w - 1) / 4)} ${f(Y(val(a + half * (q / 2 - 1))))}`;
    attr(c.p, 'd', d);
    attr(c.p, 'stroke', exec ? '#FFFFFF' : waveInk(z));
    attr(c.p, 'opacity', (op * 0.92).toFixed(2));
  }

  // A forward pass in progress: a gradient outline whose dashes travel while the pass runs.
  // march(ring, t) advances it with the figure clock.
  function passRing(parent, D, attrs) {
    return el('rect', { fill: 'none', stroke: D.pass, 'stroke-width': 2.2, 'stroke-dasharray': '9 5', 'stroke-linecap': 'round', opacity: 0, ...attrs }, parent);
  }
  const march = (ring, t, speed = 16) => attr(ring, 'stroke-dashoffset', (-t * speed).toFixed(1));

  // Particles that travel along a straight connection while data moves through it, as in the hero.
  function flow(parent, n = 3, color = C.blue, r = 1.9) {
    const dots = Array.from({ length: n }, () => el('circle', { r, fill: color, opacity: 0 }, parent));
    return (x1, y1, x2, y2, phase, op) => dots.forEach((d, q) => {
      const f = (((phase + q / n) % 1) + 1) % 1;
      attr(d, 'cx', (x1 + (x2 - x1) * f).toFixed(1)); attr(d, 'cy', (y1 + (y2 - y1) * f).toFixed(1));
      // Each particle fades in at the start of the connection and out at its end.
      attr(d, 'opacity', (op * Math.min(1, f / 0.15, (1 - f) / 0.15)).toFixed(2));
    });
  }

  // A pick-and-place task performed by a white two-link arm, in scene units (100 x 66, y down). Task
  // progress p runs from 0 to TASK_END; each executed action chunk advances it by one keyframe, so the
  // arm's progress shows how many action chunks the policy has delivered.
  const SW = 100, SH = 66, TABLE_Y = 58, BL = 8, PICK_X = 48, PLACE_X = 76;
  const DOWN = TABLE_Y - BL / 2, HOVER = 38, HIGH = 28, SX = 18, SY = 36, L1 = 32, L2 = 30;
  // Keyframes (16 chunks): fallback 2D arm mirrors the 16-chunk two-bowl conveyor stacking sequence.
  const TASK = [
    [42, 30, 0], [PICK_X, HOVER, 0], [PICK_X, DOWN, 0], [PICK_X, DOWN, 1], [60, HIGH, 1],
    [PLACE_X, DOWN, 1], [PLACE_X, DOWN - 4, 0], [60, HIGH, 0], [54, HOVER, 0], [54, DOWN, 0],
    [54, DOWN, 1], [64, HIGH, 1], [PLACE_X, DOWN - 4, 1], [PLACE_X, DOWN - 8, 0],
    [PLACE_X, HOVER, 0], [56, HIGH, 0], [42, 30, 0],
  ];
  const TASK_END = TASK.length - 1;
  // Position along the task path at progress q, linear within a segment.
  const pathAt = q => {
    q = clamp(q, 0, TASK_END);
    const i = Math.min(TASK_END - 1, Math.floor(q)), f = q - i;
    return [lerp(TASK[i][0], TASK[i + 1][0], f), lerp(TASK[i][1], TASK[i + 1][1], f)];
  };
  // Arm state at progress p: motion is eased within each segment.
  function taskAt(p) {
    p = clamp(p, 0, TASK_END);
    const i = Math.min(TASK_END - 1, Math.floor(p)), u = p - i;
    // Minimum-jerk motion: zero velocity and acceleration at each action boundary.
    const f = u ** 3 * (10 - 15 * u + 6 * u ** 2);
    const [x, y] = pathAt(i + f), grip = lerp(TASK[i][2], TASK[i + 1][2], f);
    const block = p >= 3 && p < 8 ? [x, y] : p < 3 ? [PICK_X, DOWN] : [PLACE_X, DOWN];
    return { x, y, grip, block };
  }
  const pts = list => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  // Path points between progress a and b (keyframes in between included).
  function pathPts(a, b) {
    const out = [pathAt(a)];
    for (let i = Math.floor(a) + 1; i < b; i++) out.push(TASK[i]);
    out.push(pathAt(b));
    return out;
  }

  // Draw the scene with its top-left corner at (x, y) and width w. set(p, hl) poses the arm at
  // progress p, draws the path already executed when `trail` is on, and highlights one action
  // chunk hl = { a, b, prog, E }: the segment from a towards b, drawn up to `prog`, with E waypoints
  // for the E executed actions.
  function scene(parent, x, y, w, { bg = C.lane, trail = false, plan = true } = {}) {
    const rendered = window.PFRobotScene?.(window.PF, parent, x, y, w, { bg, trail, plan });
    if (rendered) return rendered;
    const g = el('g', { transform: `translate(${x} ${y}) scale(${w / SW})` }, parent);
    // Local definitions keep every instance independent, including the small chunk cards.
    const id = `robot${++uid}`, d = el('defs', {}, g);
    const gradient = (name, stops, attrs = {}) => {
      const grad = el('linearGradient', { id: `${id}-${name}`, x1: '0%', y1: '0%', x2: '0%', y2: '100%', ...attrs }, d);
      stops.forEach(([offset, color]) => el('stop', { offset, 'stop-color': color }, grad));
      return `url(#${id}-${name})`;
    };
    const shell = gradient('shell', [['0%', '#FFFFFF'], ['32%', '#F5F8F9'], ['62%', '#DCE5E8'], ['100%', '#9EAFB8']]);
    const metal = gradient('metal', [['0%', '#B7C7CF'], ['24%', '#F4F8FA'], ['52%', '#8C9FA9'], ['100%', '#4B616D']]);
    const dark = gradient('dark', [['0%', '#536974'], ['48%', '#263D49'], ['100%', '#142832']]);
    const gold = gradient('gold', [['0%', '#F5CD79'], ['45%', '#E3AA40'], ['100%', '#B67920']]);
    const backdrop = gradient('backdrop', [['0%', '#FFFFFF'], ['100%', bg]]);
    el('rect', { width: SW, height: SH, rx: 5, fill: backdrop }, g);
    el('rect', { x: 4, y: TABLE_Y, width: SW - 8, height: SH - TABLE_Y - 3, rx: 1.5, fill: '#E2E8EA' }, g);
    el('line', { x1: 4, y1: TABLE_Y, x2: SW - 4, y2: TABLE_Y, stroke: '#B6C1C5', 'stroke-width': 0.7 }, g);
    el('rect', { x: PLACE_X - BL / 2 - 2.5, y: TABLE_Y - 0.4, width: BL + 5, height: 1.6, rx: 0.8, fill: '#EFCF92' }, g);
    if (plan) el('polyline', { points: pts(TASK), fill: 'none', stroke: '#C4CFD3', 'stroke-width': 0.7, 'stroke-dasharray': '1.4 1.6', 'stroke-linejoin': 'round' }, g);
    const done = el('polyline', { fill: 'none', stroke: '#8E9DA4', 'stroke-width': 1, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
    const seg = el('polyline', { fill: 'none', stroke: C.blue, 'stroke-width': 1.9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
    const dots = el('g', {}, g);
    const dot = Array.from({ length: 8 }, () => el('circle', { r: 1.55, fill: C.deep, stroke: '#fff', 'stroke-width': 0.7, opacity: 0 }, dots));
    const shadow = el('ellipse', { rx: 5.4, ry: 1.05, fill: '#12202A' }, g);
    const block = el('g', {}, g);
    el('rect', { width: BL, height: BL, rx: 1.3, fill: gold, stroke: '#B78332', 'stroke-width': 0.35 }, block);
    el('rect', { x: 0.8, y: 0.8, width: BL - 1.6, height: 2.1, rx: 0.9, fill: '#F0C46F' }, block);
    // Machined pedestal, a weighted foot and a restrained status strip.
    el('ellipse', { cx: SX + 1, cy: TABLE_Y + 0.8, rx: 10, ry: 1.7, fill: '#233E49', opacity: 0.12 }, g);
    el('rect', { x: SX - 5, y: SY + 2, width: 10, height: TABLE_Y - SY - 4, rx: 2.2, fill: shell, stroke: '#8B9DA6', 'stroke-width': 0.5 }, g);
    el('path', { d: `M${SX + 2.5} ${SY + 7} V${TABLE_Y - 6}`, stroke: '#B3C1C8', 'stroke-width': 0.6 }, g);
    el('rect', { x: SX - 7, y: TABLE_Y - 3.6, width: 14, height: 3.6, rx: 1.2, fill: dark }, g);
    el('line', { x1: SX - 5, y1: TABLE_Y - 3, x2: SX + 5, y2: TABLE_Y - 3, stroke: C.blueSoft, 'stroke-width': 0.7, 'stroke-linecap': 'round' }, g);
    // Links use local coordinates so the satin highlight follows each rigid housing.
    const link = length => {
      const body = el('g', {}, g);
      el('rect', { x: 0, y: -3.6, width: length, height: 7.2, rx: 3.6, fill: dark }, body);
      el('rect', { x: 2, y: -3.1, width: length - 4, height: 6.2, rx: 2.8, fill: shell, stroke: '#91A4AE', 'stroke-width': 0.35 }, body);
      el('path', { d: `M5 -1.9 H${length - 5}`, stroke: '#FFFFFF', 'stroke-width': 0.65, 'stroke-linecap': 'round', opacity: 0.9 }, body);
      el('path', { d: `M6 2 H${length - 6}`, stroke: '#92A5AF', 'stroke-width': 0.45, opacity: 0.65 }, body);
      el('rect', { x: length * 0.45, y: -1, width: 5, height: 1.6, rx: 0.6, fill: '#607B87', opacity: 0.65 }, body);
      return body;
    };
    const link1 = link(L1), link2 = link(L2);
    const joint = r => {
      const cap = el('g', {}, g);
      el('circle', { r, fill: dark, stroke: '#172E3A', 'stroke-width': 0.35 }, cap);
      el('circle', { r: r * 0.74, fill: metal }, cap);
      el('circle', { r: r * 0.48, fill: dark }, cap);
      el('circle', { r: r * 0.19, fill: '#C6D5DC' }, cap);
      el('path', { d: `M${-r * 0.55} ${-r * 0.38} A${r * 0.67} ${r * 0.67} 0 0 1 ${r * 0.38} ${-r * 0.55}`, stroke: '#F7FCFF', 'stroke-width': 0.35, fill: 'none', opacity: 0.8 }, cap);
      return cap;
    };
    const J = [joint(4), joint(3.5), joint(2.6)];
    const grip = el('path', { fill: 'none', stroke: '#2C4350', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    const palmBody = el('rect', { width: 7, height: 3, rx: 0.9, fill: metal, stroke: '#405965', 'stroke-width': 0.4 }, g);
    const at = (e, cx, cy) => attr(e, 'transform', `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`);
    const pose = (e, x1, y1, x2, y2) => attr(e, 'transform', `translate(${x1.toFixed(2)} ${y1.toFixed(2)}) rotate(${(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI).toFixed(3)})`);

    function set(p, hl) {
      const s = taskAt(p), wx = s.x, wy = s.y - 11.5;
      // Two-link inverse kinematics with the elbow raised.
      const d = Math.min(Math.hypot(wx - SX, wy - SY), L1 + L2 - 0.01);
      const a = Math.atan2(wy - SY, wx - SX) - Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
      const ex = SX + L1 * Math.cos(a), ey = SY + L1 * Math.sin(a);
      pose(link1, SX, SY, ex, ey);
      pose(link2, ex, ey, wx, wy);
      at(J[0], SX, SY); at(J[1], ex, ey); at(J[2], wx, wy);
      const palm = s.y - 6.4, tip = s.y + 3.4, f = lerp(BL / 2 + 2.8, BL / 2 + 0.75, s.grip), r2 = v => v.toFixed(2);
      attr(grip, 'd', `M${r2(wx)} ${r2(wy)} V${r2(palm)} M${r2(wx - f)} ${r2(tip)} V${r2(palm)} H${r2(wx + f)} V${r2(tip)}`);
      at(palmBody, wx - 3.5, palm - 1.5);
      const [bx, by] = s.block;
      attr(block, 'transform', `translate(${(bx - BL / 2).toFixed(2)} ${(by - BL / 2).toFixed(2)})`);
      attr(shadow, 'cx', bx.toFixed(2)); attr(shadow, 'cy', TABLE_Y + 0.5);
      attr(shadow, 'rx', (5.4 + clamp((DOWN - by) / 34) * 3).toFixed(2));
      attr(shadow, 'opacity', (0.16 * (1 - clamp((DOWN - by) / 34))).toFixed(3));
      attr(done, 'points', trail && p > 0 ? pts(pathPts(0, clamp(p, 0, TASK_END))) : '');
      if (hl && hl.prog > 0) {
        const end = hl.a + (hl.b - hl.a) * hl.prog;
        attr(seg, 'points', pts(pathPts(hl.a, end)));
        dot.forEach((c, j) => {
          const q = hl.a + (hl.b - hl.a) * (j + 1) / hl.E, on = j < hl.E && q <= end + 1e-6;
          const [cx, cy] = pathAt(q);
          attr(c, 'cx', cx.toFixed(2)); attr(c, 'cy', cy.toFixed(2)); attr(c, 'opacity', on ? 1 : 0);
        });
      } else {
        attr(seg, 'points', '');
        dot.forEach(c => attr(c, 'opacity', 0));
      }
    }
    set(0);
    return { g, set, h: SH * w / SW };
  }

  const ICON_PAUSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9" rx="0.8" fill="currentColor"/><rect x="7.4" y="1.5" width="2.6" height="9" rx="0.8" fill="currentColor"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.6 L10.4 6 L3 10.4 Z" fill="currentColor"/></svg>';

  // Animate render(t, loop) over t in [0, duration] figure units, hold the last state, then loop.
  // Every figure shares this clock: it starts from t = 0 once a good part of the figure is on screen,
  // stops when the figure leaves, and restarts each loop through a short cross-fade instead of a
  // jump. A hairline under the title shows the position in the loop. With reduced motion the figure
  // shows `still` until the reader presses Play. `seamless` loops (no hold, no fade) skip both.
  function play(root, { duration, unitMs, holdMs = 1800, still = duration, ready = Promise.resolve(), render, seamless = false, progress = !seamless }) {
    const btn = root.querySelector('.fig-ctrl'), canvas = root.querySelector('.fig-canvas');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const span = duration * unitMs, total = span + (seamless ? 0 : holdMs), FADE = seamless ? 0 : 260;
    let wanted = !reduced, visible = false, loaded = false, rate = 1, raf = 0, last = 0, loop = 0, fadeIn = false;
    let pos = reduced ? still * unitMs : 0;
    let bar = null;
    if (progress) {
      const track = document.createElement('div');
      track.className = 'fig-progress';
      track.setAttribute('aria-hidden', 'true');
      bar = track.appendChild(document.createElement('i'));
      root.querySelector('.fig-bar').after(track);
    }
    let shown = 1;
    const draw = () => {
      render(Math.min(pos / unitMs, duration), loop);
      if (bar) bar.style.transform = `scaleX(${Math.min(pos / span, 1).toFixed(4)})`;
      if (fadeIn && pos >= FADE) fadeIn = false;
      const o = !FADE ? 1 : pos > total - FADE ? (total - pos) / FADE : fadeIn ? pos / FADE : 1;
      if (o !== shown) { shown = o; canvas.style.opacity = o === 1 ? '' : ease(o).toFixed(3); }
    };
    // `#<figure id>=<t>` in the URL freezes that figure at time t (used for screenshots).
    const pin = new RegExp(`${root.id}=([\\d.]+)`).exec(location.hash);
    if (pin) { pos = Number(pin[1]) * unitMs; draw(); return; }
    function frame(now) {
      pos += last ? Math.min(now - last, 80) * rate : 0;
      last = now;
      if (pos >= total) { pos -= total; loop++; fadeIn = FADE > 0; }
      draw();
      raf = requestAnimationFrame(frame);
    }
    function sync() {
      const run = wanted && visible && loaded && !document.hidden;
      if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
      root.classList.toggle('is-playing', run);
      if (btn) {
        btn.innerHTML = wanted ? `${ICON_PAUSE}Pause` : `${ICON_PLAY}Play`;
        btn.setAttribute('aria-pressed', String(!wanted));
      }
    }
    root.addEventListener('pf:seek', event => { pos = clamp(event.detail, 0, duration) * unitMs; fadeIn = false; wanted = false; draw(); sync(); });
    root.addEventListener('pf:replay', () => { pos = 0; last = 0; fadeIn = false; wanted = true; draw(); sync(); });
    root.addEventListener('pf:toggle', () => { wanted = !wanted; sync(); });
    root.addEventListener('pf:rate', event => { rate = clamp(event.detail, 0.25, 2); });
    document.addEventListener('visibilitychange', sync);
    Promise.resolve(ready).finally(() => { loaded = true; sync(); });
    draw();
    // Start once 35% of the figure, or half a screen of it, is visible; stop when none of it is.
    new IntersectionObserver(([e]) => {
      const cover = e.intersectionRect.height / (e.rootBounds ? e.rootBounds.height : innerHeight);
      if (!e.isIntersecting) visible = false;
      else if (e.intersectionRatio >= 0.35 || cover >= 0.5) visible = true;
      sync();
    }, { threshold: [0, 0.2, 0.35, 0.5, 0.75] }).observe(root);
    if (btn) btn.addEventListener('click', () => { wanted = !wanted; sync(); });
    sync();
  }

  // Opacity of something shown from a to b, with soft edges of width w (figure units).
  const fadeIO = (u, a, b, w = 0.3) => clamp((u - a) / w) * (1 - clamp((u - b) / w));
  // Figures lay themselves out once, for the screen they load on.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;

  // Create the figure's SVG inside its container.
  // `fit` marks a layout drawn for narrow screens, which needs no sideways scrolling.
  function mount(root, W, H, label, fit) {
    const svg = el('svg', { class: fit ? 'fig fit' : 'fig', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
    root.querySelector('.fig-canvas').appendChild(svg);
    return svg;
  }

  window.PF = { C, mix, level, inkOn, clamp, ease, lerp, el, attr, rich, setRich, text, sym, defs, signal, noiseAt, blend, cell, paintCell, waveInk, passRing, march, flow, scene, TASK_END, play, mount, fadeIO, narrow };
})();
