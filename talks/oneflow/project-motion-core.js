/* Shared SVG vocabulary from the OneFlow project page, js/common.js. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  // Palette, shared with styles.css: one blue on neutral grays. Denoising runs from light gray
  // (source noise, a gray speckle) through light blue to the blue of a clean action; an executed
  // action is the deep blue. Blue also marks whatever is carried across replanning steps (alignment,
  // appended tails, cross-step inputs) and every accent; structure is gray. A forward pass in
  // progress is a moving light-to-deep blue outline (passRing).
  const C = {
    ink: '#1D242B', ink2: '#39424B', muted: '#65707A', faint: '#9AA3AB',
    line: '#E2E5E8', grid: '#CDD2D7', lane: '#EFF1F3', paper: '#faf9f3',
    blue: '#416FA8', blueSoft: '#C4D3E6', tint: '#F3F5F7', deep: '#254568',
    no: '#7A848E',
    noise: '#E3E6EA', noiseInk: '#98A2AD', waveInk: '#5C6875', clean: '#416FA8', exec: '#254568', done: '#C9CED4',
  };

  const rgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const mix = (a, b, w) => {
    const A = rgb(a), B = rgb(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * w).toString(16).padStart(2, '0')).join('');
  };
  // Fill of an intermediate action chunk at denoising timestep t_i of N.
  const level = (i, N) => mix(C.noise, C.clean, i / N);
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
    const id = `of-science-${++uid}`;
    const d = el('defs', {}, svg);
    const p = el('pattern', { id: `${id}-noise`, width: 13, height: 13, patternUnits: 'userSpaceOnUse' }, d);
    for (const [x, y, r] of [[1.4, 2.1, 0.8], [6.2, 1.1, 0.6], [10.6, 3.2, 0.9], [3.9, 5.6, 0.65], [8.3, 6.9, 0.8], [12.1, 8.4, 0.55], [1.9, 9.3, 0.9], [5.7, 11.2, 0.7], [10.1, 11.6, 0.6]]) {
      el('circle', { cx: x, cy: y, r, fill: C.noiseInk }, p);
    }
    const pass = el('linearGradient', { id: `${id}-pass`, x1: 0, y1: 0, x2: 1, y2: 1 }, d);
    el('stop', { offset: 0, 'stop-color': '#7E9FC8' }, pass);
    el('stop', { offset: 1, 'stop-color': '#254568' }, pass);
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
  // Colour of the curve on a cell with remaining noise z: gray on pale noise, deep blue on the
  // middle timesteps, white on the clean blue.
  const waveInk = z => z > 0.5 ? mix(C.exec, C.waveInk, clamp((z - 0.5) / 0.15)) : mix('#FFFFFF', C.exec, clamp((z - 0.2) / 0.15));
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

  const fadeIO = (u, a, b, w = .3) => clamp((u - a) / w) * (1 - clamp((u - b) / w));
  window.OneFlowProjectMotion = { C, level, mix, el, attr, rich, setRich, text, sym, defs, clamp, ease, lerp, fadeIO, signal, blend, waveInk, passRing, march, flow };
})();
