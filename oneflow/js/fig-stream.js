// Stream figure: OneFlow as a continuous stream, driven by one observe -> align -> generate -> execute loop.
// Three lanes scroll together across the figure: one observation per replanning step, the N + 1
// retained intermediate chunks X_{k,0..N} over the current horizon of H actions (each cell directly
// above the action it will become), and the executed action stream. The loop around the frozen policy
// sits left of the playhead, with each node on the diagonal nearest to what it acts on: Observe towards
// the observation lane, Align and Generate towards the retained chunks, Execute towards the executed
// actions. That leaves the policy's four sides free; the observation and the aligned chunks flow into
// it along the spokes, its estimates flow out to Generate. A highlight travels from node to node with
// the phase. On narrow screens the loop sits above the lanes and the legend below them, so the figure
// fits the screen. Each replanning step k:
//   Observe   o_k arrives.
//   Align     every chunk drops its E executed actions and extrapolates its tail (last value plus
//             r_i-scaled noise).
//   Generate one batched forward pass under o_k moves every chunk one denoising timestep down; a
//             fresh noise chunk enters at t_0 and the used clean chunk leaves.
//   Execute   the first E actions of the clean chunk X'_N join the stream and are executed; the lanes
//             scroll by E actions.
// Frames, hashed noise and the action signal are periodic over K steps, so the loop is seamless.
(function () {
  const { C, mix, el, attr, rich, text, sym, defs, play, mount, clamp, ease, lerp, fadeIO, passRing, march, flow, narrow } = PF;
  const root = document.getElementById('fig-stream');
  if (!root) return;

  const N = 4, HZ = 8, E = 2, U = 10, K = 14, A = K * E;      // K steps per loop = one demo video
  // Size, playhead x, loop centre, radius and scale of its nodes, top of the observation lane, width of the lanes' edge
  // fades; cell pitch and width, row pitch and cell height of the retained chunks, height of the action
  // stream, and the tops of the chunks and of the stream below the top of the observation lane. Wide
  // screens get larger cells and a larger loop, so the lanes fill the figure's width; tall rows give the
  // curves room and the figure height. Executed cells stay in the retained chunks until Align drops them,
  // E cells left of the playhead, so the loop and its nodes must end left of P - E * PW.
  const G = narrow
    ? { W: 452, H: 646, P: 100, RX: 226, RYc: 100, RR: 92, Z: 1, FY: 222, FD: 40, PW: 40, CW: 34, RH: 38, CH: 32, SH: 36, RY: 70, SY: 284 }
    : { W: 1120, H: 468, P: 456, RX: 210, RYc: 242, RR: 116, Z: 1.2, FY: 40, FD: 130, PW: 48, CW: 42, RH: 44, CH: 36, SH: 40, RY: 94, SY: 352 };
  const W = G.W, H = G.H;
  const svg = mount(root, W, H, 'OneFlow as a stream: an observe, align, generate, execute loop around the frozen policy. Retained chunks at N denoising timesteps sit above the executed action stream; every E actions they are aligned, advanced by one batched forward pass, and the first E clean actions are executed.', narrow);
  const D = defs(svg);

  const PW = G.PW, CW = G.CW, P = G.P;                            // cell pitch, cell width, playhead x
  const FY = G.FY, FW = E * PW - 4, FH = FW * 9 / 16;          // observation lane
  const RY0 = FY + G.RY, RH = G.RH, CH = G.CH, rowY = l => RY0 + l * RH; // retained chunks, by level
  const SY = FY + G.SY, SH = G.SH;                             // action stream
  const ax = (a, cam) => P + (a - cam) * PW + (PW - CW) / 2;   // left edge of the cell of action a
  const mod = (v, m) => ((v % m) + m) % m;
  // Phases within a step: observe, align, generate, commit, execute. Commit and execute share a node.
  const PH = [[0, 1.4], [1.4, 3.4], [3.4, 6.2], [6.2, 7.2], [7.2, U]];
  const phaseOf = u => Math.max(0, PH.findIndex(([, b]) => u < b));
  const NODE = [0, 1, 2, 3, 3];

  // Schematic action signal (periodic over the loop) and per-chunk source noise.
  const truth = a => 0.5 + 0.3 * Math.sin(4 * Math.PI * a / A) + 0.1 * Math.sin(10 * Math.PI * a / A + 1.1);
  const noise = (b, a) => { const s = Math.sin(mod(b, K) * 127.1 + mod(a, A) * 311.7) * 43758.5453; return 0.2 + 0.6 * (s - Math.floor(s)); };
  const valY = (v, top, h) => top + 5 + (1 - v) * (h - 10);
  // One Catmull-Rom segment from p1 to p2 as a cubic Bezier; p0 and p3 set the tangents.
  // j1 and j2 displace the two control points vertically: the jitter of a chunk that is still noisy.
  const curve = (p0, p1, p2, p3, j1 = 0, j2 = 0) => {
    const f = v => v.toFixed(1), c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6 + j1];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6 + j2];
    return `M${f(p1[0])} ${f(p1[1])} C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  };
  // A smooth curve through all points.
  const spline = pts => pts.slice(0, -1).map((p, j) => curve(pts[j - 1] || p, p, pts[j + 1], pts[j + 2] || pts[j + 1]).replace(/^M[^C]+/, j ? ' ' : '$&')).join('');
  // Value of action a in chunk b at (fractional) level l. A tail cell appended at step s starts as the
  // held last value of the horizon and reaches the clean action at level N.
  function value(b, a, l) {
    const s = Math.floor((a - HZ) / E) + 1;
    let est = truth(a);
    if (s > b) {
      const ls = s - 1 - b;
      est = lerp(truth(s * E + HZ - E - 1), est, clamp((l - ls) / (N - ls)));
    }
    const tau = l / N;
    return tau * est + (1 - tau) * noise(b, a);
  }

  // ---------- the loop: left of the playhead between the lanes, or above them on narrow screens ----------
  const RX = G.RX, RYc = G.RYc, RR = G.RR, Z = G.Z, SP = 135;           // SP: angle of the Execute node
  const polar = (deg, r = RR) => [RX + r * Math.cos(deg * Math.PI / 180), RYc + r * Math.sin(deg * Math.PI / 180)];
  el('circle', { cx: RX, cy: RYc, r: RR, fill: 'none', stroke: C.grid, 'stroke-width': 1.6 }, svg);
  for (const a of [-90, 0, 90, 180]) {                         // clockwise arrowheads between nodes
    const [x, y] = polar(a), t = [-Math.sin(a * Math.PI / 180), Math.cos(a * Math.PI / 180)], n = [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)];
    const p = (u, v) => `${(x + u * t[0] + v * n[0]).toFixed(1)},${(y + u * t[1] + v * n[1]).toFixed(1)}`;
    el('path', { d: `M${p(5, 0)} L${p(-4, 4)} L${p(-4, -4)} Z`, fill: C.faint }, svg);
  }
  const hiArc = el('path', { fill: 'none', stroke: D.pass, 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
  const NODES = ['Observe', 'Align', 'Generate', 'Execute'], NW = 92 * Z, NH = 26 * Z, nodeAt = i => SP + 90 * (i + 1);
  const nodes = NODES.map((name, i) => {
    const [x, y] = polar(nodeAt(i)), w = NW, g = el('g', {}, svg);
    const bg = el('rect', { class: 'fx', x: x - w / 2, y: y - NH / 2, width: w, height: NH, rx: NH / 2, 'stroke-width': 1.4 }, g);
    const t = text(g, x, y, name, { class: 't-mid fx', size: narrow ? 13 : 14 });
    t.style.fontWeight = 600;
    return { bg, t };
  });
  const BW = 80 * Z, BH = 48 * Z;                              // the policy
  const badge = el('rect', { x: RX - BW / 2, y: RYc - BH / 2, width: BW, height: BH, rx: 12, fill: C.paper, stroke: C.ink2, 'stroke-width': 1.3 }, svg);
  const badgeRing = passRing(svg, D, { x: RX - BW / 2 - 3.5, y: RYc - BH / 2 - 3.5, width: BW + 7, height: BH + 7, rx: 15, 'stroke-width': 2 });
  rich(svg, RX, RYc - 7 * Z, [sym('v', 'θ')], { class: 't-mid', size: 19 * Z });
  text(svg, RX, RYc + 13 * Z, 'frozen policy', { class: 't-small t-mid' });
  // Legend: right of the retained chunks, or in two columns below the lanes.
  const KX = narrow ? 16 : P + HZ * PW + 104, KY = narrow ? SY + SH + 50 : RY0 + 58, KD = narrow ? 22 : 30;
  const kx = i => narrow ? KX + (i % 2) * 196 : KX, ky = i => KY + (narrow ? Math.floor(i / 2) : i) * KD;
  rich(svg, narrow ? kx(5) : KX, narrow ? ky(5) : RY0 + CH / 2, [sym('N'), ' = 4,  ', sym('H'), ' = 8,  ', sym('E'), ' = 2'], { class: 't-small' });
  const key = (x, y, label, attrs, dots) => {
    if (attrs.pass) passRing(svg, D, { x, y: y - 7, width: 18, height: 14, rx: 4, opacity: 1, 'stroke-width': 2, 'stroke-dasharray': '6 3' });
    else el('rect', { x, y: y - 7, width: 18, height: 14, rx: 3, ...attrs }, svg);
    if (dots) el('rect', { x, y: y - 7, width: 18, height: 14, rx: 3, fill: D.noise }, svg);
    text(svg, x + 25, y, label, { class: 't-small' });
  };
  key(kx(0), ky(0), 'source noise', { fill: C.noise }, true);
  key(kx(1), ky(1), 'clean action', { fill: C.clean });
  key(kx(2), ky(2), 'extrapolated tail', { fill: C.noise, stroke: C.blue, 'stroke-width': 1.4, 'stroke-dasharray': '3 2' });
  key(kx(3), ky(3), 'executed action', { fill: C.exec });
  key(kx(4), ky(4), 'in the current forward pass', { pass: true });

  // ---------- lanes ----------
  const lanes = el('clipPath', { id: `${D.id}-lanes` }, D.root);
  el('rect', { x: 0, y: 0, width: W, height: H }, lanes);
  const clipped = el('g', { 'clip-path': `url(#${D.id}-lanes)` }, svg);
  const film = el('g', {}, clipped), stack = el('g', {}, svg), stream = el('g', {}, clipped), fx = el('g', {}, svg);

  // Observation lane: one frame per replanning step, spanning the E actions it conditions.
  const frameHref = s => `assets/stream/obs-${String(mod(s, K)).padStart(2, '0')}.webp?v=20261127c`;
  let near = location.hash.includes(`${root.id}=`);           // a pinned frame draws once, so load at once
  const frames = Array.from({ length: 16 }, () => {
    const g = el('g', {}, film);
    el('rect', { width: FW, height: FH, rx: 4, fill: C.lane, stroke: C.grid, 'stroke-dasharray': '3 3' }, g);
    const img = el('image', { width: FW, height: FH, preserveAspectRatio: 'xMidYMid slice', opacity: 0 }, g);
    const ring = el('rect', { x: -2, y: -2, width: FW + 4, height: FH + 4, rx: 5, fill: 'none', stroke: C.ink, 'stroke-width': 2, opacity: 0 }, g);
    return { g, img, ring };
  });
  // Frames load once the figure is within a screen; a paused or still figure gets them right away.
  new IntersectionObserver((es, io) => {
    if (!es[0].isIntersecting) return;
    near = true;
    io.disconnect();
    frames.forEach(f => { if (f.s != null) attr(f.img, 'href', frameHref(f.s)); });
  }, { rootMargin: '100% 0px' }).observe(root);
  const href = (f, s) => { f.s = s; if (near) attr(f.img, 'href', frameHref(s)); };

  // Retained chunks: a pool of rows, each assigned to one chunk identity b (b mod N + 2).
  const rows = Array.from({ length: N + 2 }, () => {
    const g = el('g', {}, stack);
    const cells = Array.from({ length: HZ + E }, () => {
      const c = el('g', {}, g);
      const r = el('rect', { width: CW, height: CH, rx: 4 }, c);
      const n = el('rect', { width: CW, height: CH, rx: 4, fill: D.noise }, c);
      const o = el('rect', { x: -1.5, y: -1.5, width: CW + 3, height: CH + 3, rx: 5, fill: 'none', stroke: C.blue, 'stroke-width': 1.4, 'stroke-dasharray': '3 2' }, c);
      return { c, r, n, o };
    });
    const segs = Array.from({ length: HZ + E }, () => el('path', { fill: 'none', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, g));
    return { g, cells, segs };
  });
  const LBX = P + HZ * PW + 8;
  for (let i = 0; i <= N; i++) rich(svg, LBX, rowY(i) + CH / 2, [sym('t', i), narrow ? '' : i === 0 ? '  noise' : i === N ? '  clean' : ''], { class: 't-small' });
  const ring = passRing(svg, D, { x: P - 5, y: rowY(0) - 5, width: HZ * PW - (PW - CW) + 10, height: N * RH - (RH - CH) + 10, rx: 9 });
  const commitRing = el('rect', { y: rowY(N) - 3, width: E * PW - (PW - CW) + 4, height: CH + 6, rx: 6, fill: 'none', stroke: C.exec, 'stroke-width': 2.2, opacity: 0 }, svg);
  const note = (x, s, attrs) => text(svg, x, RY0 - 13, s, { class: 't-small', opacity: 0, ...attrs });
  const dropNote = note(P - 8, 'drop executed', { class: 't-small t-end' });
  const tailNote = note(P + (HZ - E / 2) * PW, 'extrapolate tail', { class: 't-small t-mid', fill: C.blue });
  const passNote = note(P + 4, 'one batched pass moves every chunk one timestep down', { fill: C.blue });
  // Particles on the spokes: the observation and the aligned chunks enter the policy, its estimates
  // leave towards Generate. Execute has no spoke: it does not involve the policy.
  const flowObs = flow(svg, 2, C.ink2, 2), flowAlign = flow(svg, 2, C.blue, 2), flowGen = flow(svg, 2, C.deep, 2);
  const spoke = (run, i, out, phase, op) => {
    const a = polar(nodeAt(i), RR - 24 * Z), b = polar(nodeAt(i), 44 * Z);
    run(...(out ? b : a), ...(out ? a : b), phase, op);
  };

  // Ghost cells that carry X'_N[0:E] down into the stream.
  const ghosts = Array.from({ length: E }, () => {
    const g = el('g', { opacity: 0 }, fx);
    el('rect', { width: CW, height: CH, rx: 4, fill: C.clean }, g);
    const d = el('path', { fill: 'none', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, g);
    return { g, d };
  });

  // Action stream: a pool of cells indexed by action a.
  const slots = Array.from({ length: 28 }, () => {
    const g = el('g', {}, stream);
    const r = el('rect', { width: CW, height: SH, rx: 4 }, g);
    return { g, r };
  });
  const streamCurve = el('path', { fill: 'none', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round', opacity: 0.9 }, stream);

  // Edge fades make both lanes read as unbounded.
  const fade = (id, x1, x2) => {
    const g = el('linearGradient', { id: `${D.id}-${id}`, x1, x2, y1: 0, y2: 0 }, D.root);
    el('stop', { offset: 0, 'stop-color': C.paper, 'stop-opacity': 1 }, g);
    el('stop', { offset: 1, 'stop-color': C.paper, 'stop-opacity': 0 }, g);
    return `url(#${D.id}-${id})`;
  };
  const fl = fade('fl', 0, 1), fr = fade('fr', 1, 0);
  for (const [y, h] of [[FY - 4, FH + 8], [SY - 4, SH + 8]]) {
    el('rect', { x: 0, y, width: G.FD, height: h, fill: fl }, svg);
    el('rect', { x: W - G.FD, y, width: G.FD, height: h, fill: fr }, svg);
  }
  text(svg, P + 4, FY - 14, 'Observations, one per replanning step', { class: 't-small' });
  text(svg, narrow ? W - 8 : P + HZ * PW + 8, SY - 14, 'Action stream, one cell per action', { class: narrow ? 't-small t-end' : 't-small' });

  // Playhead.
  el('line', { x1: P, y1: FY - 6, x2: P, y2: SY + SH + 6, stroke: C.ink, 'stroke-width': 1.4, 'stroke-dasharray': '2 3' }, svg);
  const nowChip = el('g', { transform: `translate(${P - 19} ${SY + SH + 8})` }, svg);
  el('rect', { width: 38, height: 17, rx: 5, fill: C.ink }, nowChip);
  text(nowChip, 19, 8.5, 'now', { class: 't-tag t-mid', fill: '#fff', size: 11 });
  text(svg, P - 30, SY + SH + 16, '← executed', { class: 't-small t-end' });
  text(svg, P + 30, SY + SH + 16, 'upcoming →', { class: 't-small' });

  function paintRow(row, b, l, op, cells, cam) {
    const tau = clamp(l / N), y = rowY(l), fill = mix(C.noise, C.clean, tau), ink = PF.waveInk(1 - tau);
    attr(row.g, 'opacity', op.toFixed(3));
    const pts = [];
    row.cells.forEach((c, j) => {
      const cell = cells[j];
      if (!cell || cell.op <= 0.01) { attr(c.c, 'opacity', 0); pts.push(null); return; }
      const x = ax(cell.a, cam) + (cell.dx || 0);
      attr(c.c, 'transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      attr(c.c, 'opacity', cell.op.toFixed(3));
      attr(c.r, 'fill', fill);
      attr(c.n, 'opacity', ((1 - tau) * 0.8).toFixed(3));
      attr(c.o, 'opacity', (cell.glow || 0).toFixed(3));
      pts.push([x + CW / 2, valY(value(b, cell.a, l), y, CH), cell.op, cell.a]);
    });
    row.segs.forEach((s, j) => {
      const p = pts[j], q = pts[j + 1];
      if (!p || !q) { attr(s, 'opacity', 0); return; }
      // Between two actions the curve of a noisy chunk wanders; the wander vanishes as it is denoised.
      const amp = (1 - tau) * CH * 1.1;
      attr(s, 'd', curve(pts[j - 1] || p, p, q, pts[j + 2] || q, amp * (noise(b + 5, p[3]) - 0.5), amp * (noise(b + 9, p[3]) - 0.5)));
      attr(s, 'stroke', ink); attr(s, 'opacity', (Math.min(p[2], q[2]) * 0.9).toFixed(3));
    });
  }
  const range = (a, b, f) => { const out = []; for (let x = a; x < b; x++) out.push(f(x)); return out; };

  play(root, {
    duration: K * U, unitMs: 300, seamless: true, still: 3 * U + 4.9,
    render(t) {
      const k = Math.floor(t / U), u = t - k * U, ph = phaseOf(u);
      let cam = k * E;
      if (u >= PH[4][0]) {
        const q = Math.min((u - PH[4][0]) / 1.4, E), j = Math.min(E - 1, Math.floor(q));
        cam += j + ease(q - j);
      }

      // The loop: the highlight travels to the node of the current phase, trailing a short arc.
      const ANG = [0, 1, 2, 3, 3].map(nodeAt), prev = ph === 0 ? SP : ANG[ph - 1];
      const head = lerp(prev, ANG[ph], ease((u - PH[ph][0]) / 0.7)), tail = head - 62;
      const [hx, hy] = polar(head), [tx, ty] = polar(tail);
      attr(hiArc, 'd', `M${tx.toFixed(1)} ${ty.toFixed(1)} A${RR} ${RR} 0 0 1 ${hx.toFixed(1)} ${hy.toFixed(1)}`);
      nodes.forEach((n, i) => {
        const on = i === NODE[ph];
        attr(n.bg, 'fill', on ? C.ink : C.paper); attr(n.bg, 'stroke', on ? C.ink : C.grid);
        n.t.style.fill = on ? '#FFFFFF' : C.ink2;
      });
      // The policy's outline runs during the batched pass; particles carry its inputs and outputs.
      const busy = fadeIO(u, PH[2][0], PH[2][1] - 0.4, 0.3);
      attr(badgeRing, 'opacity', busy.toFixed(3));
      march(badgeRing, t, 26);
      attr(badge, 'stroke', busy > 0.5 ? C.ink : C.ink2);
      spoke(flowObs, 0, false, u * 1.2, fadeIO(u, 0.3, PH[2][0] + 0.6, 0.25));
      spoke(flowAlign, 1, false, (u - PH[1][0]) * 1.2, fadeIO(u, PH[1][0] + 1.2, PH[2][0] + 0.6, 0.25));
      spoke(flowGen, 2, true, (u - PH[2][0]) * 1.2, fadeIO(u, PH[2][0] + 0.5, PH[2][1], 0.25));

      // Observations.
      const s0 = Math.floor(cam / E);
      for (let s = s0 - 6; s < s0 + 10; s++) {
        const f = frames[mod(s, frames.length)], x = P + (s * E - cam) * PW + 2;
        attr(f.g, 'transform', `translate(${x.toFixed(1)} ${FY})`);
        const seen = s < k ? 1 : s === k ? ease(u / 0.6) : 0;
        href(f, s);
        attr(f.img, 'opacity', (seen * (s === k ? 1 : 0.8)).toFixed(3));
        attr(f.ring, 'opacity', s === k ? (seen * (u < PH[2][1] ? 1 : 0.35)).toFixed(3) : 0);
      }

      // Retained chunks.
      const move = ease((u - 4.4) / 1.4), used = rows.map(() => false);
      for (let b = k - 1 - N; b <= k; b++) {
        let l, op = 1, cells;
        if (b === k - 1 - N) {
          l = N; op = 1 - ease((u - 1.4) / 0.6);
          cells = range((k - 1) * E, (k - 1) * E + HZ, a => ({ a, op: 1 }));
        } else if (b === k) {
          l = 0; op = ease((u - 4.6) / 1.0);
          cells = range(k * E, k * E + HZ, a => ({ a, op: 1 }));
        } else {
          l = k - 1 - b + move;
          const drop = 1 - ease((u - 1.6) / 0.8), grow = ease((u - 2.2) / 0.8), glow = grow * (1 - ease((u - 5.0) / 0.8));
          cells = [
            ...range((k - 1) * E, k * E, a => ({ a, op: drop })),
            ...range(k * E, (k - 1) * E + HZ, a => ({ a, op: 1 })),
            ...range((k - 1) * E + HZ, k * E + HZ, a => ({ a, op: grow, dx: -(1 - grow) * 14, glow })),
          ];
        }
        if (op <= 0.001) continue;
        const slot = mod(b, rows.length);
        used[slot] = true;
        paintRow(rows[slot], b, l, op, cells, cam);
      }
      rows.forEach((r, i) => { if (!used[i]) attr(r.g, 'opacity', 0); });
      attr(ring, 'opacity', fadeIO(u, 3.4, 5.9).toFixed(3));
      march(ring, t, 24);
      attr(dropNote, 'opacity', fadeIO(u, 1.5, 3.1).toFixed(3));
      attr(tailNote, 'opacity', fadeIO(u, 2.1, 3.1).toFixed(3));
      attr(passNote, 'opacity', fadeIO(u, 3.5, 5.9).toFixed(3));

      // Commit X'_N[0:E] into the stream.
      attr(commitRing, 'x', (ax(k * E, cam) - 2).toFixed(1));
      attr(commitRing, 'opacity', fadeIO(u, 6.2, 7.2, 0.2).toFixed(3));
      const fall = ease((u - 6.4) / 0.7), landed = u >= 7.1;
      ghosts.forEach((g, j) => {
        const a = k * E + j, y = lerp(rowY(N), SY + (SH - CH) / 2, fall);
        attr(g.g, 'transform', `translate(${ax(a, cam).toFixed(1)} ${y.toFixed(1)})`);
        attr(g.g, 'opacity', fadeIO(u, 6.3, 7.1, 0.12).toFixed(2));
        const pt = i => [(i - a) * PW + CW / 2, valY(truth(i), 0, CH)];
        attr(g.d, 'd', curve(pt(a - 0.8), pt(a - 0.4), pt(a + 0.4), pt(a + 0.8)));
      });

      // Action stream.
      const c0 = Math.floor(cam);
      const committed = a => a < k * E || (a < k * E + E && landed);
      const line = [];
      for (let a = c0 - 11; a < c0 + 17; a++) {
        const sl = slots[mod(a, slots.length)], x = ax(a, cam);
        attr(sl.g, 'transform', `translate(${x.toFixed(1)} ${SY})`);
        const on = committed(a), done = a + 1 <= cam + 1e-6, running = on && !done && cam >= a - 1e-6 && u >= PH[4][0];
        attr(sl.r, 'fill', done ? C.exec : on ? C.clean : C.paper);
        attr(sl.r, 'stroke', running ? C.ink : on ? 'none' : C.grid);
        attr(sl.r, 'stroke-width', running ? 2.2 : 1);
        attr(sl.r, 'stroke-dasharray', on ? 'none' : '3 3');
        if (on) line.push([x + CW / 2, valY(truth(a), SY, SH)]);
      }
      attr(streamCurve, 'd', line.length > 1 ? spline(line) : '');
    },
  });
})();
