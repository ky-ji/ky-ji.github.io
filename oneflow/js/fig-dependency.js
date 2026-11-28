// Dependency figure: where the inputs of each forward pass come from. Nodes are intermediate action
// chunks X_{k,i}, each drawn as a small trajectory: columns are replanning steps k, rows are denoising
// timesteps t_i (t_0 = source noise, t_N = executed chunk). Sequential sampling (left) obtains
// X_{k,i+1} from X_{k,i}, so every node costs one serial pass and every column restarts from fresh
// noise. OneFlow (right) initializes the first column with the native sampler; afterwards the inputs
// of step k are the retained chunks of step k − 1, aligned to the new horizon (blue), so one batched
// pass evaluates a whole column. Parallel reconstruction then rebuilds the column (dashed), without
// network evaluations. The moving outline encloses the inputs of the pass in progress, particles run
// along the connections it uses, and the tape under each panel counts the passes. A closing beat
// follows one chunk through its denoising timesteps: down a single column under Native (every
// timestep inside one replanning step), along a diagonal under OneFlow (one timestep per step).
(function () {
  const { C, level, el, attr, rich, text, sym, defs, play, mount, clamp, ease, fadeIO, narrow, signal, blend, waveInk, passRing, march, flow } = PF;
  const root = document.getElementById('fig-dependency');
  if (!root) return;

  // On narrow screens the two panels stack, with one column fewer.
  const N = 4, HZ = 8, E = 2, COLS = narrow ? 4 : 5, BATCH = 1.4, TRACE = 3.4;
  const PH = 468, PW = narrow ? 440 : 532, GAPX = narrow ? 0 : 56, GAPY = 16;
  const W = narrow ? PW : 1120, H = narrow ? 2 * PH + GAPY : PH;
  const svg = mount(root, W, H, 'Dependencies between intermediate action chunks under sequential sampling and OneFlow.', narrow);
  const D = defs(svg);

  const NODE = 30, DX = 84, DY = 54;
  const panels = [
    { key: 'seq', x: 0, y: 0, kick: 'Sequential within each replanning step', title: 'Native sampling', sub: [sym('X', 'k,i+1'), ' is integrated from ', sym('X', 'k,i'), ': one serial pass per node'] },
    { key: 'pf', x: narrow ? 0 : PW + GAPX, y: narrow ? PH + GAPY : 0, kick: 'Parallel within each pass, sequential across steps', title: 'OneFlow', sub: [sym('X', 'k,i+1'), ' builds on the aligned ', sym('X', 'k−1,i'), ': one batched pass per column'] },
  ];
  if (narrow) el('line', { x1: 0, y1: PH + GAPY / 2, x2: W, y2: PH + GAPY / 2, stroke: C.line }, svg);
  else el('line', { x1: PW + GAPX / 2, y1: 8, x2: PW + GAPX / 2, y2: PH - 8, stroke: C.line }, svg);

  // Schedule: each job is one forward pass. `inputs` are the nodes it reads, `out` the rows of
  // column k it produces.
  for (const p of panels) {
    p.jobs = [];
    let t = 0;
    for (let k = 0; k < COLS; k++) {
      if (p.key === 'seq' || k === 0) {
        for (let i = 0; i < N; i++) { p.jobs.push({ s: t, e: t + 1, k, i, out: [i + 1], inputs: [[k, i]] }); t += 1; }
      } else {
        p.jobs.push({ s: t, e: t + BATCH, k, out: Array.from({ length: N + 1 }, (_, i) => i), inputs: Array.from({ length: N }, (_, i) => [k - 1, i]), batch: true });
        t += BATCH;
      }
    }
    p.end = t;
  }
  const SPAN = Math.max(...panels.map(p => p.end));

  for (const p of panels) {
    const g = el('g', { transform: `translate(${p.x} ${p.y})` }, svg);
    const ours = p.key === 'pf';
    text(g, 22, 18, p.kick, { class: 't-kick', fill: C.muted });
    text(g, 22, 42, p.title, { class: 't-title', fill: ours ? C.blue : C.ink });
    rich(g, 22, 64, p.sub, { class: 't-sub' });
    const gx = narrow ? 96 : 100, gy = 124;
    const nx = k => gx + k * DX, ny = i => gy + i * DY;
    for (let k = 0; k < COLS; k++) rich(g, nx(k), gy - 30, ['step ', sym('k'), k ? ` + ${k}` : ''], { class: 't-small t-mid' });
    for (let i = 0; i <= N; i++) rich(g, gx - 36, ny(i), [sym('t', i)], { class: 't-small t-end' });

    // Edges first so the nodes sit on top of them. Each belongs to the job that uses it.
    const edges = el('g', {}, g), dots = el('g', {}, g);
    p.edges = [];
    const arrow = (x1, y1, x2, y2, kind, job, order = 0) => {
      const color = kind === 'cross' ? C.blue : C.faint;
      const a = el('line', {
        x1, y1, x2, y2, stroke: color, 'stroke-width': kind === 'cross' ? 1.6 : 1.4,
        'stroke-dasharray': kind === 'scan' ? '3 3' : null,
        'marker-end': kind === 'cross' ? D.heads.blue : D.heads.gray, opacity: 0,
      }, edges);
      p.edges.push({ a, kind, job, order, x1, y1, x2, y2, run: kind === 'scan' ? null : flow(dots, 2, kind === 'cross' ? C.blue : C.deep) });
    };
    const r = NODE / 2 + 3;
    for (let k = 0; k < COLS; k++) {
      const vertical = !ours || k === 0;
      for (let i = 0; i < N; i++) {
        const job = vertical ? p.jobs.find(j => j.k === k && j.i === i) : p.jobs.find(j => j.k === k);
        arrow(nx(k), ny(i) + r, nx(k), ny(i + 1) - r - 2, vertical ? 'within' : 'scan', job, i);
        if (!vertical) {
          const x1 = nx(k - 1), y1 = ny(i), x2 = nx(k), y2 = ny(i + 1), L = Math.hypot(x2 - x1, y2 - y1);
          arrow(x1 + (x2 - x1) * r / L, y1 + (y2 - y1) * r / L, x2 - (x2 - x1) * (r + 2) / L, y2 - (y2 - y1) * (r + 2) / L, 'cross', job);
        }
      }
      if (ours && k > 0) arrow(nx(k - 1) + r, ny(0), nx(k) - r - 2, ny(0), 'cross', p.jobs.find(j => j.k === k));
    }

    // The closing trace: a highlighter band under the nodes one chunk passes through.
    const tc = Math.floor((COLS - 1) / 2), off = N + 1 - COLS;
    p.onTrace = ours ? n => n.i - n.k === off : n => n.k === tc;
    p.tracePts = ours ? [nx(0), ny(off), nx(COLS - 1), ny(off + COLS - 1)] : [nx(tc), ny(0), nx(tc), ny(N)];
    // A solid colour: a bounding-box gradient does not paint on a vertical line.
    p.trace = el('path', { fill: 'none', stroke: ours ? C.blue : C.ink2, 'stroke-opacity': ours ? 0.22 : 0.14, 'stroke-width': NODE + 16, 'stroke-linecap': 'round', opacity: 0 }, g);
    p.traceNote = el('g', { opacity: 0 }, g);
    const cy = ny(N) + NODE / 2 + 30;
    el('rect', { x: 22, y: cy - 5, width: 20, height: 10, rx: 5, fill: ours ? C.blue : C.ink2, 'fill-opacity': ours ? 0.3 : 0.2 }, p.traceNote);
    const lead = narrow ? 'One chunk: ' : 'Denoising timesteps of one chunk: ';
    rich(p.traceNote, 50, cy, [lead + (ours ? (narrow ? 'one timestep per replanning step' : 'one per replanning step') : narrow ? 'every timestep inside one step' : 'all inside one replanning step')], { class: 't-sub', fill: ours ? C.blue : C.ink2 });

    // Nodes: the chunk as a trajectory over its horizon, jagged at t_0 and smooth at t_N. Native
    // columns start from their own noise sample; OneFlow's columns carry one sample forward.
    p.nodes = [];
    for (let k = 0; k < COLS; k++) for (let i = 0; i <= N; i++) {
      const x = nx(k) - NODE / 2, y = ny(i) - NODE / 2, z = 1 - i / N;
      const ng = el('g', { opacity: 0.14 }, g);
      const body = el('rect', { x, y, width: NODE, height: NODE, rx: 7, fill: level(i, N) }, ng);
      const speck = el('rect', { x, y, width: NODE, height: NODE, rx: 7, fill: D.noise, opacity: (z * 0.8).toFixed(2) }, ng);
      const pts = Array.from({ length: 9 }, (_, q) => {
        const a = k * E + q * (HZ - 1) / 8, v = blend(signal(a), z, a, ours ? 0 : k + 1);
        return `${(x + 4 + q * (NODE - 8) / 8).toFixed(1)} ${(y + 6 + (1 - v) * (NODE - 12)).toFixed(1)}`;
      });
      const wave = el('path', { d: `M${pts.join(' L')}`, fill: 'none', stroke: waveInk(z), 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, ng);
      p.nodes.push({ k, i, ng, body, speck, wave });
    }
    p.ring = passRing(g, D, { rx: 10, 'stroke-width': 2.4 });
    p.box = job => {
      const [k, i0] = job.inputs[0], n = job.inputs.length, pad = 5;
      return { x: nx(k) - NODE / 2 - pad, y: ny(i0) - NODE / 2 - pad, width: NODE + 2 * pad, height: (n - 1) * DY + NODE + 2 * pad };
    };

    // Pass counter with a tape: one pip per forward pass, a batched pass drawn wider.
    p.counter = text(g, 22, PH - 58, '', { class: 't-title' });
    p.counterSub = text(g, 22, PH - 14, '', { class: 't-small' });
    const pw = narrow ? 8 : 10;
    let tx = 22;
    p.jobs.forEach((j, q) => {
      if (q && (j.k !== p.jobs[q - 1].k)) tx += 5;
      const w = j.batch ? pw * 2 : pw;
      el('rect', { x: tx, y: PH - 40, width: w, height: 7, rx: 2, fill: C.lane, stroke: C.line }, g);
      j.pip = el('rect', { x: tx, y: PH - 40, width: 0, height: 7, rx: 2, fill: D.pass }, g);
      j.pipW = w;
      tx += w + 2;
    });
    // Key for the edge styles.
    const key = el('g', { transform: `translate(${PW - 22} ${PH - 52})` }, g);
    const keyRow = (y, kind, label) => {
      el('line', { x1: -206, y1: y, x2: -182, y2: y, stroke: kind === 'cross' ? C.blue : C.faint, 'stroke-width': 1.5, 'stroke-dasharray': kind === 'scan' ? '3 3' : null, 'marker-end': kind === 'cross' ? D.heads.blue : D.heads.gray }, key);
      text(key, -174, y, label, { class: 't-small' });
    };
    if (!ours) { keyRow(0, 'within', 'one forward pass'); keyRow(20, 'within', 'columns start from fresh noise'); }
    else { keyRow(0, 'cross', 'aligned input to the batched pass'); keyRow(20, 'scan', 'reconstruction, no forward pass'); }
  }

  play(root, {
    duration: SPAN + TRACE, unitMs: 520, holdMs: 2600, still: SPAN + TRACE,
    render(t) {
      // The closing beat: everything but one chunk's path recedes while the band is drawn along it.
      const dim = ease((t - SPAN - 0.3) / 0.7), drawn = ease((t - SPAN - 0.5) / 1.5);
      for (const p of panels) {
        let passes = 0;
        // A node is visible once the job that produces it is done (the t_0 node of a native column
        // comes with its fresh noise; OneFlow's t_0 nodes are aligned sources produced with the column).
        const doneAt = new Map();
        for (const j of p.jobs) {
          if (t >= j.e) passes++;
          for (const i of j.out) doneAt.set(`${j.k},${i}`, j.e);
          if (!j.batch) doneAt.set(`${j.k},0`, Math.min(doneAt.get(`${j.k},0`) ?? Infinity, j.s));
          attr(j.pip, 'width', (j.pipW * clamp((t - j.s) / (j.e - j.s))).toFixed(1));
        }
        const running = p.jobs.find(j => t >= j.s && t < j.e);
        for (const n of p.nodes) {
          const at = doneAt.get(`${n.k},${n.i}`);
          attr(n.ng, 'opacity', ((0.14 + 0.86 * ease(clamp((t - at) / 0.25 + 1))) * (p.onTrace(n) ? 1 : 1 - 0.62 * dim)).toFixed(2));
          const executed = n.i === N && t >= at + 0.2;
          attr(n.body, 'fill', executed ? C.exec : level(n.i, N));
          attr(n.wave, 'stroke', executed ? '#FFFFFF' : waveInk(1 - n.i / N));
        }
        // The outline of the pass in progress: one node for a serial pass, the whole column of
        // aligned chunks for a batched one.
        if (running) {
          const b = p.box(running);
          for (const key in b) attr(p.ring, key, b[key].toFixed(1));
          attr(p.ring, 'opacity', fadeIO(t, running.s, running.e, 0.16).toFixed(2));
          march(p.ring, t, 22);
        } else attr(p.ring, 'opacity', 0);
        for (const e of p.edges) {
          const j = e.job, len = j.e - j.s;
          // Reconstruction follows the batched pass, one timestep after the other.
          const start = e.kind === 'scan' ? j.s + len * (0.55 + 0.09 * e.order) : j.s;
          const on = ease((t - start) / 0.35 + 0.001), settled = e.kind === 'cross' ? 1 : 1 - 0.4 * ease((t - j.e) / 0.6);
          attr(e.a, 'opacity', ((0.1 + 0.9 * on) * settled * (1 - 0.7 * dim)).toFixed(2));
          if (e.run) {
            const end = j.batch ? j.s + len * 0.6 : j.e;
            e.run(e.x1, e.y1, e.x2, e.y2, (t - j.s) * (j.batch ? 1.5 : 1.8), fadeIO(t, j.s, end, 0.12));
          }
        }
        const [x1, y1, x2, y2] = p.tracePts;
        attr(p.trace, 'd', `M${x1} ${y1} L${(x1 + (x2 - x1) * drawn).toFixed(1)} ${(y1 + (y2 - y1) * drawn).toFixed(1)}`);
        attr(p.trace, 'opacity', dim.toFixed(2));
        attr(p.traceNote, 'opacity', dim.toFixed(2));
        const cols = p.jobs.filter(j => t >= j.e && j.out.includes(N)).length;
        p.counter.textContent = `${passes} forward pass${passes === 1 ? '' : 'es'}`;
        p.counterSub.textContent = `${cols} of ${COLS} action chunks delivered`;
      }
    },
  });
})();
