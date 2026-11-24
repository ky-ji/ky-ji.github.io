/* Slide scenes for the OneFlow keynote. Each scene may define mount, enter, step and leave. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const ease = x => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
  const RAMP = ['#c8cbcf', '#cbdaec', '#9db7d8', '#6c90bc', '#416fa8', '#254568'];
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mixHex = (a, b, w) => { const A = hex(a), B = hex(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * w)).join(',') + ')'; };
  const rampAt = f => { f = clamp(f) * (RAMP.length - 1); const i = Math.min(RAMP.length - 2, Math.floor(f)); return mixHex(RAMP[i], RAMP[i + 1], f - i); };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function el(name, attrs = {}, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.innerHTML = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function loop(fn) {
    let raf = 0, t0 = 0, on = false;
    const frame = now => { if (!on) return; if (!t0) t0 = now; fn((now - t0) / 1000); raf = requestAnimationFrame(frame); };
    return {
      start() { if (on) return; on = true; t0 = 0; raf = requestAnimationFrame(frame); },
      stop() { on = false; cancelAnimationFrame(raf); },
      restart() { this.stop(); this.start(); },
    };
  }
  const S = {};

  /* ---------------- particles: source noise flowing into action trajectories ---------------- */
  S.particles = {
    mount(slide) {
      const cv = slide.querySelector('canvas.field');
      const ctx = cv.getContext('2d');
      const end = slide.dataset.variant === 'end';
      const W = 1920, H = 1080;
      const x0 = end ? 1000 : 1040, x1 = 1960;
      const cy = end ? 600 : 540, band = end ? 300 : 340;
      const K = 7, SPAN = 1.12;
      let seed = end ? 7 : 20261125;
      const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
      const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(TAU * rand());
      const P = Array.from({ length: end ? 900 : 1500 }, (_, i) => ({ o: rand() * SPAN, v: .028 + .03 * rand(), k: i % K, e: gauss(), j: clamp(gauss(), -2.5, 2.5), f: .5 + rand(), p: rand() * TAU, w: .8 + rand() }));
      const share = u => smooth((u - .06) / .74);
      const target = (k, u, t) => cy + (k - 3) * band * .105 + band * .22 * (.62 * Math.sin(TAU * (1.05 * u + .07 * k) - .42 * t) + .3 * Math.sin(TAU * (2.2 * u + .17 * k) + .27 * t + k));
      let px = 0, py = 0;
      const pos = (q, u, t) => {
        const s = share(u), wob = Math.sin(t * q.f + q.p);
        const noise = cy + q.e * band * .55 * (1 + .1 * wob);
        px = x0 + (u + (1 - s) * (q.j * .014 + wob * .005)) * (x1 - x0);
        py = noise + (target(q.k, u, t) - noise) * s;
        return s;
      };
      const B = 8;
      const cols = Array.from({ length: B }, (_, b) => {
        const s = b / (B - 1);
        const a = [196, 206, 222], c = (b % 2) ? [143, 196, 255] : [99, 230, 207];
        return a.map((v, i) => Math.round(v + (c[i] - v) * s));
      });
      let ratio = 1;
      function size() {
        const sc = parseFloat(getComputedStyle(document.querySelector('.ofd-stage')).getPropertyValue('--scale')) || 1;
        ratio = Math.min(2, Math.max(.6, (devicePixelRatio || 1) * sc));
        cv.width = Math.round(W * ratio); cv.height = Math.round(H * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      size();
      addEventListener('resize', size);
      const alphaBase = end ? .8 : 1;
      function draw(t) {
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        // faint guide strands where the flow has settled
        ctx.lineWidth = 1.4;
        for (let k = 0; k < K; k++) {
          ctx.beginPath();
          for (let i = 0; i <= 40; i++) {
            const u = .58 + .012 * i, y = cy + (target(k, u, t) - cy) * share(u);
            const x = x0 + u * (x1 - x0);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.strokeStyle = `rgba(99,230,207,${.08 * alphaBase})`;
          ctx.stroke();
        }
        const tails = cols.map(() => new Path2D()), heads = cols.map(() => new Path2D());
        for (const q of P) {
          const u = (q.o + q.v * t) % SPAN - .06;
          const s = pos(q, u, t);
          const hx = px, hy = py;
          const b = Math.min(B - 1, Math.round(s * (B - 1)));
          const r = (1.05 + .9 * s) * q.w;
          heads[b].moveTo(hx + r, hy); heads[b].arc(hx, hy, r, 0, TAU);
          const lag = .05 + .16 * s;
          pos(q, u - q.v * lag * 3, t - lag * 3);
          tails[b].moveTo(hx, hy); tails[b].lineTo(px, py);
        }
        for (let b = 0; b < B; b++) {
          const [r, g, bl] = cols[b];
          const s = b / (B - 1);
          ctx.strokeStyle = `rgba(${r},${g},${bl},${(.18 + .42 * s) * alphaBase})`;
          ctx.lineWidth = 1 + 1.4 * s;
          ctx.stroke(tails[b]);
          ctx.fillStyle = `rgba(${r},${g},${bl},${(.5 + .5 * s) * alphaBase})`;
          ctx.fill(heads[b]);
        }
        ctx.globalCompositeOperation = 'source-over';
        if (true) {
          const fade = ctx.createLinearGradient(x0 - 40, 0, x0 + 260, 0);
          fade.addColorStop(0, 'rgba(3,6,12,1)'); fade.addColorStop(1, 'rgba(3,6,12,0)');
          ctx.fillStyle = fade; ctx.fillRect(x0 - 40, 0, 300, H);
        }
      }
      draw(6);
      slide._p = loop(t => draw(6 + t));
    },
    enter(slide) { if (!reduced) slide._p.start(); },
    leave(slide) { slide._p.stop(); },
  };

  /* ---------------- chain: N serial forward passes with a waiting clock ---------------- */
  S.chain = {
    mount(slide) {
      const host = slide.querySelector('.cv-steps');
      slide._steps = Array.from({ length: 10 }, (_, i) => {
        const d = h('div', 'cv-step', '<span>v<sub>θ</sub></span>', host);
        d.style.setProperty('--lv', rampAt((i + 1) / 10 * .8 + .1));
        return d;
      });
      slide._ms = slide.querySelector('.cv-ms');
      slide._l = loop(t => {
        const T = 3.6, f = clamp(t / T);
        const k = Math.floor(f * 10);
        slide._steps.forEach((d, i) => { d.classList.toggle('done', i < k || f >= 1); d.classList.toggle('active', i === k && f < 1); });
        slide._ms.textContent = Math.floor(503.53 * f);
        if (f >= 1) { slide.classList.add('chain-done'); slide._l.stop(); }
      });
    },
    enter(slide) {
      slide.classList.remove('chain-done');
      slide._steps.forEach(d => d.classList.remove('done', 'active'));
      slide._ms.textContent = '0';
      if (reduced) { slide._steps.forEach(d => d.classList.add('done')); slide._ms.textContent = '503'; return; }
      setTimeout(() => slide._l.restart(), 500);
    },
    leave(slide) { slide._l.stop(); },
  };

  /* ---------------- insight: vertical vs diagonal dependencies on one clock ---------------- */
  S.insight = {
    mount(slide) {
      const R = 5, C = 5, cs = 50, gx = 84, gy = 20, ox = 84, oy = 22;
      const X = c => ox + c * (cs + gx), Y = r => oy + r * (cs + gy);
      const panels = [...slide.querySelectorAll('.ins-panel')].map(panel => {
        const flow = panel.dataset.panel === 'flow';
        const svg = el('svg', { viewBox: '0 0 720 470' }, panel.querySelector('.ins-svg'));
        const defs = el('defs', {}, svg);
        const mk = (id, color) => { const m = el('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs); el('path', { d: 'M0,1 L9,5 L0,9 Z', fill: color }, m); return `url(#${id})`; };
        const idp = 'ins' + (flow ? 'f' : 'n');
        const headDim = mk(idp + 'd', '#5e7190'), headHot = mk(idp + 'h', '#e0a33a'), headSrc = mk(idp + 's', '#7d8ea8');
        // axes
        el('path', { d: `M40 ${oy} V${Y(R - 1) + cs}`, stroke: '#5e7190', 'stroke-width': 2.5, fill: 'none', 'marker-end': headDim }, svg);
        const ly = el('text', { x: 26, y: (oy + Y(R - 1) + cs) / 2, class: 'axl', transform: `rotate(-90 26 ${(oy + Y(R - 1) + cs) / 2})`, 'text-anchor': 'middle' }, svg); ly.textContent = '去噪步';
        el('path', { d: `M${ox} ${Y(R - 1) + cs + 66} H${X(C - 1) + cs}`, stroke: '#5e7190', 'stroke-width': 2.5, fill: 'none', 'marker-end': headDim }, svg);
        const lx = el('text', { x: (ox + X(C - 1) + cs) / 2, y: Y(R - 1) + cs + 92, class: 'axl', 'text-anchor': 'middle' }, svg); lx.textContent = '重规划步';
        const arrows = [];
        if (!flow) {
          for (let c = 0; c < C; c++) for (let r = 0; r < R - 1; r++) {
            const a = el('path', { d: `M${X(c) + cs / 2} ${Y(r) + cs + 4} V${Y(r + 1) - 6}`, class: 'arr', stroke: '#5e7190', 'marker-end': headDim }, svg);
            arrows.push({ a, r, c });
          }
        } else {
          for (let c = 0; c < C - 1; c++) {
            const s = el('path', { d: `M${X(c) + cs + 6} ${Y(0) + cs / 2} H${X(c + 1) - 8}`, class: 'arr', stroke: '#7d8ea8', 'stroke-dasharray': '5 6', 'marker-end': headSrc }, svg);
            arrows.push({ a: s, r: -1, c: c + 1, src: true });
            for (let r = 0; r < R - 1; r++) {
              const a = el('path', { d: `M${X(c) + cs + 2} ${Y(r) + cs + 2} L${X(c + 1) - 6} ${Y(r + 1) - 6}`, class: 'arr', stroke: '#5e7190', 'marker-end': headDim }, svg);
              arrows.push({ a, r, c: c + 1 });
            }
          }
          // the initial column is still native
          for (let r = 0; r < R - 1; r++) {
            const a = el('path', { d: `M${X(0) + cs / 2} ${Y(r) + cs + 4} V${Y(r + 1) - 6}`, class: 'arr', stroke: '#5e7190', 'stroke-dasharray': '4 5', 'marker-end': headDim }, svg);
            arrows.push({ a, r, c: 0, init: true });
          }
          const it = el('text', { x: X(0) + cs / 2, y: oy - 4, class: 'axl', 'text-anchor': 'middle', style: 'font-size:16px' }, svg); it.textContent = '初始化';
        }
        const cells = [];
        for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) {
          const rect = el('rect', { x: X(c), y: Y(r), width: cs, height: cs, rx: 14, class: 'cell', fill: RAMP[r] }, svg);
          cells.push({ rect, r, c });
        }
        const outs = Array.from({ length: C }, (_, c) => {
          const g = el('g', {}, svg);
          el('rect', { x: X(c) - 4, y: Y(R - 1) + cs + 14, width: cs + 8, height: 28, rx: 14, fill: flow ? '#1d8a7c' : '#46566c' }, g);
          const t = el('text', { x: X(c) + cs / 2, y: Y(R - 1) + cs + 34, 'text-anchor': 'middle', style: 'font:700 16px Inter,sans-serif;fill:#fff' }, g); t.textContent = '动作';
          return g;
        });
        const ring = el('rect', { class: 'ring', rx: 18 }, svg);
        return { panel, flow, cells, arrows, outs, ring, X, Y, cs, pass: panel.querySelector('.ins-pass'), out: panel.querySelector('.ins-out') };
      });
      const N = 4;
      function render(t) {
        for (const P of panels) {
          const T = Math.min(t, 20);
          let delivered, ringBox;
          const lit = (r, c) => {
            if (!P.flow || c === 0) return r === 0 ? T >= 4 * (P.flow ? 0 : c) : T >= (P.flow ? 0 : 4 * c) + r;
            return r === 0 ? T >= 3 + c : T >= 4 + c;
          };
          if (!P.flow) {
            delivered = Math.min(5, Math.floor(T / 4));
            const c = Math.min(4, Math.floor(T / 4)), r = Math.min(4, Math.floor(T) - 4 * c + 1);
            ringBox = T >= 20 ? null : [P.X(c) - 7, P.Y(r) - 7, P.cs + 14, P.cs + 14];
          } else {
            delivered = T < 4 ? 0 : Math.min(5, Math.floor(T) - 3);
            if (T < 4) { const r = Math.floor(T) + 1; ringBox = [P.X(0) - 7, P.Y(r) - 7, P.cs + 14, P.cs + 14]; }
            else if (T < 8) { const c = Math.floor(T) - 3; ringBox = [P.X(c) - 9, P.Y(0) - 9, P.cs + 18, P.Y(4) + P.cs - P.Y(0) + 18]; }
            else ringBox = null;
          }
          P.cells.forEach(({ rect, r, c }) => rect.setAttribute('opacity', lit(r, c) ? 1 : .26));
          P.outs.forEach((g, c) => g.setAttribute('opacity', c < delivered ? 1 : .12));
          if (ringBox) {
            P.ring.setAttribute('opacity', 1);
            ['x', 'y', 'width', 'height'].forEach((k, i) => P.ring.setAttribute(k, ringBox[i]));
          } else P.ring.setAttribute('opacity', 0);
          P.arrows.forEach(({ a, r, c, src, init }) => {
            let hot = false;
            if (!P.flow || init) {
              const base = P.flow ? 0 : 4 * c;
              hot = Math.floor(T) === base + r && T < (P.flow ? 4 : 20);
              if (P.flow && !init) hot = false;
            } else if (T >= 4 && T < 8) hot = c === Math.floor(T) - 3;
            a.setAttribute('stroke', hot ? '#e0a33a' : src ? '#7d8ea8' : '#5e7190');
            a.setAttribute('stroke-width', hot ? 4.5 : 3);
            a.setAttribute('opacity', hot ? 1 : .55);
          });
          P.pass.textContent = Math.min(P.flow ? 8 : 20, Math.floor(T));
          P.out.textContent = delivered;
        }
      }
      slide._render = render;
      slide._clock = loop(t => { const sp = .62; const T = (t / sp) % 24; render(T); });
      render(20);
    },
    enter(slide) { if (reduced) { slide._render(20); return; } slide._clock.restart(); },
    step(slide, st, opts) { if (opts?.dir === 1 && st === 1 && !reduced) slide._clock.restart(); },
    leave(slide) { slide._clock.stop(); },
  };

  /* ---------------- overlap: action 9 in four windows and along the diagonal ---------------- */
  S.overlap = {
    mount(slide) {
      const stair = slide.querySelector('.ov-stair');
      const tw = (stair.offsetWidth || 972) - 130, A0 = 3, A1 = 16, cw = tw / (A1 - A0 + 1);
      stair.style.setProperty('--cw', cw + 'px');
      const pos = ['7', '5', '3', '1'];
      for (let r = 0; r < 4; r++) {
        const row = h('div', 'ov-row', `<b>第 ${r + 1} 轮<small>9 在第 ${pos[r]} 格</small></b>`, stair);
        row.dataset.in = String(r);
        if (r === 0) row.removeAttribute('data-in');
        const tr = h('div', 'ov-track', null, row);
        const s = 3 + 2 * r;
        for (let i = 0; i < 8; i++) {
          const a = s + i;
          const c = h('span', 'ov-cell' + (i < 2 ? ' ex' : '') + (a === 9 ? ' nine' : '') + (i >= 6 ? ' new' : ''), String(a), tr);
          c.style.left = ((a - A0) * cw) + 'px';
        }
      }
      const m = slide.querySelector('.ov-matrix');
      h('span', 'h', '', m);
      for (let c = 0; c < 4; c++) h('span', 'h', `第 ${c + 1} 轮<br><i class="m" style="font-size:20px">o<sub>${c + 1}</sub></i>`, m);
      for (let r = 0; r < 4; r++) {
        h('span', 'rl', `阶段 ${r + 1}`, m);
        for (let c = 0; c < 4; c++) {
          const d = h('span', 'mc' + (r === c ? ' d' : ''), r === c ? '9' : '', m);
          if (r === c) { d.style.background = RAMP[r + 1]; if (r) d.dataset.in = String(r); }
        }
      }
    },
  };

  /* ---------------- pipeline stack and loop ---------------- */
  S.pipe = {
    mount(slide) {
      const st = slide.querySelector('.pipe-stack');
      const labels = [['X<sub>0</sub>', '源噪声'], ['X<sub>1</sub>', '中间'], ['X<sub>2</sub>', '中间'], ['X<sub>3</sub>', '中间'], ['X<sub>4</sub>', '输出']];
      labels.forEach(([m, s], i) => {
        const row = h('div', 'ps-row' + (i === 4 ? ' out' : ''), `<b>${m}<small>${s}</small></b>`, st);
        const cells = h('div', 'ps-cells', null, row);
        for (let j = 0; j < 8; j++) { const c = h('i', '', null, cells); c.style.background = RAMP[Math.min(5, i + (i === 4 ? 1 : 0))]; c.style.setProperty('--noise', String(1 - i / 4)); }
      });
    },
    step(slide, st) { slide.querySelector('.loop-svg').style.setProperty('--ring', String(st * 25)); },
  };

  /* ---------------- streaming alignment ---------------- */
  S.align = {
    mount(slide) {
      const board = slide.querySelector('.al-board');
      const cw = 104;
      const head = slide.querySelector('.al-head'), rows = slide.querySelector('.al-rows');
      slide._cells = [];
      slide._heads = [];
      for (let a = 3; a <= 12; a++) { const s = h('span', '', String(a), head); slide._heads.push({ s, a }); }
      for (let i = 0; i < 4; i++) {
        const row = h('div', 'al-row', `<b>C<sub>${i}</sub></b>`, rows);
        h('i', 'al-win', null, row);
        for (let a = 3; a <= 12; a++) {
          const c = h('i', 'al-cell' + (a >= 11 ? ' tail' : ''), null, row);
          c.style.background = RAMP[i];
          c.style.setProperty('--noise', String(a >= 11 ? 1 - i / 4 : (1 - i / 4) * .9));
          c.style.setProperty('--drop', ((4 - i) * 86 + 60) + 'px');
          slide._cells.push({ c, a, i });
        }
      }
      const ex = slide.querySelector('.al-exec-cells');
      ['3', '4'].forEach(n => h('i', '', n, ex));
      slide._cw = cw;
      this.step(slide, 0);
    },
    step(slide, st) {
      const off = st >= 1 ? 5 : 3, cw = slide._cw;
      slide._cells.forEach(({ c, a }) => {
        c.style.left = ((a - off) * cw) + 'px';
        c.classList.toggle('gone', st >= 1 && a < 5);
        c.style.visibility = (st === 0 && a > 10) ? 'hidden' : 'visible';
      });
      slide._heads.forEach(({ s, a }) => {
        s.style.left = ((a - off) * cw) + 'px';
        s.style.opacity = (a < off || a > off + 7 || (st < 2 && a > 10)) ? 0 : 1;
      });
    },
  };

  /* ---------------- reconstruction weights ---------------- */
  S.recon = {
    mount(slide) {
      const m = slide.querySelector('.rc-mat');
      const N = 4, t = Array.from({ length: N + 1 }, (_, i) => i / N), r = t.map(v => 1 - v);
      const alpha = i => r[i + 1] / r[i];
      for (let i = 1; i <= N; i++) for (let j = 0; j < N; j++) {
        let w = 0;
        if (j < i) { w = 1 - alpha(j); for (let l = j + 1; l < i; l++) w *= alpha(l); }
        const c = h('i', '', null, m);
        if (w > 0) c.style.background = `rgba(45,93,168,${.18 + .82 * w})`;
      }
    },
  };

  /* ---------------- main results ---------------- */
  const RES = [
    { n: 'FM 策略', s: 'RoboMimic · RGB', v: [43.6, 61.2, 64.7, 65.1] },
    { n: 'Xiaomi Robotics 0', s: 'SimplerEnv', v: [72.0, 74.0, 81.3, 79.2] },
    { n: 'GR00T N1.7', s: 'SimplerEnv', v: [54.8, 59.9, 62.5, 62.1] },
    { n: 'Fast-WAM', s: 'RoboTwin 2.0', v: [40.8, 89.4, 91.0, 91.1] },
    { n: 'OpenWAM', s: 'RoboTwin 2.0', v: [48.4, 82.1, 88.3, 87.5] },
  ];
  S.results = {
    mount(slide) {
      const ch = slide.querySelector('.res-chart');
      const grid = h('div', 'res-grid', null, ch);
      [0, 25, 50, 75, 100].forEach(v => { const i = h('i', '', `<span>${v}</span>`, grid); i.style.bottom = v + '%'; });
      slide._bars = [];
      RES.forEach((g, gi) => {
        const G = h('div', 'res-group', null, ch);
        const bars = h('div', 'res-bars', null, G);
        g.v.forEach((v, k) => {
          const b = h('div', 'res-bar c' + k, `<i></i><b>${v.toFixed(1)}</b>`, bars);
          b.style.setProperty('--h', v);
          b.style.setProperty('--d', (gi * .08 + (k % 2) * .1) + 's');
          slide._bars.push({ b, k });
        });
        const gain = h('span', 'res-gain', '+' + (g.v[2] - g.v[1]).toFixed(1), bars);
        gain.style.top = '-64px';
        h('div', 'res-name', `<b>${g.n}</b><span>${g.s}</span>`, G);
      });
    },
    enter(slide, st) { slide._bars.forEach(({ b }) => b.classList.remove('v')); setTimeout(() => this.step(slide, slide.dataset.step | 0), 60); },
    step(slide, st) { slide._bars.forEach(({ b, k }) => b.classList.toggle('v', k < 2 || st >= 1)); },
    leave(slide) { slide._bars.forEach(({ b }) => b.classList.remove('v')); },
  };

  /* ---------------- test-time scaling ---------------- */
  const SC = {
    sr: { nat: [30, 72, 70, 76, 74, 78, 80, 80, 76, 72], flow: [18, 52, 76, 74, 84, 84, 84, 84, 86, 88], max: 100, ticks: [0, 25, 50, 75, 100] },
    lat: { nat: [122.2, 162.5, 197.3, 233.3, 277.9, 315.7, 345.6, 383.1, 431.8, 469.2], flow: [126.2, 119.3, 122.0, 121.1, 122.9, 123.5, 121.9, 123.6, 122.5, 123.1], max: 500, ticks: [0, 125, 250, 375, 500] },
  };
  S.scaling = {
    mount(slide) {
      const L = 80, Rr = 730, T = 24, Bm = 380;
      const xs = i => L + (Rr - L) * i / 9;
      slide._charts = [...slide.querySelectorAll('.sc-svg')].map(svg => {
        const d = SC[svg.dataset.chart];
        const y = v => Bm - (Bm - T) * v / d.max;
        const defs = el('defs', {}, svg);
        const g = el('linearGradient', { id: 'scg', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
        el('stop', { offset: 0, 'stop-color': '#2d5da8' }, g); el('stop', { offset: 1, 'stop-color': '#1d8a7c' }, g);
        const grid = el('g', { class: 'grid' }, svg);
        d.ticks.forEach(v => { el('line', { x1: L, x2: Rr, y1: y(v), y2: y(v) }, grid); const t = el('text', { x: L - 14, y: y(v) + 6, 'text-anchor': 'end' }, grid); t.textContent = v; });
        for (let i = 0; i < 10; i++) { const t = el('text', { x: xs(i), y: Bm + 34, 'text-anchor': 'middle' }, grid); t.textContent = i + 1; }
        const tN = el('text', { x: (L + Rr) / 2, y: Bm + 58, 'text-anchor': 'middle' }, grid); tN.textContent = '并行阶段数 N';
        const pts = a => a.map((v, i) => `${xs(i)},${y(v)}`).join(' ');
        const nat = el('polyline', { points: pts(d.nat), class: 'nat' }, svg);
        const flow = el('polyline', { points: pts(d.flow), class: 'flow draw' }, svg);
        const len = flow.getTotalLength ? 2000 : 2000;
        flow.style.strokeDasharray = len; flow.style.strokeDashoffset = len;
        const cur = el('line', { y1: T - 6, y2: Bm, class: 'cursor' }, svg);
        const dn = el('circle', { r: 9, class: 'dot-n' }, svg), df = el('circle', { r: 11, class: 'dot-f' }, svg);
        return { d, y, flow, len, cur, dn, df, nat };
      });
      slide._set = n => {
        const i = clamp(n, 1, 10) - 1;
        const fi = Math.floor(i), fr = i - fi, nx = Math.min(9, fi + 1);
        const lerp = (a) => a[fi] + (a[nx] - a[fi]) * fr;
        slide._charts.forEach(c => {
          const x = L + (Rr - L) * i / 9;
          c.cur.setAttribute('x1', x); c.cur.setAttribute('x2', x);
          c.dn.setAttribute('cx', x); c.dn.setAttribute('cy', c.y(lerp(c.d.nat)));
          c.df.setAttribute('cx', x); c.df.setAttribute('cy', c.y(lerp(c.d.flow)));
        });
        const k = Math.round(i);
        slide.querySelector('.sc-nv').textContent = k + 1;
        slide.querySelector('.sc-f-sr').textContent = SC.sr.flow[k] + '%';
        slide.querySelector('.sc-n-sr').textContent = SC.sr.nat[k] + '%';
        slide.querySelector('.sc-f-lat').textContent = Math.round(SC.lat.flow[k]) + ' ms';
        slide.querySelector('.sc-n-lat').textContent = Math.round(SC.lat.nat[k]) + ' ms';
      };
      slide._sweep = loop(t => { const n = 1 + 9 * ease(clamp((t - .6) / 3.4)); slide._set(n); if (t > 4.2) slide._sweep.stop(); });
      slide._set(1);
    },
    enter(slide, st) { this.step(slide, st, { dir: 1 }); },
    step(slide, st) {
      const show = true;
      slide._charts.forEach(c => { c.flow.style.strokeDashoffset = show ? '0' : String(c.len); });
      slide._charts.forEach(c => c.df.setAttribute('opacity', show ? 1 : 0));
      if (reduced) { slide._set(10); return; }
      slide._sweep.restart();
    },
    leave(slide) { slide._sweep.stop(); slide._charts.forEach(c => { c.flow.style.strokeDashoffset = String(c.len); }); },
  };

  /* ---------------- five-policy cumulative speedup ---------------- */
  const STG = ['原生', 'OneFlow', '+ CUDA 图', '+ 预计算', '+ I/O 优化', '+ 算子融合', '+ 内核调优'];
  const POL = [
    ['FM 策略', 'N = 8 · RoboMimic', [25.0488, 12.1698, 3.6637, 3.6103, 2.0231, 1.2244, 0.9896]],
    ['Xiaomi Robotics 0', 'N = 5 · SimplerEnv', [131.1191, 69.8042, 28.9064, 28.9374, 24.8864, 13.2274, 12.6839]],
    ['GR00T N1.7', 'N = 4 · SimplerEnv', [111.7282, 57.9495, 20.6344, 19.9068, 16.8046, 10.1200, 9.7692]],
    ['OpenWAM', 'N = 10 · RoboTwin 2.0', [447.0769, 110.6241, 74.8252, 50.1436, 38.5968, 19.6163, 19.3971]],
    ['Fast-WAM', 'N = 10 · RoboTwin 2.0', [503.5291, 103.2031, 52.1490, 42.2517, 34.8397, 16.8103, 16.6204]],
  ];
  S.cascade = {
    mount(slide) {
      const sh = slide.querySelector('.cas-stages'), rh = slide.querySelector('.cas-rows');
      slide._btn = STG.map((s, i) => { const b = h('button', '', `<i></i>${s}`, sh); b.type = 'button'; b.addEventListener('click', e => { e.stopPropagation(); slide._seek(i); }); return b; });
      slide._rows = POL.map(([n, m, lat]) => {
        const row = h('div', 'cas-row', `<div class="pn"><b>${n}</b><span>${m}</span></div>
          <div class="cas-bars"><div class="cas-lane"><div class="cas-track"><i class="nat"></i></div><span class="cas-ms">${lat[0].toFixed(2)} ms</span></div>
          <div class="cas-lane ours"><div class="cas-track"><i class="trail"></i><i class="flow"></i></div><span class="cas-ms"></span></div></div>
          <div class="cas-x"><span>1.0</span><small>×</small></div>`, rh);
        return { lat, flow: row.querySelector('.flow'), trail: row.querySelector('.trail'), ms: row.querySelector('.ours .cas-ms'), x: row.querySelector('.cas-x span'), tw: 1 };
      });
      let s = 0, raf = 0;
      const render = (v, dt) => {
        s = v;
        const k = Math.min(STG.length - 2, Math.floor(v)), f = v - k;
        slide._rows.forEach(r => {
          const cur = r.lat[k] + (r.lat[k + 1] - r.lat[k]) * f, w = Math.max(.012, cur / r.lat[0]);
          r.flow.style.transform = `scaleX(${w})`;
          r.tw = dt == null ? w : Math.max(w, r.tw + (w - r.tw) * (1 - Math.exp(-dt / .25)));
          r.trail.style.transform = `scaleX(${r.tw})`;
          r.ms.textContent = cur.toFixed(2) + ' ms';
          r.x.textContent = (r.lat[0] / cur).toFixed(1);
        });
        const reached = Math.round(v * 1000) / 1000;
        slide._btn.forEach((b, i) => { b.style.setProperty('--f', clamp(v - i + 1)); b.classList.toggle('done', i <= reached); b.classList.toggle('now', Math.floor(reached + 1e-6) === i); });
        slide.classList.toggle('final', v >= STG.length - 1 - 1e-6);
      };
      slide._render = render;
      slide._seek = (to, dur) => {
        cancelAnimationFrame(raf);
        if (reduced) { render(to); return; }
        const from = s, D = dur ?? .5 * Math.sqrt(Math.max(1, Math.abs(to - from)));
        const t0 = performance.now(); let prev = 0;
        const fr = now => { const f = clamp((now - t0) / 1000 / D); render(from + (to - from) * (dur ? f : ease(f)), prev ? (now - prev) / 1000 : 0); prev = now; if (f < 1) raf = requestAnimationFrame(fr); };
        raf = requestAnimationFrame(fr);
      };
      render(0);
    },
    enter(slide) { slide._render(0); setTimeout(() => slide._seek(STG.length - 1, 5.2), 700); },
    leave(slide) { slide._render(0); },
  };

  /* ---------------- smoothness illustration ---------------- */
  S.smooth = {
    mount(slide) {
      const svg = slide.querySelector('.sm-svg');
      const defs = el('defs', {}, svg);
      const g = el('linearGradient', { id: 'smg', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
      el('stop', { offset: 0, 'stop-color': '#2d5da8' }, g); el('stop', { offset: 1, 'stop-color': '#1d8a7c' }, g);
      const L = 40, Rr = 940, top = 40, bot = 380, chunks = 4, per = 12;
      const n = chunks * per;
      const x = i => L + (Rr - L) * i / (n - 1);
      const base = i => 210 + 110 * Math.sin(i / n * TAU * 1.1 + .4) + 40 * Math.sin(i / n * TAU * 2.7);
      for (let c = 1; c < chunks; c++) el('line', { x1: x(c * per) - (Rr - L) / (n - 1) / 2, x2: x(c * per) - (Rr - L) / (n - 1) / 2, y1: top - 10, y2: bot, class: 'bd' }, svg);
      const offs = [0, 34, -40, 26];
      const natPts = [], flowPts = [];
      let seed = 3;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 - .5; };
      for (let i = 0; i < n; i++) {
        const c = Math.floor(i / per), u = (i % per) / (per - 1);
        const drift = offs[c] * (1 - u * .5);
        natPts.push([x(i), base(i) + drift + rnd() * 18]);
        flowPts.push([x(i), base(i) + rnd() * 4]);
      }
      const P = a => a.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
      const nat = el('polyline', { points: P(natPts), class: 'nat' }, svg);
      const flow = el('polyline', { points: P(flowPts), class: 'flow' }, svg);
      for (let c = 1; c < chunks; c++) {
        const a = natPts[c * per - 1], b = natPts[c * per];
        el('ellipse', { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: 18, ry: Math.abs(a[1] - b[1]) / 2 + 14, class: 'jump' }, svg);
      }
      [nat, flow].forEach(p => { p.style.strokeDasharray = 3000; p.style.strokeDashoffset = 3000; p.style.transition = 'stroke-dashoffset 2.4s cubic-bezier(.65,0,.35,1)'; });
      slide._lines = [nat, flow];
    },
    enter(slide) { slide._lines.forEach((p, i) => { p.style.transitionDelay = (.3 + i * .5) + 's'; p.style.strokeDashoffset = 0; }); },
    leave(slide) { slide._lines.forEach(p => { p.style.transitionDelay = '0s'; p.style.strokeDashoffset = 3000; }); },
  };

  window.OFDScenes = S;
})();
