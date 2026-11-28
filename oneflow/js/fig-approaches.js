// Comparison figure: four ways to query a flow policy in steady state, on one clock. Each row shows
// the state a method keeps (left), its forward passes and delivered action chunks (middle) and three
// properties (right).
//   Sequential: N serial passes from fresh noise at every replanning step.
//   Parallel samplers: K batched rounds that refine all timesteps jointly, again from fresh noise.
//   Streaming policies: one buffer whose noise level rises along the horizon; one pass per step,
//     but the policy must be trained on such inputs (steady state shown).
//   OneFlow: N + 1 complete chunks, each at a single noise level. Each step shifts them by E,
//     advances every chunk one denoising timestep in one batched pass of
//     the frozen policy, and executes the first E actions of the clean chunk.
// Durations are schematic: OneFlow runs one batched pass per step aligned with streaming policies.
(function () {
  const { C, mix, level, el, attr, rich, text, sym, defs, play, mount, clamp, ease, fadeIO, passRing, march } = PF;
  const root = document.getElementById('fig-approaches');
  if (!root) return;

  const N = 4, HZ = 8, E = 2, K = 3, BATCH = 1.4, SPAN = 12;
  const W = 1120, ROW = 118, TOP = 44, H = TOP + 4 * ROW + 44;
  const svg = mount(root, W, H, 'Sequential sampling, parallel samplers, streaming policies and OneFlow compared in steady state on one clock.');
  const D = defs(svg);

  const LX = 18, SX = 232, CW = 13, CH = 9, GAP = 2, PH = CH + GAP, PW = CW + GAP;
  const TX0 = 410, TX1 = 846, ux = (TX1 - TX0) / SPAN, X = t => TX0 + t * ux;
  const PX = [910, 990, 1070];
  const SHADE = q => mix(C.blueSoft, C.deep, q / (N - 1));
  const PAR = mix(C.blueSoft, C.blue, 0.45);         // the batched rounds of a parallel sampler

  const head = el('g', {}, svg);
  text(head, SX + (HZ * PW) / 2, TOP - 24, 'State between replanning steps', { class: 't-small t-mid' });
  text(head, (TX0 + TX1) / 2, TOP - 24, 'Forward passes and delivered action chunks, schematic time', { class: 't-small t-mid' });
  [['One pass', 'per step'], ['Reuses', 'chunks'], ['Frozen', 'weights']].forEach(([a, b], j) => {
    text(head, PX[j], TOP - 30, a, { class: 't-small t-mid' });
    text(head, PX[j], TOP - 17, b, { class: 't-small t-mid' });
  });

  // Steps: [start, end, kind]; kind 'seq' (N serial passes), 'par' (K rounds), 'one' (one pass).
  const steps = (len, kind) => {
    const out = [];
    // Keep the last, possibly unfinished step: computation continues to the end of the shared clock.
    // Its real endpoint remains outside the window, so it cannot add a completed action chunk.
    for (let t = 0; t < SPAN - 1e-9; t += len) out.push([t, t + len, kind]);
    return out;
  };
  const METHODS = [
    { key: 'seq', title: 'Sequential', sub: 'native ODE solver', steps: steps(N, 'seq'), marks: [0, 0, 1], note: [sym('N'), ' serial passes per step'] },
    { key: 'par', title: 'Parallel samplers', sub: 'ParaDiGMS, ParaSolver', steps: steps(K * BATCH, 'par'), marks: [0, 0, 1], note: [sym('K'), ' batched rounds per step'] },
    { key: 'str', title: 'Streaming policies', sub: 'SDP, Diffusion Forcing', steps: steps(1, 'one'), marks: [1, 1, 0], note: ['1 pass, retrained policy'] },
    { key: 'pf', title: 'OneFlow', sub: '', steps: steps(1, 'one'), marks: [1, 1, 1], note: ['1 batched pass per step'] },
  ];

  function check(g, x, y, ok) {
    const color = ok ? C.blue : C.no;
    el('circle', { cx: x, cy: y, r: 11, fill: ok ? C.tint : C.lane, stroke: color, 'stroke-width': 1.5 }, g);
    el('path', { d: ok ? `M${x - 5} ${y} l3.5 3.6 l6.5 -7` : `M${x - 4} ${y - 4} l8 8 M${x + 4} ${y - 4} l-8 8`, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  }

  METHODS.forEach((m, r) => {
    const y0 = TOP + r * ROW, g = el('g', {}, svg);
    if (m.key === 'pf') el('rect', { x: 6, y: y0 + 4, width: W - 12, height: ROW - 8, rx: 12, fill: C.tint, stroke: C.line }, g);
    else if (r) el('line', { x1: 12, y1: y0, x2: W - 12, y2: y0, stroke: C.line }, g);
    text(g, LX, m.sub ? y0 + 44 : y0 + ROW / 2, m.title, { class: 't-title', fill: m.key === 'pf' ? C.blue : C.ink });
    if (m.sub) text(g, LX, y0 + 64, m.sub, { class: 't-sub' });
    m.marks.forEach((ok, j) => check(g, PX[j], y0 + ROW / 2, ok));

    // The state: rows -1..N of HZ + E cells inside a clip of rows 0..N and positions 0..HZ-1, so that
    // shifting left by E and moving down one row can be drawn as a translation.
    const rowsN = m.key === 'str' ? 1 : N + 1;
    const sy = y0 + ROW / 2 - (rowsN * PH - GAP) / 2;
    const clip = el('clipPath', { id: `${D.id}-c${r}` }, D.root);
    el('rect', { x: SX - 1, y: sy - 1, width: HZ * PW - GAP + 2, height: rowsN * PH - GAP + 2 }, clip);
    const clipped = el('g', { 'clip-path': `url(#${D.id}-c${r})` }, g);
    m.inner = el('g', {}, clipped);
    m.cells = [];
    const r0 = m.key === 'pf' ? -1 : 0;
    for (let i = r0; i < rowsN; i++) for (let j = 0; j < HZ + E; j++) {
      const x = SX + j * PW, y = sy + i * PH;
      m.cells.push({ i, j, r: el('rect', { x, y, width: CW, height: CH, rx: 2 }, m.inner), n: el('rect', { x, y, width: CW, height: CH, rx: 2, fill: D.noise }, m.inner) });
    }
    m.ring = passRing(g, D, { x: SX - 4, width: HZ * PW - GAP + 8, rx: 5, 'stroke-width': 2, 'stroke-dasharray': '7 4' });
    m.sy = sy;
    if (m.key !== 'str') {
      rich(g, SX - 6, sy + CH / 2, [sym('t', 0)], { class: 't-small t-end' });
      rich(g, SX - 6, sy + N * PH + CH / 2, [sym('t', N)], { class: 't-small t-end' });
    } else {
      text(g, SX, sy - 10, 'clean', { class: 't-small' });
      text(g, SX + HZ * PW - GAP, sy - 10, 'noisy', { class: 't-small t-end' });
    }

    // Timeline: a bar per forward pass that grows while it runs, and a badge per delivered chunk.
    const laneY = y0 + 26, LANE = 22, axisY = y0 + 76;
    el('rect', { x: TX0, y: laneY, width: TX1 - TX0, height: LANE, rx: 4, fill: m.key === 'pf' ? C.paper : C.lane }, g);
    el('line', { x1: TX0, y1: axisY, x2: TX1, y2: axisY, stroke: C.faint, 'stroke-width': 1.2 }, g);
    rich(g, TX1, axisY + 22, m.note, { class: 't-small t-end', fill: C.blue });
    m.count = text(g, TX0, axisY + 22, '', { class: 't-small' });
    m.passes = []; m.outs = [];
    m.steps.forEach(([s, e, kind], k) => {
      const n = kind === 'seq' ? N : kind === 'par' ? K : 1, len = (e - s) / n;
      for (let q = 0; q < n; q++) {
        const ps = s + q * len, pe = ps + len;
        if (ps >= SPAN) break;
        const visibleEnd = Math.min(pe, SPAN);
        const x = X(ps) + (ps === 0 ? 0 : 1), right = X(visibleEnd) - (visibleEnd === SPAN ? 0 : 1);
        const fill = kind === 'seq' ? SHADE(q) : m.key === 'pf' ? D.pass : PAR;
        m.passes.push({ s: ps, e: visibleEnd, w: right - x, bar: el('rect', { x, y: laneY + 3, width: 0, height: LANE - 6, rx: 2.5, fill }, g) });
      }
      if (e > SPAN + 1e-9) return;
      el('line', { x1: X(e), y1: axisY - 4, x2: X(e), y2: axisY + 4, stroke: C.faint }, g);
      const b = el('g', { opacity: 0, transform: `translate(${X(e)} ${axisY})` }, g);
      el('rect', { x: -13, y: -8, width: 26, height: 16, rx: 4, fill: C.ink }, b);
      rich(b, 0, 0, [sym('A', k)], { class: 't-tag t-mid', fill: '#fff', size: 10.5 });
      m.outs.push({ t: e, b });
    });
  });

  const legend = el('g', { transform: `translate(${SX} ${TOP + 4 * ROW + 22})` }, svg);
  text(legend, 0, 0, 'noise level  1', { class: 't-small' });
  for (let q = 0; q <= 10; q++) el('rect', { x: 78 + q * 8, y: -5, width: 8, height: 10, fill: level(q, 10) }, legend);
  el('rect', { x: 78, y: -5, width: 88, height: 10, fill: 'none', stroke: C.line }, legend);
  text(legend, 172, 0, '0', { class: 't-small' });
  el('rect', { x: 210, y: -5, width: 13, height: 10, rx: 2, fill: C.exec }, legend);
  text(legend, 230, 0, 'executed actions', { class: 't-small' });
  passRing(legend, D, { x: 350, y: -6, width: 22, height: 12, rx: 3, opacity: 1, 'stroke-width': 2, 'stroke-dasharray': '6 3' });
  text(legend, 380, 0, 'input to the forward pass', { class: 't-small' });
  el('rect', { x: 548, y: -5, width: 13, height: 10, rx: 2, fill: C.noise, stroke: C.blue, 'stroke-dasharray': '2 1.5' }, legend);
  text(legend, 568, 0, 'appended tail', { class: 't-small' });

  // z: remaining noise in [0, 1]; op: opacity; tail: appended-tail outline strength.
  function paint(c, z, exec, op = 1, tail = 0) {
    z = clamp(z);
    attr(c.r, 'fill', exec ? C.exec : level(Math.round((1 - z) * 40), 40));
    attr(c.r, 'opacity', op.toFixed(2));
    attr(c.n, 'opacity', exec ? 0 : (Math.min(1, z * 0.85 + tail * 0.3) * op).toFixed(2));
    attr(c.r, 'stroke', tail > 0.02 ? C.blue : 'none');
    attr(c.r, 'stroke-dasharray', '2 1.5');
    attr(c.r, 'stroke-opacity', tail.toFixed(2));
  }
  // `on` is the ring's opacity, so callers can fade it at the ends of a pass.
  function ring(m, a, b, dy, on) {
    attr(m.ring, 'opacity', (+on).toFixed(2));
    attr(m.ring, 'y', (m.sy - 4 + (a + dy) * PH).toFixed(1));
    attr(m.ring, 'height', ((b - a + 1) * PH - GAP + 8).toFixed(1));
  }
  const move = (m, s, d) => attr(m.inner, 'transform', `translate(${(-E * PW * s).toFixed(2)} ${(PH * d).toFixed(2)})`);

  // Native N-step sampling inside one step, u in [0, 1]: rows are reached one pass at a time.
  function drawSeq(m, u) {
    move(m, 0, 0);
    const f = u * N, q = Math.min(N - 1, Math.floor(f));
    for (const c of m.cells) {
      if (c.i < 0 || c.j >= HZ) { paint(c, 1, false, 0); continue; }
      // The next row fades in over the second half of the pass that produces it.
      const reached = c.i <= q ? 1 : c.i === q + 1 ? ease((f - q - 0.45) / 0.4) : 0;
      paint(c, 1 - c.i / N, c.i === N && c.j < E && u > 0.96, 0.16 + 0.84 * reached);
    }
    ring(m, q, q, 0, fadeIO(u, 0, 1, 0.06));
  }
  // K joint rounds: every timestep moves from fresh noise towards its converged estimate.
  function drawPar(m, u) {
    move(m, 0, 0);
    const f = u * K, q = Math.min(K - 1, Math.floor(f)), p = clamp((q + ease((f - q) / 0.8)) / K);
    for (const c of m.cells) {
      if (c.j >= HZ) { paint(c, 1, false, 0); continue; }
      const z = c.i === 0 ? 1 : 1 - (c.i / N) * p;
      paint(c, z, c.i === N && c.j < E && u > 0.96);
    }
    ring(m, 0, N - 1, 0, fadeIO(u, 0, 1, 0.06));
  }
  // Streaming policy: one pass lowers every group of E positions by one noise notch, the clean group
  // is executed, then the buffer shifts left by E and a fully noisy group is appended.
  function drawStr(m, u) {
    const G = HZ / E, p = ease(u / 0.5), s = ease((u - 0.68) / 0.3);
    move(m, s, 0);
    for (const c of m.cells) {
      const g = Math.floor(c.j / E), tail = c.j >= HZ;
      const z = tail ? 1 : ((g + 1) - p) / G;
      paint(c, z, !tail && g === 0 && u > 0.52, tail ? s : 1, tail ? s : 0);
    }
    ring(m, 0, 0, 0, fadeIO(u, 0, 0.5, 0.1));
  }
  // OneFlow steady state: (a) streaming alignment shifts all chunks by E and appends a tail; (b) one
  // batched pass and parallel reconstruction advance every chunk one timestep (drawn as moving down
  // one row) while the shifted source enters at t_0; (c) the first E actions of the chunk at t_N run.
  function drawPF(m, u) {
    const s = ease(u / 0.24), d = ease((u - 0.3) / 0.4);
    move(m, s, d);
    for (const c of m.cells) {
      const lv = c.i + d, tail = c.j >= HZ;
      const op = c.i < 0 ? clamp(d * 1.5) : c.i === N ? 1 - d : 1;
      const execBase = c.i === N && c.j < E;                          // executed in the previous step
      const execNew = c.i === N - 1 && c.j >= E && c.j < 2 * E && u > 0.76;
      paint(c, 1 - lv / N, execBase || execNew, op, tail ? s * (1 - d) : 0);
    }
    ring(m, 0, N - 1, d, fadeIO(u, 0.26, 0.72, 0.08));
  }

  play(root, {
    duration: SPAN, unitMs: 560, holdMs: 2000, still: SPAN,
    render(t) {
      for (const m of METHODS) {
        let n = 0;
        for (const p of m.passes) attr(p.bar, 'width', (p.w * clamp((t - p.s) / (p.e - p.s))).toFixed(1));
        for (const o of m.outs) {
          const done = t >= o.t;
          n += done;
          attr(o.b, 'opacity', t >= SPAN && done ? 1 : ease((t - o.t) / 0.3 + 0.001).toFixed(2));
        }
        m.count.textContent = `action chunks: ${n}`;
        march(m.ring, t, 18);
        let k = m.steps.findIndex(([s, e]) => t < e);
        let u;
        if (k < 0) { k = m.steps.length - 1; u = 1; } else u = (t - m.steps[k][0]) / (m.steps[k][1] - m.steps[k][0]);
        const kind = m.steps[k][2];
        if (m.key === 'par') drawPar(m, u);
        else if (m.key === 'str') drawStr(m, u);
        else if (kind === 'seq') drawSeq(m, u);
        else drawPF(m, u);
      }
    },
  });
})();
