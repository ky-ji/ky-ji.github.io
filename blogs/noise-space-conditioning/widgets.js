/* Interactive figures for "A Noise-Space Perspective on Conditioning in Robot Policies".
   Vanilla JS, no dependencies. Every measured number comes from window.NSC_DATA,
   which build_blog_figures.py generates from data/*.json. Mechanistic animations are
   labelled "Schematic" in the page; their spreads and offsets are scaled from those
   measurements, while path shapes are illustrative. */
(function () {
  "use strict";

  var D = window.NSC_DATA;
  var C = {
    blue: "#1a73e8", blueSoft: "#e8f0fe", blueMid: "#8ab4f8",
    orange: "#d96b27", orangeSoft: "#fdf0e6", orangeMid: "#f2a36b",
    ink: "#202124", ink2: "#3c4043", muted: "#5f6368", light: "#9aa0a6",
    rule: "#dadce0", grid: "#eceff1", soft: "#f8f9fa", white: "#ffffff"
  };
  var FONT = '"Hanken Grotesk", "InterFallback", "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
  var langListeners = [];
  function lang() { return document.documentElement.getAttribute("data-lang") === "zh" ? "zh" : "en"; }
  function t(en, zh) { return lang() === "zh" && zh != null ? zh : en; }
  function onLang(fn) { langListeners.push(fn); }
  function setLang(l) {
    var next = l === "zh" ? "zh" : "en";
    document.documentElement.setAttribute("data-lang", next);
    document.documentElement.setAttribute("lang", next === "zh" ? "zh-Hans" : "en");
    document.title = next === "zh"
      ? "从噪声空间看机器人策略中的条件控制 | 季康业"
      : "A Noise-Space Perspective on Conditioning in Robot Policies | Kangye Ji";
    $$(".ar-lang button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-lang") === next ? "true" : "false");
    });
    langListeners.forEach(function (fn) { try { fn(next); } catch (e) { if (window.console) console.error(e); } });
  }
  function initLang() {
    var m = /[?&]lang=(en|zh)/.exec(location.search);
    setLang(m ? m[1] : (document.documentElement.getAttribute("data-lang") || "en"));
    $$(".ar-lang button").forEach(function (b) {
      b.addEventListener("click", function () {
        var next = b.getAttribute("data-lang");
        if (next === lang()) return;
        setLang(next);
      });
    });
  }
  var mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function reduced() { return !!mqReduce.matches; }
  var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* ---------------------------------------------------------------- utils */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    var u = 0; while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function fx(x, d) { return Number(x).toFixed(d); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* HiDPI canvas whose CSS box is set by the stylesheet. */
  function HiCanvas(canvas, onResize) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = 0; this.h = 0; this.dpr = 1;
    this.onResize = onResize;
    var self = this;
    this.resize();
    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (self.resize() && self.onResize) self.onResize(); }).observe(canvas);
    } else {
      window.addEventListener("resize", function () { if (self.resize() && self.onResize) self.onResize(); });
    }
  }
  HiCanvas.prototype.resize = function () {
    var w = Math.max(1, Math.round(this.c.clientWidth || 0));
    var h = Math.max(1, Math.round(this.c.clientHeight || 0));
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.w = w; this.h = h; this.dpr = dpr;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  };
  HiCanvas.prototype.clear = function () {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
  };

  function onVisible(el, cb) {
    if (!("IntersectionObserver" in window)) { cb(true); return; }
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { cb(e.isIntersecting); });
    }, { rootMargin: "120px 0px" }).observe(el);
  }

  /* Pill group: buttons carrying data-<attr>. Returns a setter. */
  function pillGroup(group, attr, onPick) {
    var btns = $$("button", group);
    function set(v) {
      btns.forEach(function (b) {
        var on = b.getAttribute(attr) === v;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    btns.forEach(function (b) {
      b.addEventListener("click", function () { var v = b.getAttribute(attr); set(v); onPick(v); });
    });
    return set;
  }

  function font(size, weight, italic) { return (italic ? "italic " : "") + (weight || 400) + " " + size + "px " + FONT; }

  /* Draw "a*" / "z*" style labels with a raised star. */
  /* Text with a thin white halo so it stays legible over particles and paths. */
  function haloText(ctx, str, x, y) {
    ctx.save();
    ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.strokeText(str, x, y);
    ctx.restore();
    ctx.fillText(str, x, y);
  }
  function starLabel(ctx, x, y, base, color, align) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = font(12.5, 600, true);
    var w1 = ctx.measureText(base).width;
    ctx.font = font(10, 600);
    var w2 = ctx.measureText("*").width;
    var x0 = align === "right" ? x - (w1 + w2) : x;
    ctx.font = font(12.5, 600, true);
    ctx.textAlign = "left";
    haloText(ctx, base, x0, y);
    ctx.font = font(10, 600);
    haloText(ctx, "*", x0 + w1 + 0.5, y - 4);
    ctx.restore();
  }
  /* "D_M 102.4" with a real subscript. */
  function dmLabel(ctx, x, y, value, color, align) {
    ctx.save();
    ctx.fillStyle = color; ctx.textAlign = "left";
    ctx.font = font(11, 600); var wD = ctx.measureText("D").width;
    ctx.font = font(8.5, 600); var wM = ctx.measureText("M").width;
    ctx.font = font(11, 600); var wV = ctx.measureText(" " + value).width;
    var x0 = align === "center" ? x - (wD + wM + wV) / 2 : align === "right" ? x - (wD + wM + wV) : x;
    haloText(ctx, "D", x0, y);
    ctx.font = font(8.5, 600); haloText(ctx, "M", x0 + wD, y + 3);
    ctx.font = font(11, 600); haloText(ctx, " " + value, x0 + wD + wM, y);
    ctx.restore();
  }

  function dashedEllipse(ctx, cx, cy, rx, ry, rot, stroke, fill, dash, lw) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.4; ctx.stroke();
    }
    ctx.restore();
  }

  /* ================================================================
     HERO · flow-matching ODE particles, t = 1 (noise) -> t = 0 (action)
     ================================================================ */
  function initHero() {
    var root = document.getElementById("hero-widget");
    if (!root || !D) return;
    var H = D.hero;
    var N = 72, SAMPLES = 60;
    var ASTAR = [-0.2, 0.12];
    var R0 = 0.8, BASE = 0.075, ROT = -0.5, ASPECT = 0.62, KAPPA = 0.34;
    var COLORS = { full: C.ink2, bad: C.orange, zero: C.blue };
    var SOFTS = { full: "rgba(60,64,67,0.06)", bad: C.orangeSoft, zero: C.blueSoft };
    var kinds = ["full", "bad", "zero"];
    var panels = kinds.map(function (k) {
      var el = $('.hero-panel[data-kind="' + k + '"]', root);
      var p = { kind: k, el: el };
      p.cv = new HiCanvas($("canvas", el), function () { draw(); });
      return p;
    });
    var model = "gr00t";
    var sims = {};
    var s = reduced() ? 1 : 0;           // progress: 0 at t = 1, 1 at t = 0
    var playing = !reduced();
    var visible = true;
    var clock = 0, last = 0;
    var T_HOLD0 = 0.7, T_FLOW = 3.6, T_HOLD1 = 2.6;
    var playBtn = $('[data-act="play"]', root);
    var replayBtn = $('[data-act="replay"]', root);
    var range = $(".scrub input", root);
    var out = $(".scrub-out", root);

    function rot(v, a) { var c = Math.cos(a), sn = Math.sin(a); return [c * v[0] - sn * v[1], sn * v[0] + c * v[1]]; }
    function norm(v) { var l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; }

    function cloudSpec(kind) {
      var h = H[model];
      if (kind === "full") return { mu: ASTAR.slice(), sd: BASE };
      if (kind === "bad") {
        // tight like the full cloud (measured width ratio), displaced by log D_M ratio
        var dist = BASE * (2 + 1.6 * Math.log(h.bad.dm / h.full.dm));
        var d = norm([1, -0.62]);
        return { mu: [ASTAR[0] + d[0] * dist, ASTAR[1] + d[1] * dist], sd: BASE * h.rawRatio.bad };
      }
      // no VLM: measured width ratio; a* stays inside (offset < 1 sd)
      var sd = BASE * h.rawRatio.zero;
      var dz = sd * 0.45 * Math.log(h.zero.dm / h.full.dm);
      var dd = norm([0.8, -0.3]);
      return { mu: [ASTAR[0] + dd[0] * dz, ASTAR[1] + dd[1] * dz], sd: sd };
    }

    function pathPoint(z, a, e) {
      var dx = a[0] - z[0], dy = a[1] - z[1];
      var b = KAPPA * e * (1 - e);
      return [(1 - e) * z[0] + e * a[0] - b * dy, (1 - e) * z[1] + e * a[1] + b * dx];
    }

    function build() {
      sims = {};
      kinds.forEach(function (kind, ki) {
        var rng = mulberry32((model === "gr00t" ? 101 : 202) + ki * 17);
        var spec = cloudSpec(kind);
        var zs = [], as = [];
        var phase = rng() * Math.PI * 2;
        for (var i = 0; i < N; i++) {
          var th = phase + (2 * Math.PI * (i + 0.5 + (rng() - 0.5) * 0.7)) / N;
          var r = R0 * (1 + 0.045 * clamp(gauss(rng), -2.5, 2.5));
          zs.push([r * Math.cos(th), r * Math.sin(th)]);
          var e1 = clamp(gauss(rng), -2.4, 2.4), e2 = clamp(gauss(rng), -2.4, 2.4);
          var off = rot([spec.sd * e1, spec.sd * ASPECT * e2], ROT);
          as.push([spec.mu[0] + off[0], spec.mu[1] + off[1]]);
        }
        // pair noise and targets by angle so ODE paths do not cross (a coherent field)
        var ang = function (p, c) { return Math.atan2(p[1] - c[1], p[0] - c[0]); };
        zs.sort(function (p, q) { return ang(p, [0, 0]) - ang(q, [0, 0]); });
        as.sort(function (p, q) { return ang(p, spec.mu) - ang(q, spec.mu); });
        var parts = zs.map(function (z, i) {
          var a = as[(i + Math.floor(N * 0.08)) % N];
          var pts = [];
          for (var j = 0; j <= SAMPLES; j++) pts.push(pathPoint(z, a, j / SAMPLES));
          return { z: z, a: a, pts: pts };
        });
        var sim = { spec: spec, parts: parts };
        if (kind === "zero") {
          var thO = 2.55, zO = [R0 * Math.cos(thO), R0 * Math.sin(thO)];
          var opts = [];
          for (var j2 = 0; j2 <= SAMPLES; j2++) opts.push(pathPoint(zO, ASTAR, j2 / SAMPLES));
          sim.oracle = { z: zO, a: ASTAR, pts: opts };
        }
        sims[kind] = sim;
      });
    }

    function drawPanel(p) {
      var cv = p.cv, ctx = cv.ctx, w = cv.w, h = cv.h;
      if (w < 4 || h < 4) return;
      cv.clear();
      var sim = sims[p.kind]; if (!sim) return;
      var U = Math.min(w, h) / 2 * 0.98;
      var cx = w / 2, cy = h / 2;
      function X(v) { return cx + v[0] * U; }
      function Y(v) { return cy - v[1] * U; }
      var col = COLORS[p.kind];
      var endA = smooth(0.78, 1.0, s);

      // noise shell (where Gaussian samples concentrate)
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R0 * U, 0, Math.PI * 2);
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(128,134,139," + (0.55 - 0.3 * s).toFixed(3) + ")";
      ctx.stroke(); ctx.restore();
      if (p.kind === "full") {
        ctx.save(); ctx.fillStyle = "rgba(95,99,104," + (0.85 - 0.5 * s).toFixed(3) + ")";
        ctx.font = font(10.5, 500); ctx.textAlign = "center";
        ctx.fillText(t("noise shell", "噪声球壳"), cx, cy - R0 * U - 5);
        ctx.restore();
      }

      // final support (2 sd contour) fades in near t = 0
      var sp = sim.spec;
      if (endA > 0) {
        ctx.save(); ctx.globalAlpha = endA;
        dashedEllipse(ctx, X(sp.mu), Y(sp.mu), 2.1 * sp.sd * U, 2.1 * sp.sd * ASPECT * U, -ROT,
          p.kind === "full" ? "rgba(60,64,67,0.55)" : col, SOFTS[p.kind], p.kind === "zero" ? [5, 3] : [], 1.4);
        ctx.restore();
      }

      // trails + particles
      var fi = s * SAMPLES, i0 = Math.floor(fi), fr = fi - i0;
      var parts = sim.parts;
      ctx.save();
      ctx.lineWidth = 1; ctx.strokeStyle = col; ctx.globalAlpha = 0.13;
      ctx.beginPath();
      for (var i = 0; i < parts.length; i++) {
        var pts = parts[i].pts;
        ctx.moveTo(X(pts[0]), Y(pts[0]));
        for (var j = 1; j <= i0; j++) ctx.lineTo(X(pts[j]), Y(pts[j]));
        if (i0 < SAMPLES) {
          var hp = [lerp(pts[i0][0], pts[i0 + 1][0], fr), lerp(pts[i0][1], pts[i0 + 1][1], fr)];
          ctx.lineTo(X(hp), Y(hp));
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.fillStyle = col;
      var rad = w < 200 ? 1.7 : 2.1;
      ctx.beginPath();
      for (var k = 0; k < parts.length; k++) {
        var q = parts[k].pts, hq = i0 < SAMPLES ? [lerp(q[i0][0], q[i0 + 1][0], fr), lerp(q[i0][1], q[i0 + 1][1], fr)] : q[SAMPLES];
        ctx.moveTo(X(hq) + rad, Y(hq));
        ctx.arc(X(hq), Y(hq), rad, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();

      // wrong panel: the target is left outside the support
      if (p.kind === "bad" && endA > 0) {
        ctx.save(); ctx.globalAlpha = endA;
        var ax = X(ASTAR), ay = Y(ASTAR), mx = X(sp.mu), my = Y(sp.mu);
        var vx = mx - ax, vy = my - ay, L = Math.hypot(vx, vy);
        var stopAt = L - 2.1 * sp.sd * U * 0.8;
        ctx.setLineDash([3, 3]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(ax + vx / L * 7, ay + vy / L * 7); ctx.lineTo(ax + vx / L * stopAt, ay + vy / L * stopAt); ctx.stroke();
        ctx.setLineDash([]);
        // distance label sits just below the trapped cloud
        if (w >= 170) dmLabel(ctx, mx, my + 2.1 * sp.sd * U + 16, fx(H[model].bad.dm, 1), C.orange, "center");
        ctx.restore();
      }

      // oracle trajectory z* -> a* (no-VLM panel)
      if (p.kind === "zero" && sim.oracle) {
        var op = sim.oracle.pts;
        ctx.save();
        ctx.strokeStyle = C.blue; ctx.lineWidth = 2.2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(X(op[0]), Y(op[0]));
        for (var m = 1; m <= i0; m++) ctx.lineTo(X(op[m]), Y(op[m]));
        var oh = i0 < SAMPLES ? [lerp(op[i0][0], op[i0 + 1][0], fr), lerp(op[i0][1], op[i0 + 1][1], fr)] : op[SAMPLES];
        ctx.lineTo(X(oh), Y(oh)); ctx.stroke();
        ctx.fillStyle = C.white; ctx.strokeStyle = C.blue; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(op[0]), Y(op[0]), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        starLabel(ctx, X(op[0]) - 7, Y(op[0]) + 4, "z", C.blue, "right");
        ctx.fillStyle = C.blue;
        ctx.beginPath(); ctx.arc(X(oh), Y(oh), 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // the target a* (same place in every panel)
      ctx.save();
      var tx = X(ASTAR), ty = Y(ASTAR);
      if (p.kind === "zero" && endA > 0) {
        ctx.globalAlpha = endA; ctx.strokeStyle = C.blue; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(tx, ty, 8, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(tx, ty, 5.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(tx, ty, 3.7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (p.kind === "bad") starLabel(ctx, tx - 9, ty + 4, "a", C.ink, "right");
      else if (p.kind === "full") {
        var rr = Math.max(10, 2.1 * sp.sd * U * (0.6 + 0.4 * endA));
        starLabel(ctx, tx - rr - 4, ty - rr * 0.45, "a", C.ink, "right");
      } else starLabel(ctx, tx - 9, ty - 9, "a", C.ink, "right");
    }

    function draw() { panels.forEach(drawPanel); }

    function setText() {
      var h = H[model];
      var f = panels[0].el, b = panels[1].el, z = panels[2].el;
      var badLbl = h.bad.label === "wrong scene" ? t("wrong scene", "错误场景") : t(h.bad.label, "中性均值");
      $(".hp-big", f).textContent = fx(h.full.sr, 1) + t("% success", "% 成功率");
      $(".hp-meta", f).innerHTML = t("width ", "宽度 ") + fx(h.full.width, 2) + " · D<sub>M</sub> " + fx(h.full.dm, 1);
      $(".hp-big", b).textContent = fx(h.bad.sr, 1) + t("% success", "% 成功率");
      $(".hp-meta", b).innerHTML = badLbl + " · " + t("width ", "宽度 ") + fx(h.bad.width, 2) + " · D<sub>M</sub> " + fx(h.bad.dm, 1);
      $(".hp-big", z).textContent = t(fx(h.zero.sr, 1) + "% success with z*", "配 z* 达 " + fx(h.zero.sr, 1) + "% 成功率");
      $(".hp-meta", z).innerHTML = t("width ", "宽度 ") + fx(h.zero.width, 2) + " (" + fx(h.zero.ratio, 1) + "×) · D<sub>M</sub> " + fx(h.zero.dm, 1);
      var foot = $(".hero-model-note", root);
      if (foot) foot.textContent = model === "gr00t"
        ? t("Cross-attention VLA (GR00T N1.7). The wrong panel uses VLM tokens from a different scene.", "交叉注意力 VLA（GR00T N1.7）。错误面板使用的是另一场景的 VLM token。")
        : t("Layer-wise KV-cache VLA (Xiaomi Robotics-0). The wrong panel uses the 16-scene mean of all 36 KV layers.", "逐层 KV 缓存 VLA（Xiaomi Robotics-0）。错误面板使用的是 16 个场景在全部 36 层 KV 上的均值。");
      if (replayBtn) replayBtn.textContent = t("Replay", "重播");
    }

    function syncUi() {
      if (range) range.value = String(Math.round(s * 1000));
      if (out) out.textContent = "t = " + fx(1 - s, 2);
      if (playBtn) {
        playBtn.textContent = playing ? t("Pause", "暂停") : t("Play", "播放");
        playBtn.setAttribute("aria-pressed", playing ? "false" : "true");
      }
    }

    function clockToS(c) {
      if (c < T_HOLD0) return 0;
      if (c < T_HOLD0 + T_FLOW) return easeInOut((c - T_HOLD0) / T_FLOW);
      return 1;
    }
    function sToClock(v) {
      // invert the easing approximately (bisection) so Play resumes from the scrubbed point
      if (v <= 0) return 0;
      if (v >= 1) return T_HOLD0 + T_FLOW;
      var lo = 0, hi = 1;
      for (var i = 0; i < 24; i++) { var mid = (lo + hi) / 2; if (easeInOut(mid) < v) lo = mid; else hi = mid; }
      return T_HOLD0 + lo * T_FLOW;
    }

    var looping = false;
    function loop(ts) {
      if (!playing || !visible) { looping = false; return; }
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
      last = ts;
      clock += dt;
      if (clock > T_HOLD0 + T_FLOW + T_HOLD1) clock = 0;
      s = clockToS(clock);
      draw(); syncUi();
      raf(loop);
    }
    function kick() { if (!looping && playing && visible) { looping = true; last = 0; raf(loop); } }

    if (playBtn) playBtn.addEventListener("click", function () {
      playing = !playing;
      if (playing) { if (s >= 1) clock = 0; else clock = sToClock(s); kick(); }
      syncUi();
    });
    if (replayBtn) replayBtn.addEventListener("click", function () {
      clock = 0; s = 0; playing = true; syncUi(); draw(); kick();
    });
    if (range) range.addEventListener("input", function () {
      playing = false; s = Number(range.value) / 1000; draw(); syncUi();
    });
    pillGroup($(".pills", root), "data-model", function (m) {
      model = m; build(); setText();
      if (playing) { clock = 0; s = 0; }
      draw(); syncUi(); kick();
    });
    onVisible(root, function (v) { visible = v; if (v) kick(); });
    if (mqReduce.addEventListener) mqReduce.addEventListener("change", function () {
      if (reduced()) { playing = false; s = 1; draw(); syncUi(); }
    });

    build(); setText(); draw(); syncUi(); kick();
    onLang(function () { setText(); syncUi(); draw(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  }

  /* ================================================================
     FIGURE 1 · swap between all-scene and per-task views
     ================================================================ */
  function initSwaps() {
    $$("[data-swap]").forEach(function (fig) {
      var views = $$("[data-view]", fig);
      pillGroup($(".pills", fig), "data-show", function (v) {
        views.forEach(function (el) { el.hidden = el.getAttribute("data-view") !== v; });
      });
    });
  }

  /* ================================================================
     FIGURE 2 · architecture gallery (inline SVG)
     Five paper-style schematics. Top tier: the two VLA paradigms (one noise
     source z_a). Bottom tier: the three WAM paradigms (two noise sources
     z_v, z_a), ordered from tightest video-action coupling to no future
     rollout. Every panel pairs its block topology with a 2x2 attention mask
     (rows are queries, columns are keys). Thin dashes drift along active
     wires and are dropped under prefers-reduced-motion. The static fallback
     figures/fig2-architectures.svg (build_fig2 in build_blog_figures.py)
     mirrors this geometry one to one.
     ================================================================ */
  var SVGNS = "http://www.w3.org/2000/svg";
  function S(tag, attrs, parent) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  /* SVG text where x_y and x_{...} become real subscripts (z_a, o_0, a_{1…H}).
     Subscripts use explicit dy shifts, since baseline-shift="sub" drops far too
     low with Hanken Grotesk metrics. Shift = 0.3em of the 72% size = 0.216em. */
  function T(parent, x, y, str, attrs) {
    var el = S("text", Object.assign({ x: x, y: y }, attrs || {}), parent);
    var re = /([A-Za-z])_(\{[^}]*\}|[A-Za-z0-9])/g, idx = 0, m, low = false;
    function plain(s) {
      if (!s) return;
      if (low) { S("tspan", { dy: "-0.216em" }, el).textContent = s; low = false; }
      else el.appendChild(document.createTextNode(s));
    }
    while ((m = re.exec(str))) {
      plain(str.slice(idx, m.index) + m[1]);
      S("tspan", { dy: "0.3em", "font-size": "72%" }, el).textContent = m[2].replace(/[{}]/g, "");
      low = true;
      idx = m.index + m[0].length;
    }
    plain(str.slice(idx));
    return el;
  }

  function initArch() {
    var root = document.getElementById("arch-widget");
    if (!root || !D) return;
    var host = $(".arch-host", root);
    var note = $(".arch-note", root);
    var W = D.wam;
    /* Slate hairlines and whisper fills plus the two accents (blue = z_a, orange = z_v). */
    var AG = {
      ink: "#1e293b", ink2: "#334155", mute: "#64748b", faint: "#94a3b8",
      l3: "#cbd5e1", l2: "#e2e8f0", f1: "#f1f5f9", f0: "#f8fafc", white: "#ffffff",
      blue: "#1a73e8", blueTint: "#e8f0fe", blueLine: "#8ab4f8", orange: "#d96b27"
    };
    var cards = [
      { key: "xattn", idx: "a", tier: 1, name: "Cross-Attention VLA", model: "GR00T-style · GR00T N1.7", tag: "decoupled readout", tagZh: "解耦读取", share: null,
        note: "The VLM encodes image and text once into a token sequence H, and the action DiT reads H only through cross-attention ports. The action noise z_a is the sole noise source and carries all trajectory variance.",
        noteZh: "VLM 将图文一次性编码为条件序列 H，动作 DiT 仅通过交叉注意力端口读取 H。动作噪声 z_a 是唯一噪声源，承载全部轨迹方差。" },
      { key: "kv", idx: "b", tier: 1, name: "Layer-wise KV-Cache VLA", model: "pi0 / MoT-style · Xiaomi Robotics-0", tag: "36-layer shared KV", tagZh: "36 层共享 KV", share: null,
        note: "Each of the 36 action-expert layers attends to the keys and values of the matching VLM layer, so conditioning is fused at every depth. The action noise z_a is still the only noise source and carries all trajectory variance.",
        noteZh: "动作专家的 36 层逐一关注 VLM 对应层的键值对，条件信号在每一层深度融合。动作噪声 z_a 仍是唯一噪声源，承载全部轨迹方差。" },
      { key: "joint", idx: "c", tier: 2, name: "Joint Video-Action WAM", model: "UVA / Motus-style · OpenWAM joint", share: W.mutual,
        note: "Video and action latents are denoised together from t = 1 to t = 0 under full bidirectional attention, so the video noise z_v ends up carrying " + fx(W.mutual.shareCh, 1) + "% of 32-step chunk variance.",
        noteZh: "视频潜变量与动作潜变量在全双向注意力下从 t = 1 同步去噪至 t = 0，视频噪声 z_v 最终承载了 32 步轨迹方差的 " + fx(W.mutual.shareCh, 1) + "%。" },
      { key: "vta", idx: "d", tier: 2, name: "Video-Then-Action WAM", model: "UniSim / DreamGen-style · OpenWAM IDM", share: W.idm,
        note: "Stage 1 denoises z_v into a complete future video and freezes it. Stage 2 decodes actions from that video with an inverse dynamics model that reads it one way, splitting chunk variance into " + fx(W.idm.shareCh, 1) + "% z_v and " + fx(100 - W.idm.shareCh, 1) + "% z_a.",
        noteZh: "第一阶段先将 z_v 去噪为完整未来视频并冻结，第二阶段由逆动力学模型单向读取视频并译出动作，使整段方差拆分为 " + fx(W.idm.shareCh, 1) + "% 的 z_v 与 " + fx(100 - W.idm.shareCh, 1) + "% 的 z_a。" },
      { key: "direct", idx: "e", tier: 2, name: "Direct-Action WAM", model: "FastWAM / VPP-style · OpenWAM isolated", share: W.isolated,
        note: "Future video tokens are masked at inference, so the action DiT reads only the current frame o_0, exactly like a VLA, and z_a carries " + (W.isolated.shareCh > 0 ? fx(100 - W.isolated.shareCh, 1) : "100") + "% of chunk variance.",
        noteZh: "推理时遮蔽全部未来视频 token，动作 DiT 像 VLA 一样只读取当前帧 o_0，动作噪声 z_a 承载 " + (W.isolated.shareCh > 0 ? fx(100 - W.isolated.shareCh, 1) : "100") + "% 的轨迹方差。" }
    ];
    function hintText() { return t("Hover or click any panel to inspect its attention coupling and variance split.", "悬停或点击任意架构卡片，查看其注意力耦合机制与噪声方差占比。"); }
    var focusKey = null, locked = null, narrow = null, svg = null, motion = true;

    function setNote(r) {
      note.innerHTML = "";
      if (!r) { note.textContent = hintText(); note.classList.remove("is-on"); return; }
      note.classList.add("is-on");
      var b = document.createElement("strong"); b.textContent = r.idx + " · " + r.name + (lang() === "zh" ? "。" : ". ");
      note.appendChild(b);
      t(r.note, r.noteZh).split(/(z_[av]|o_0)/).forEach(function (p) {
        var m = /^([zo])_([av0])$/.exec(p);
        if (m) { var i = document.createElement("i"); i.textContent = m[1]; var sb = document.createElement("sub"); sb.textContent = m[2]; i.appendChild(sb); note.appendChild(i); }
        else note.appendChild(document.createTextNode(p));
      });
    }
    function applyFocus() {
      if (!svg) return;
      var k = locked || focusKey;
      $$(".ag-card", svg).forEach(function (g) {
        var key = g.getAttribute("data-key");
        g.classList.toggle("is-focus", key === k);
        g.setAttribute("aria-pressed", locked === key ? "true" : "false");
      });
      setNote(cards.filter(function (r) { return r.key === k; })[0] || null);
    }

    /* ---------- primitives (mirrored by _Fig2 in build_blog_figures.py) ---------- */
    function mix(c1, c2, t) {
      var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16), out = "#";
      [16, 8, 0].forEach(function (s) {
        var v = Math.floor(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t + 0.5);
        out += (v < 16 ? "0" : "") + v.toString(16);
      });
      return out;
    }
    /* Deterministic R2 low-discrepancy sequence for latent noise, identical in Python. */
    function r2(i, seed) {
      var n = i + seed * 17;
      return [(0.5 + 0.7548776662 * n) % 1, (0.5 + 0.5698402910 * n) % 1];
    }
    var MK = {};
    MK[AG.ink2] = "k"; MK[AG.faint] = "m"; MK[AG.blue] = "b"; MK[AG.orange] = "o";
    function line(g, x1, y1, x2, y2, col, w, dash) {
      return S("line", { x1: x1, y1: y1, x2: x2, y2: y2, stroke: col, "stroke-width": w || 1, "stroke-dasharray": dash || null }, g);
    }
    function arrow(g, x1, y1, x2, y2, col, w, dash) {
      var el = line(g, x1, y1, x2, y2, col, w || 1, dash);
      el.setAttribute("marker-end", "url(#ag-ar-" + MK[col] + ")");
      return el;
    }
    function wire(g, d, col, w, head) {
      return S("path", { d: d, fill: "none", stroke: col, "stroke-width": w || 1, "stroke-linejoin": "miter", "marker-end": head ? "url(#ag-ar-" + MK[col] + ")" : null }, g);
    }
    function box(g, x, y, w, h, fill, stroke, sw, rx, dash) {
      return S("rect", { x: x, y: y, width: w, height: h, rx: rx === undefined ? 2.5 : rx, fill: fill, stroke: stroke || null, "stroke-width": stroke ? (sw || 1) : null, "stroke-dasharray": dash || null }, g);
    }
    /* Signal flow: faint dashes drifting along a wire, in the wire's direction. */
    function flow(g, d, col) {
      if (!motion) return;
      S("path", { d: d, fill: "none", stroke: col, class: "ag-flow" }, g);
    }
    /* Tensor block: crisp rectangle split into n cells by hairline ticks. */
    function tensor(g, x, y, w, h, n, fill, stroke, tick) {
      box(g, x, y, w, h, fill, null, 0, 1.5);
      for (var i = 1; i < n; i++) line(g, x + i * w / n, y, x + i * w / n, y + h, tick, 0.75);
      box(g, x, y, w, h, "none", stroke, 1, 1.5);
    }
    /* 3x3 latent patch grid. t = 1 is pure noise, t = 0 is the clean structured latent. */
    var PAT = [0.14, 0.14, 0.42, 0.14, 0.62, 0.42, 0.92, 0.92, 0.92];
    function latent(g, x, y, t, seed, mode) {
      var c = 8, i;
      if (mode === "ghost") {
        box(g, x, y, 24, 24, AG.white, AG.l3, 0.9, 1.5, "2 2");
        return;
      }
      for (i = 0; i < 9; i++) {
        var clean = mode === "obs" ? mix(AG.white, AG.ink2, PAT[i] * 0.78) : mix(AG.white, AG.orange, PAT[i]);
        var noisy = mix(AG.white, AG.faint, 0.12 + 0.78 * r2(i, seed)[0]);
        box(g, x + (i % 3) * c, y + Math.floor(i / 3) * c, c, c, mix(clean, noisy, t), null, 0, 0);
      }
      for (i = 1; i < 3; i++) { line(g, x + i * c, y, x + i * c, y + 24, AG.white, 0.75); line(g, x, y + i * c, x + 24, y + i * c, AG.white, 0.75); }
      var edge = mode === "obs" || mode === "frozen" ? AG.ink2 : t >= 1 ? AG.orange : AG.faint;
      box(g, x, y, 24, 24, "none", edge, mode === "obs" || mode === "frozen" ? 1.15 : 1, 1.5);
    }
    /* 1x4 action token vector. */
    function vector(g, x, y, t, seed) {
      for (var j = 0; j < 4; j++) {
        var noisy = mix(AG.white, AG.blue, 0.1 + 0.32 * r2(j, seed)[1]);
        box(g, x + j * 6, y, 6, 9, mix(AG.blue, noisy, t), null, 0, 0);
      }
      for (j = 1; j < 4; j++) line(g, x + j * 6, y, x + j * 6, y + 9, AG.white, 0.75);
      box(g, x, y, 24, 9, "none", t > 0.5 ? AG.blueLine : AG.blue, 1, 1.5);
    }
    /* Script ell drawn as a stroke (Hanken Grotesk has no U+2113). */
    function ell(g, cx, by, col) {
      var d = "M" + (cx - 2) + "," + (by - 1.7) + " C" + (cx - 0.2) + "," + (by - 3.1) + " " + (cx + 2.3) + "," + (by - 5.8) + " " + (cx + 1.8) + "," + (by - 7.4) +
        " C" + (cx + 1.4) + "," + (by - 8.7) + " " + (cx - 0.6) + "," + (by - 8) + " " + (cx - 0.9) + "," + (by - 6) +
        " C" + (cx - 1.3) + "," + (by - 3.6) + " " + (cx - 1.4) + "," + (by - 0.6) + " " + cx + "," + (by - 0.1) +
        " C" + (cx + 0.8) + "," + (by + 0.2) + " " + (cx + 1.6) + "," + (by - 0.3) + " " + (cx + 2.2) + "," + (by - 1);
      S("path", { d: d, fill: "none", stroke: col, "stroke-width": 0.95, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    }
    /* Italic V with a drawn hat (no combining marks, so no font fallback). */
    function vhat(g, x, y, cls, col) {
      T(g, x, y, "V", { class: cls });
      var cx = x + 4.3, top = y - 10.4;
      S("path", { d: "M" + (cx - 2.1) + "," + (top + 1.7) + " L" + cx + "," + top + " L" + (cx + 2.1) + "," + (top + 1.7), fill: "none", stroke: col, "stroke-width": 0.85, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    }
    /* 2x2 attention mask. Rows are queries, columns are keys. Cell codes
       g grey, e empty, o orange, b blue, top orange top bar only,
       x hatched (masked), xo hatched with an o_0 sliver. */
    function mask(g, ix, iy, c, labs, cells) {
      var cols = { g: AG.l3, e: AG.white, o: AG.orange, b: AG.blue, top: AG.white, x: "url(#ag-hatch)", xo: "url(#ag-hatch)" };
      cells.forEach(function (code, i) {
        var x = ix + (i % 2) * c, y = iy + Math.floor(i / 2) * c;
        box(g, x, y, c, c, cols[code], null, 0, 0);
        if (code === "top") box(g, x, y, c, Math.round(c * 0.22 * 2) / 2, AG.orange, null, 0, 0);
        if (code === "xo") box(g, x, y, Math.round(c * 0.26 * 2) / 2, c, AG.ink2, null, 0, 0);
      });
      line(g, ix + c, iy, ix + c, iy + 2 * c, AG.l3, 0.75);
      line(g, ix, iy + c, ix + 2 * c, iy + c, AG.l3, 0.75);
      box(g, ix, iy, 2 * c, 2 * c, "none", AG.faint, 0.9, 0);
      labs.forEach(function (lb, j) {
        T(g, ix + c * j + c / 2, iy - 4, lb, { class: "ag-mx", "text-anchor": "middle" });
        T(g, ix - 4, iy + c * j + c / 2 + 3.2, lb, { class: "ag-mx", "text-anchor": "end" });
      });
      T(g, ix + c, iy + 2 * c + 12, "attn mask", { class: "ag-cap", "text-anchor": "middle" });
    }

    /* ---------- Tier 1 · VLA schematics (box 324 x 156) ---------- */
    var LX = 0, RX = 154, CW = 92, LC = 46, RC = 200;
    function towers(g, left, right, n, h, step) {
      T(g, LC, 9, left, { class: "ag-lbl", "text-anchor": "middle" });
      T(g, RC, 9, right, { class: "ag-lbl ag-is-blue", "text-anchor": "middle" });
      box(g, LX, 46, CW, 78, AG.f0, AG.l3, 1, 3);
      box(g, RX, 46, CW, 78, AG.white, AG.blueLine, 1, 3);
      var ys = [];
      for (var i = 0; i < n; i++) {
        var y = 50 + i * step;
        box(g, LX + 5, y, CW - 10, h, AG.f1, AG.l3, 0.9, 1.5);
        box(g, RX + 5, y, CW - 10, h, AG.blueTint, AG.blueLine, 0.9, 1.5);
        ys.push(y + h / 2);
      }
      return ys;
    }
    function vlaIO(g, mk) {
      /* inputs: observation and language tokens, action noise tensor */
      box(g, 10, 137, 32, 15, AG.white, AG.ink2, 0.9, 2);
      T(g, 26, 148, "o_0", { class: "ag-math", "text-anchor": "middle" });
      box(g, 50, 137, 32, 15, AG.white, AG.ink2, 0.9, 2);
      ell(g, 66, 148, AG.ink);
      arrow(g, 26, 136.5, 26, 125, AG.faint, 0.9);
      arrow(g, 66, 136.5, 66, 125, AG.faint, 0.9);
      T(g, 177, 149, "z_a", { class: "ag-math ag-is-blue", "text-anchor": "end" });
      tensor(g, 182, 140, 36, 10, 4, AG.blueTint, AG.blue, AG.blueLine);
      arrow(g, RC, 139.5, RC, 125, AG.blue, 1);
      /* output action chunk */
      tensor(g, 182, 19, 36, 10, 4, AG.blue, AG.blue, AG.white);
      T(g, 223, 28, "a_{1…H}", { class: "ag-math ag-is-blue" });
      arrow(g, RC, 45.5, RC, 30, AG.blue, 1);
      flow(g, "M" + RC + ",139 V126 M" + RC + ",45 V31", AG.blue);
      mask(g, 282, 52, 20, ["VLM", "Act"], mk);
    }
    function dXattn(g) {
      var ys = towers(g, "VLM Encoder", "Action DiT", 6, 8, 12), last = ys[ys.length - 1];
      T(g, 13, 28, "H", { class: "ag-math", "text-anchor": "end" });
      tensor(g, 18, 19, 60, 10, 6, AG.f1, AG.ink2, AG.faint);
      arrow(g, LC, 45.5, LC, 30, AG.ink2, 1);
      T(g, 106, 19, "cross-attn", { class: "ag-cap ag-is-ink", "text-anchor": "middle" });
      var bus = "M78,24 H134 V" + last;
      wire(g, bus, AG.ink2, 1.1);
      ys.forEach(function (y) {
        line(g, 134, y, 156.5, y, AG.ink2, 0.9);
        S("circle", { cx: 134, cy: y, r: 1.3, fill: AG.ink2 }, g);
        box(g, 156.5, y - 2.5, 5, 5, AG.white, AG.ink2, 0.9, 0.6);
        line(g, 157.6, y - 1.1, 160.4, y + 1.1, AG.ink2, 0.7);
        line(g, 157.6, y + 1.1, 160.4, y - 1.1, AG.ink2, 0.7);
      });
      flow(g, bus, AG.ink2);
      flow(g, "M" + LC + ",45 V31", AG.ink2);
      vlaIO(g, ["g", "e", "top", "b"]);
    }
    function dKv(g) {
      var ys = towers(g, "VLM · 36 layers", "Action Expert · 36 layers", 9, 5.5, 8);
      T(g, 123, 38, "K, V shared per layer", { class: "ag-cap ag-is-warm", "text-anchor": "middle" });
      ys.forEach(function (y) {
        arrow(g, LX + CW, y, RX - 0.5, y, AG.orange, 0.9);
        flow(g, "M" + (LX + CW) + "," + y + " H" + (RX - 1), AG.orange);
      });
      vlaIO(g, ["g", "e", "o", "b"]);
    }

    /* ---------- Tier 2 · WAM schematics (box 206 x 92) ---------- */
    function seeds(g, top) {
      T(g, 14, 32, top, { class: "ag-math " + (top === "z_v" ? "ag-is-warm" : "ag-is-ink"), "text-anchor": "end" });
      T(g, 14, 68, "z_a", { class: "ag-math ag-is-blue", "text-anchor": "end" });
    }
    function dJoint(g) {
      var CX = [32, 76, 120], T3 = [1, 0.5, 0];
      seeds(g, "z_v");
      T(g, 32, 8, "t = 1", { class: "ag-cap", "text-anchor": "middle" });
      T(g, 120, 8, "t = 0", { class: "ag-cap ag-is-ink", "text-anchor": "middle" });
      arrow(g, 46, 5, 104, 5, AG.faint, 0.9);
      CX.forEach(function (cx, k) {
        latent(g, cx - 12, 16, T3[k], 3, "video");
        vector(g, cx - 12, 60, T3[k], 5);
        arrow(g, cx - 3.5, 40.5, cx - 3.5, 59.5, AG.orange, 0.9);
        arrow(g, cx + 3.5, 59.5, cx + 3.5, 40.5, AG.blue, 0.9);
        flow(g, "M" + (cx - 3.5) + ",41 V59", AG.orange);
        flow(g, "M" + (cx + 3.5) + ",59 V41", AG.blue);
        if (k < 2) {
          arrow(g, cx + 12.5, 28, cx + 31.5, 28, AG.faint, 0.9);
          arrow(g, cx + 12.5, 64.5, cx + 31.5, 64.5, AG.faint, 0.9);
        }
      });
      T(g, 76, 88, "joint attention at every step", { class: "ag-cap", "text-anchor": "middle" });
      mask(g, 172, 24, 13, ["V", "A"], ["o", "o", "o", "b"]);
    }
    function dVta(g) {
      seeds(g, "z_v");
      T(g, 54, 8, "Stage 1 · video", { class: "ag-cap", "text-anchor": "middle" });
      T(g, 127, 8, "Stage 2 · IDM", { class: "ag-cap", "text-anchor": "middle" });
      line(g, 95, 13, 95, 80, AG.faint, 0.9, "3 2.5");
      latent(g, 20, 16, 1, 3, "video");
      latent(g, 60, 16, 0.5, 3, "video");
      arrow(g, 44.5, 28, 59.5, 28, AG.faint, 0.9);
      arrow(g, 84.5, 28, 112.5, 28, AG.orange, 0.9);
      latent(g, 113, 16, 0, 3, "frozen");
      vhat(g, 141, 32, "ag-math ag-is-ink", AG.ink);
      box(g, 101, 48, 52, 31, AG.blueTint, AG.blue, 1, 2.5);
      T(g, 127, 61, "Action IDM", { class: "ag-blk", "text-anchor": "middle" });
      T(g, 127, 72.5, "z_a → a_{1…H}", { class: "ag-io", "text-anchor": "middle" });
      arrow(g, 119, 40.5, 119, 47.5, AG.orange, 0.9);
      arrow(g, 131, 40.5, 131, 47.5, AG.orange, 0.9);
      vector(g, 20, 60, 1, 5);
      line(g, 44.5, 64.5, 95, 64.5, AG.faint, 0.9, "2 2.5");
      T(g, 70, 61, "wait", { class: "ag-cap", "text-anchor": "middle" });
      arrow(g, 95, 64.5, 100.5, 64.5, AG.blue, 1);
      T(g, 95, 88, "t_v = 0 · frozen", { class: "ag-cap ag-is-ink", "text-anchor": "middle" });
      flow(g, "M45,28 H59 M85,28 H112", AG.orange);
      flow(g, "M119,41 V47 M131,41 V47", AG.orange);
      mask(g, 172, 24, 13, ["V", "A"], ["o", "e", "o", "b"]);
    }
    function dDirect(g) {
      seeds(g, "o_0");
      T(g, 32, 8, "observed", { class: "ag-cap ag-is-ink", "text-anchor": "middle" });
      T(g, 104, 8, "future rollout masked", { class: "ag-cap", "text-anchor": "middle" });
      latent(g, 20, 16, 0, 0, "obs");
      line(g, 44.5, 28, 63.5, 28, AG.l3, 0.9, "2 2");
      box(g, 50.5, 22, 8, 12, AG.white, null, 0, 0);
      line(g, 51.4, 32.5, 54.2, 23.5, AG.mute, 1);
      line(g, 54.8, 32.5, 57.6, 23.5, AG.mute, 1);
      latent(g, 64, 16, 0, 0, "ghost");
      latent(g, 108, 16, 0, 0, "ghost");
      line(g, 88.5, 28, 107.5, 28, AG.l3, 0.9, "2 2");
      T(g, 76, 31.5, "z_v", { class: "ag-math ag-is-faint", "text-anchor": "middle" });
      vhat(g, 116.4, 32, "ag-math ag-is-faint", AG.faint);
      wire(g, "M32,40.5 V55 H61.5", AG.ink2, 1, true);
      vector(g, 20, 60, 1, 5);
      arrow(g, 44.5, 64.5, 61.5, 64.5, AG.blue, 1);
      box(g, 62, 48, 90, 31, AG.blueTint, AG.blue, 1, 2.5);
      T(g, 107, 61, "Action DiT", { class: "ag-blk", "text-anchor": "middle" });
      T(g, 107, 72.5, "z_a → a_{1…H}", { class: "ag-io", "text-anchor": "middle" });
      T(g, 86, 88, "reads o_0 only, like a VLA", { class: "ag-cap", "text-anchor": "middle" });
      flow(g, "M32,41 V55 H61", AG.ink2);
      flow(g, "M45,64.5 H61", AG.blue);
      mask(g, 172, 24, 13, ["V", "A"], ["x", "x", "xo", "b"]);
    }
    var DRAW = { xattn: dXattn, kv: dKv, joint: dJoint, vta: dVta, direct: dDirect };
    var BOX = { 1: [324, 156], 2: [206, 92] };

    /* ---------- panel shell: subfigure index, title, schematic, variance bar ---------- */
    function card(parent, r, x, y, w, cap) {
      var bw = BOX[r.tier][0], bh = BOX[r.tier][1];
      var s = Math.min(cap, (w - 22) / bw);
      /* WAM panels in the 3-up row are too narrow for one subtitle line */
      var two = r.tier === 2 && w < 300, sub = r.model.split(" · ");
      var dTop = two ? 63 : 50, barY = Math.round(dTop + bh * s + 14), h = barY + 30;
      var g = S("g", { class: "ag-card", "data-key": r.key, transform: "translate(" + fx(x, 2) + "," + y + ")", tabindex: 0, role: "button",
        "aria-label": "Panel " + r.idx + ". " + r.name + ". " + r.note.replace(/_/g, "") }, parent);
      S("rect", { x: 0.5, y: 0.5, width: fx(w - 1, 2), height: h - 1, rx: 3, fill: AG.white, stroke: AG.l2, "stroke-width": 1, class: "ag-bg" }, g);
      T(g, 13, 22, r.idx, { class: "ag-idx" });
      T(g, 27, 22, r.name, { class: "ag-title" });
      if (two) {
        T(g, 27, 37, sub[0], { class: "ag-model" });
        T(g, 27, 50, sub[1], { class: "ag-model ag-is-faint" });
      } else {
        T(g, 27, 37, r.model, { class: "ag-model" });
      }
      var dg = S("g", { transform: "translate(" + fx((w - bw * s) / 2, 2) + "," + dTop + ")" + (s !== 1 ? " scale(" + fx(s, 4) + ")" : "") }, g);
      DRAW[r.key](dg);
      /* share of 32-step chunk variance carried by each noise source */
      var bx = 13, bwid = w - 26, zv = r.share ? r.share.shareCh : 0, wv = bwid * zv / 100;
      if (zv > 0) {
        box(g, bx, barY, fx(wv - 1, 2), 4, AG.orange, null, 0, 1);
        box(g, fx(bx + wv + 1, 2), barY, fx(bwid - wv - 1, 2), 4, AG.blue, null, 0, 1);
      } else {
        box(g, bx, barY, fx(bwid, 2), 4, AG.blue, null, 0, 1);
      }
      var ly = barY + 18;
      if (!r.share) {
        T(g, bx, ly, "100% z_a", { class: "ag-val ag-is-blue" });
        T(g, w - 13, ly, t(r.tag, r.tagZh), { class: "ag-tag", "text-anchor": "end" });
      } else {
        T(g, bx, ly, fx(zv, 1) + "% z_v", { class: "ag-val " + (zv > 0 ? "ag-is-warm" : "ag-is-faint") });
        T(g, w - 13, ly, (zv > 0 ? fx(100 - zv, 1) : "100") + "% z_a", { class: "ag-val ag-is-blue", "text-anchor": "end" });
      }
      g.addEventListener("mouseenter", function () { focusKey = r.key; applyFocus(); });
      g.addEventListener("mouseleave", function () { focusKey = null; applyFocus(); });
      g.addEventListener("focus", function () { focusKey = r.key; applyFocus(); });
      g.addEventListener("blur", function () { focusKey = null; applyFocus(); });
      function toggle() { locked = locked === r.key ? null : r.key; applyFocus(); }
      g.addEventListener("click", toggle);
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      return h;
    }
    function tierHead(parent, y, Wd, sw, title, sub, stacked) {
      sw.forEach(function (col, j) { box(parent, j * 10, y + 3, 7, 7, col, null, 0, 1); });
      T(parent, sw.length * 10 + 4, y + 10, title, { class: "ag-tier" });
      if (stacked) T(parent, 0, y + 27, sub, { class: "ag-tier-sub" });
      else T(parent, Wd, y + 10, sub, { class: "ag-tier-sub", "text-anchor": "end" });
    }
    /* Editorial coupling axis over the WAM tier, one tick per panel. */
    function axis(parent, y, Wd, ticks, letters) {
      T(parent, 0, y + 9, t("Tighter video-action coupling", "视频与动作耦合更紧"), { class: "ag-axis ag-is-warm" });
      T(parent, Wd, y + 9, t("No future rollout", "无未来视频生成"), { class: "ag-axis", "text-anchor": "end" });
      line(parent, 0, y + 16.5, Wd, y + 16.5, "url(#ag-couple)", 1);
      ticks.forEach(function (tx, j) {
        line(parent, fx(tx, 2), y + 13, fx(tx, 2), y + 20, mix(AG.orange, AG.faint, j / 2), 1.1);
        if (letters) T(parent, fx(tx, 2), y + 31, ["c", "d", "e"][j], { class: "ag-mx", "text-anchor": "middle" });
      });
    }

    function build() {
      var cw = host.clientWidth || 720;
      var isNarrow = cw < 600;
      narrow = isNarrow;
      motion = !reduced();
      host.innerHTML = "";
      var Wd = isNarrow ? Math.max(300, Math.round(cw)) : 720, gap = isNarrow ? 14 : 16;
      svg = S("svg", { viewBox: "0 0 " + Wd + " 100", width: Wd, height: 100, role: "group", class: "arch-svg" + (isNarrow ? " is-narrow" : ""),
        "aria-label": "Figure 2. Five conditioning paradigms drawn as block schematics with their attention masks. Use Tab to focus a panel." }, host);
      var defs = S("defs", null, svg);
      [["k", AG.ink2], ["m", AG.faint], ["b", AG.blue], ["o", AG.orange]].forEach(function (m) {
        var mk = S("marker", { id: "ag-ar-" + m[0], viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, markerUnits: "userSpaceOnUse", orient: "auto" }, defs);
        S("path", { d: "M0,1 L10,5 L0,9 z", fill: m[1] }, mk);
      });
      var lg = S("linearGradient", { id: "ag-couple", gradientUnits: "userSpaceOnUse", x1: 0, x2: Wd, y1: 0, y2: 0 }, defs);
      S("stop", { offset: 0, "stop-color": AG.orange }, lg);
      S("stop", { offset: 1, "stop-color": AG.l3 }, lg);
      var pat = S("pattern", { id: "ag-hatch", patternUnits: "userSpaceOnUse", width: 3, height: 3, patternTransform: "rotate(45)" }, defs);
      box(pat, 0, 0, 3, 3, AG.f0, null, 0, 0);
      line(pat, 0, 0, 0, 3, AG.l3, 1);

      var y = 0, vla = cards.slice(0, 2), wam = cards.slice(2);
      tierHead(svg, y, Wd, [AG.blue], t("VISION-LANGUAGE-ACTION MODELS", "视觉-语言-动作模型 (VLA)"), t("one noise source z_a", "单一噪声源 z_a"), isNarrow);
      y += isNarrow ? 40 : 24;
      if (isNarrow) {
        vla.forEach(function (r) { y += card(svg, r, 0, y, Wd, 1) + gap; });
      } else {
        var w1 = (Wd - gap) / 2, h1 = 0;
        vla.forEach(function (r, i) { h1 = card(svg, r, i * (w1 + gap), y, w1, 1); });
        y += h1 + gap;
      }
      y += isNarrow ? 10 : 14;
      tierHead(svg, y, Wd, [AG.orange, AG.blue], t("WORLD ACTION MODELS · OPENWAM 5B", "世界动作模型 · OPENWAM 5B"), t("two noise sources z_v + z_a", "双噪声源 z_v + z_a"), isNarrow);
      y += isNarrow ? 40 : 22;
      if (isNarrow) {
        axis(svg, y, Wd, [Wd / 6, Wd / 2, Wd * 5 / 6], true);
        y += 42;
        wam.forEach(function (r) { y += card(svg, r, 0, y, Wd, 1.3) + gap; });
        y -= gap;
      } else {
        var w2 = (Wd - 2 * gap) / 3, h2 = 0;
        axis(svg, y, Wd, [0, 1, 2].map(function (j) { return j * (w2 + gap) + w2 / 2; }), false);
        y += 30;
        wam.forEach(function (r, i) { h2 = card(svg, r, i * (w2 + gap), y, w2, 1); });
        y += h2;
      }
      var Ht = Math.ceil(y + 2);
      svg.setAttribute("viewBox", "0 0 " + Wd + " " + Ht);
      svg.setAttribute("height", Ht);
      applyFocus();
    }

    build();
    var lastW = host.clientWidth;
    window.addEventListener("resize", function () {
      var cw = host.clientWidth;
      if (cw === lastW) return;
      lastW = cw;
      var nn = cw < 600;
      if (nn !== narrow || nn) build();
    });
    if (mqReduce.addEventListener) mqReduce.addEventListener("change", build);
    onLang(build);
    onVisible(root, function (v) { root.classList.toggle("is-paused", !v); });
  }

  /* ================================================================
     FIGURE 4 · conditioning relaxation explorer (alpha sweep)
     ================================================================ */
  function initAlpha() {
    var root = document.getElementById("alpha-widget");
    if (!root || !D) return;
    var A = D.alpha;
    var models = ["gr00t", "xiaomi"];
    var metric = "ch";
    var idx = 0;
    var pos = { gr00t: 0, xiaomi: 0 };
    var slider = $(".alpha-slider input", root);
    var outA = $(".alpha-slider output", root);
    var sweepBtn = $('[data-act="sweep"]', root);
    var panels = {};
    models.forEach(function (m) {
      var el = $('.alpha-panel[data-model="' + m + '"]', root);
      panels[m] = { el: el, read: $(".ap-read", el) };
      panels[m].cv = new HiCanvas($("canvas", el), function () { drawAll(); });
    });
    var LABEL = {
      ch: function () { return t("reach error · chunk", "可达误差 · 整段"); },
      s0: function () { return t("reach error · step 0", "可达误差 · 第一步"); },
      dm: function () { return t("distance D_M", "马氏距离 D_M"); }
    };

    function norm(m, c) {
      if (metric === "ch") return c.ch / A[m].natCh;
      if (metric === "s0") return c.s0 / A[m].natS0;
      return c.dm;
    }
    function raw(c) { return metric === "dm" ? c.dm : c[metric]; }
    function rawFmt(v) { return metric === "dm" ? fx(v, 1) : fx(v, 3); }
    function yDomain() {
      var lo = Infinity, hi = -Infinity;
      models.forEach(function (m) {
        var a = A[m];
        a.stops.concat([a.zero, a.wrong]).forEach(function (c) { var v = norm(m, c); lo = Math.min(lo, v); hi = Math.max(hi, v); });
      });
      return [Math.log10(lo) - 0.12, Math.log10(hi) + 0.1];
    }
    var TICKS = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

    function drawPanel(m) {
      var p = panels[m], cv = p.cv, ctx = cv.ctx, w = cv.w, h = cv.h;
      if (w < 10) return;
      cv.clear();
      var a = A[m];
      var padL = 40, padR = 14, padT = 14, padB = 36;
      var x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
      var dom = yDomain();
      function X(i) { return x0 + (i / 4) * (x1 - x0); }
      function Y(v) { return y1 - (Math.log10(v) - dom[0]) / (dom[1] - dom[0]) * (y1 - y0); }
      var zeroV = norm(m, a.zero), wrongV = norm(m, a.wrong);

      // region worse than "no VLM"
      ctx.fillStyle = "rgba(253,240,230,0.75)";
      ctx.fillRect(x0, y0, x1 - x0, Math.max(0, Y(zeroV) - y0));
      // label the region only where it clears the curve and the wrong-scene line
      ctx.font = font(10.5, 600);
      var regLab = t("worse than no VLM", "弱于去掉 VLM"), regW = ctx.measureText(regLab).width;
      var cps = a.stops.map(function (st, i) { return [X(i), Y(norm(m, st))]; });
      var curveYAt = function (x) {
        for (var k = 0; k < 4; k++) if (x >= cps[k][0] && x <= cps[k + 1][0]) {
          return lerp(cps[k][1], cps[k + 1][1], (x - cps[k][0]) / (cps[k + 1][0] - cps[k][0]));
        }
        return cps[4][1];
      };
      var clearAt = function (ly) {
        for (var xx = x0 + 4; xx <= x0 + 10 + regW; xx += 4) { var cy = curveYAt(xx); if (cy > ly - 15 && cy < ly + 7) return false; }
        return Math.abs(Y(wrongV) - (ly - 4)) > 11 && ly > y0 + 8;
      };
      var cands = [Y(zeroV) - 6, y0 + 13, (y0 + Y(zeroV)) / 2 + 4];
      for (var ci = 0; ci < cands.length; ci++) {
        if (clearAt(cands[ci])) { ctx.fillStyle = C.orange; ctx.textAlign = "left"; ctx.fillText(regLab, x0 + 6, cands[ci]); break; }
      }

      // grid
      ctx.font = font(10.5, 400); ctx.textAlign = "right"; ctx.fillStyle = C.muted;
      TICKS.forEach(function (t) {
        var lt = Math.log10(t); if (lt < dom[0] || lt > dom[1]) return;
        var yy = Math.round(Y(t)) + 0.5;
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
        ctx.fillText(String(t), x0 - 6, yy + 3.5);
      });
      ctx.strokeStyle = C.rule; ctx.beginPath(); ctx.moveTo(x0, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();
      ctx.textAlign = "center"; ctx.fillStyle = C.muted; ctx.font = font(10.5, 400);
      a.stops.forEach(function (st, i) {
        ctx.fillStyle = i === idx ? C.ink : C.muted;
        ctx.font = font(10.5, i === idx ? 700 : 400);
        ctx.fillText(fx(st.alpha, 2), X(i), y1 + 15);
      });
      ctx.font = font(10, 500); ctx.fillStyle = C.light;
      ctx.textAlign = "left"; ctx.fillText(t("full VLM", "完整 VLM"), x0 - 4, y1 + 29);
      ctx.textAlign = "right"; ctx.fillText(t("neutral mean", "中性均值"), x1 + 4, y1 + 29);

      // reference lines
      function ref(v, col, label, above) {
        var yy = Y(v);
        ctx.save(); ctx.setLineDash([5, 3]); ctx.strokeStyle = col; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); ctx.restore();
        ctx.fillStyle = col; ctx.font = font(10.5, 600); ctx.textAlign = "right";
        ctx.fillText(label, x1 - 2, above ? yy - 5 : yy + 13);
      }
      ref(zeroV, C.blue, t("no VLM ", "无 VLM ") + rawFmt(raw(a.zero)), false);
      ref(wrongV, C.orange, t("wrong scene ", "错误场景 ") + rawFmt(raw(a.wrong)), true);

      // alpha curve
      var pts = a.stops.map(function (st, i) { return [X(i), Y(norm(m, st))]; });
      ctx.strokeStyle = C.ink2; ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.beginPath(); pts.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
      pts.forEach(function (q, i) {
        ctx.fillStyle = C.white; ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(q[0], q[1], i === 0 ? 4 : 3.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });

      // moving marker (interpolates along the drawn polyline between measured stops)
      var f = clamp(pos[m], 0, 4), i0 = Math.min(3, Math.floor(f)), fr = f - i0;
      var mx = lerp(pts[i0][0], pts[i0 + 1][0], fr), my = lerp(pts[i0][1], pts[i0 + 1][1], fr);
      var cur = a.stops[idx], v = norm(m, cur);
      var col = v <= zeroV ? C.blue : C.orange;
      ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = C.light; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, my + 8); ctx.lineTo(mx, y1); ctx.stroke(); ctx.restore();
      ctx.fillStyle = col === C.blue ? "rgba(26,115,232,0.16)" : "rgba(217,107,39,0.18)";
      ctx.beginPath(); ctx.arc(mx, my, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.strokeStyle = C.white; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (Math.abs(f - idx) < 0.02) {
        ctx.font = font(12, 700); ctx.fillStyle = col;
        var lab = rawFmt(raw(cur));
        if (idx >= 3) { ctx.textAlign = "right"; haloText(ctx, lab, mx - 13, my + 16); }
        else { ctx.textAlign = "center"; haloText(ctx, lab, mx, my - 15 < y0 + 10 ? my + 25 : my - 15); }
      }
    }

    function readout(m) {
      var a = A[m], cur = a.stops[idx], full = a.stops[0];
      var r = panels[m].read;
      var v = raw(cur), v0 = raw(full), ratio = v / v0;
      var worse = norm(m, cur) > norm(m, a.zero);
      var cls = idx === 0 ? "" : (ratio < 1 ? "is-blue" : "is-orange");
      var lab = LABEL[metric]().replace("D_M", "D<sub>M</sub>");
      r.innerHTML =
        '<div class="ap-big"><span class="ap-num ' + (worse ? "is-orange" : "is-blue") + '">' + rawFmt(v) + '</span>' +
        '<span class="ap-unit">' + lab + '</span>' +
        (idx === 0 ? '<span class="ap-delta">' + t("full-policy baseline", "完整策略基线") + '</span>' : '<span class="ap-delta ' + cls + '">×' + fx(ratio, 2) + t(" vs. full", " 对比完整策略") + "</span>") + "</div>" +
        '<p class="ap-small">' + t("width ", "宽度 ") + fx(cur.width, 2) + " · " + t("reach ", "误差 ") + fx(cur.ch, 3) + " / " + fx(cur.s0, 3) + " · D<sub>M</sub> " + fx(cur.dm, 1) + " · R²@8 " + fx(cur.r2, 3) + "</p>";
    }

    function drawAll() { models.forEach(drawPanel); }
    function updateText() {
      models.forEach(readout);
      if (outA) outA.textContent = "α = " + fx(A.gr00t.stops[idx].alpha, 2);
      if (slider) { slider.value = String(idx); slider.setAttribute("aria-valuetext", "alpha " + fx(A.gr00t.stops[idx].alpha, 2)); }
    }

    var anim = null;
    function goTo(i, instant) {
      idx = i; updateText();
      if (instant || reduced()) { models.forEach(function (m) { pos[m] = i; }); drawAll(); return; }
      var from = pos.gr00t, t0 = now(), dur = 380 * Math.max(1, Math.abs(i - from)) ** 0.5;
      var token = {}; anim = token;
      (function step() {
        if (anim !== token) return;
        var k = clamp((now() - t0) / dur, 0, 1), e = easeInOut(k);
        models.forEach(function (m) { pos[m] = lerp(from, i, e); });
        drawAll();
        if (k < 1) raf(step);
      })();
    }

    if (slider) slider.addEventListener("input", function () { stopSweep(); goTo(Number(slider.value)); });
    pillGroup($(".pills", root), "data-metric", function (v) { metric = v; updateText(); drawAll(); });

    var sweepTimer = null;
    function stopSweep() { if (sweepTimer) { clearTimeout(sweepTimer); sweepTimer = null; } if (sweepBtn) sweepBtn.textContent = t("Sweep α", "扫描 α"); }
    if (sweepBtn) sweepBtn.addEventListener("click", function () {
      if (sweepTimer) { stopSweep(); return; }
      sweepBtn.textContent = t("Stop", "停止");
      goTo(0, true);
      var i = 0;
      (function next() {
        i += 1;
        if (i > 4) { stopSweep(); return; }
        sweepTimer = setTimeout(function () { goTo(i); next(); }, reduced() ? 600 : 1100);
      })();
    });

    updateText(); drawAll();
    onLang(function () { if (sweepBtn) sweepBtn.textContent = sweepTimer ? t("Stop", "停止") : t("Sweep α", "扫描 α"); updateText(); drawAll(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);
  }

  /* ================================================================
     FIGURE 6 · dual-noise WAM trajectory playground
     ================================================================ */
  function initWam() {
    var root = document.getElementById("wam-widget");
    if (!root || !D) return;
    var WD = D.wam;
    var keys = ["mutual", "idm", "isolated"];
    var NTRAJ = 12, NSTEP = 32;
    var mode = "zv";
    var auto = !reduced();
    var seed = 3;
    var prog = reduced() ? 1 : 0, fade = 1;
    var phase = "grow", phaseT = 0, last = 0, visible = true, looping = false;
    var T_GROW = 1.7, T_HOLD = 3.0, T_FADE = 0.35;
    var ORDER = ["zv", "za", "joint"];
    var autoBtn = $('[data-act="auto"]', root);
    var resBtn = $('[data-act="resample"]', root);
    var panels = {};
    keys.forEach(function (k) {
      var el = $('.wam-panel[data-v="' + k + '"]', root);
      panels[k] = { el: el, read: $(".wp-read", el) };
      panels[k].cv = new HiCanvas($("canvas", el), function () { drawAll(); });
    });

    // path shapes (normalised to unit RMS over the chunk)
    var TAU = []; for (var k = 0; k < NSTEP; k++) TAU.push(k / (NSTEP - 1));
    // Both channels move the whole plan (the data measure variance shares, not path texture);
    // action noise adds a mild execution wiggle on top.
    function env(t) { return Math.min(1, t * 6); }
    function phiV(t, xi) { return xi[0] * Math.sin(Math.PI * 0.8 * t) + 0.6 * xi[1] * Math.sin(2 * Math.PI * t); }
    function phiA(t, d) {
      return 0.85 * d.low * Math.sin(Math.PI * t) + 0.5 * d.amp[0] * Math.sin(1.5 * Math.PI * t + d.ph[0] * 0.25) * env(t)
        + 0.28 * d.amp[1] * Math.sin(6 * Math.PI * t + d.ph[1]) * env(t);
    }
    var rmsV = Math.sqrt(TAU.reduce(function (acc, t) { var a = Math.sin(Math.PI * 0.8 * t), b = 0.6 * Math.sin(2 * Math.PI * t); return acc + a * a + b * b; }, 0) / NSTEP);
    var rmsA = Math.sqrt(TAU.reduce(function (acc, t) {
      var e = env(t);
      return acc + 0.7225 * Math.pow(Math.sin(Math.PI * t), 2) + (0.25 + 0.0784) * e * e * 0.5;
    }, 0) / NSTEP);

    var draws = null;
    function makeDraws() {
      var rng = mulberry32(seed * 7919 + 13);
      function g2() { return clamp(gauss(rng), -2.2, 2.2); }
      function one() {
        return {
          v: [g2(), g2()],
          a: { low: g2(), amp: [g2(), g2()], ph: [rng() * 6.283, rng() * 6.283] },
          v0: [g2(), g2()], a0: [g2(), g2()],
          lag: rng() * 0.18
        };
      }
      var fixed = one();
      // keep the frozen channel's single draw moderate so it does not dominate the picture
      function tame(x) { return clamp(x, -0.6, 0.6); }
      fixed.v = fixed.v.map(tame); fixed.a.low = tame(fixed.a.low); fixed.a.amp = fixed.a.amp.map(tame);
      fixed.v0 = fixed.v0.map(tame); fixed.a0 = fixed.a0.map(tame);
      var list = []; for (var i = 0; i < NTRAJ; i++) list.push(one());
      draws = { fixed: fixed, list: list };
    }

    var maxJoint = Math.max.apply(null, keys.map(function (k) { return Math.hypot(WD[k].zvStd, WD[k].zaStd); }));
    var max0 = Math.max.apply(null, keys.map(function (k) { return Math.hypot(WD[k].zvStd0, WD[k].zaStd0); }));
    var MODECOL = { zv: C.orange, za: C.blue, joint: C.ink2 };

    function geom(w, h) {
      var S0 = [w * 0.08, h * 0.68], G = [w * 0.9, h * 0.34];
      var C1 = [w * 0.3, h * 0.33], C2 = [w * 0.6, h * 0.25];
      return { S: S0, G: G, C1: C1, C2: C2, L: [w * 0.75, h * 0.72], Lr: Math.min(h * 0.185, w * 0.15), h: h };
    }
    function bez(g, t) {
      var u = 1 - t;
      var x = u * u * u * g.S[0] + 3 * u * u * t * g.C1[0] + 3 * u * t * t * g.C2[0] + t * t * t * g.G[0];
      var y = u * u * u * g.S[1] + 3 * u * u * t * g.C1[1] + 3 * u * t * t * g.C2[1] + t * t * t * g.G[1];
      var dx = 3 * u * u * (g.C1[0] - g.S[0]) + 6 * u * t * (g.C2[0] - g.C1[0]) + 3 * t * t * (g.G[0] - g.C2[0]);
      var dy = 3 * u * u * (g.C1[1] - g.S[1]) + 6 * u * t * (g.C2[1] - g.C1[1]) + 3 * t * t * (g.G[1] - g.C2[1]);
      var l = Math.hypot(dx, dy) || 1;
      return { p: [x, y], n: [-dy / l, dx / l] };
    }

    function traj(key, d, g, kpx) {
      var st = WD[key];
      var useV = (mode === "zv" || mode === "joint") ? d : draws.fixed;
      var useA = (mode === "za" || mode === "joint") ? d : draws.fixed;
      var sv = st.zvStd * kpx / rmsV, sa = st.zaStd * kpx / rmsA;
      return TAU.map(function (t) {
        var b = bez(g, t);
        var off = sv * phiV(t, useV.v) + sa * phiA(t, useA.a);
        return [b.p[0] + b.n[0] * off, clamp(b.p[1] + b.n[1] * off, 8, g.h - 8)];
      });
    }
    function step0(key, d, M) {
      var st = WD[key];
      var useV = (mode === "zv" || mode === "joint") ? d : draws.fixed;
      var useA = (mode === "za" || mode === "joint") ? d : draws.fixed;
      return [M * (st.zvStd0 * useV.v0[0] + st.zaStd0 * useA.a0[0]), M * (st.zvStd0 * useV.v0[1] + st.zaStd0 * useA.a0[1])];
    }

    function drawPanel(key) {
      var p = panels[key], cv = p.cv, ctx = cv.ctx, w = cv.w, h = cv.h;
      if (w < 10) return;
      cv.clear();
      var g = geom(w, h);
      var kpx = 0.1 * h / maxJoint;
      var col = MODECOL[mode];
      var st = WD[key];
      var nothing = mode === "zv" && st.zvStd === 0;

      // reference: mean plan
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = C.rule; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var i = 0; i <= 40; i++) { var b = bez(g, i / 40).p; if (i) ctx.lineTo(b[0], b[1]); else ctx.moveTo(b[0], b[1]); }
      ctx.stroke(); ctx.restore();

      // goal
      ctx.save(); ctx.strokeStyle = C.light; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(g.G[0], g.G[1], 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.font = font(10.5, 500); ctx.textAlign = "center";
      haloText(ctx, t("goal", "目标"), g.G[0], g.G[1] + 22);
      ctx.restore();

      // trajectories
      ctx.save(); ctx.globalAlpha = fade;
      var heads = [];
      draws.list.forEach(function (d, ti) {
        var P = traj(key, d, g, kpx);
        var lp = clamp((prog - d.lag * (prog < 1 ? 1 : 0)) / (1 - d.lag * (prog < 1 ? 1 : 0)), 0, 1);
        var fi = lp * (NSTEP - 1), i0 = Math.floor(fi), fr = fi - i0;
        ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.globalAlpha = fade * (nothing ? 0.9 : 0.55);
        ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
        for (var j = 1; j <= i0; j++) ctx.lineTo(P[j][0], P[j][1]);
        var hp = i0 < NSTEP - 1 ? [lerp(P[i0][0], P[i0 + 1][0], fr), lerp(P[i0][1], P[i0 + 1][1], fr)] : P[NSTEP - 1];
        ctx.lineTo(hp[0], hp[1]); ctx.stroke();
        heads.push(hp);
        if (ti === 0 && lp >= 1) {
          // show the 32 control steps on one trajectory
          ctx.globalAlpha = fade * 0.75; ctx.fillStyle = col;
          for (var q = 0; q < NSTEP; q++) { ctx.beginPath(); ctx.arc(P[q][0], P[q][1], 1.1, 0, Math.PI * 2); ctx.fill(); }
        }
      });
      ctx.globalAlpha = fade; ctx.fillStyle = col;
      heads.forEach(function (hp) { ctx.beginPath(); ctx.arc(hp[0], hp[1], prog < 1 ? 2.6 : 2.1, 0, Math.PI * 2); ctx.fill(); });
      ctx.restore();

      if (nothing) {
        ctx.save(); ctx.fillStyle = C.muted; ctx.font = font(11, 600); ctx.textAlign = "center";
        ctx.fillText(t("no video noise to sweep", "无视频噪声可扫动"), w * 0.5, h * 0.12 + 4);
        ctx.restore();
      }

      // start
      ctx.save();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(g.S[0], g.S[1], 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.muted; ctx.font = font(10.5, 500); ctx.textAlign = "left";
      ctx.fillText(t("start", "起点"), g.S[0] - 4, g.S[1] + 17);
      ctx.restore();

      // step-0 loupe
      var L = g.L, r = g.Lr;
      var M = 0.36 * r / max0;
      ctx.save();
      ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
      var ang = Math.atan2(L[1] - g.S[1], L[0] - g.S[0]);
      var nx = -Math.sin(ang), ny = Math.cos(ang);
      ctx.beginPath();
      ctx.moveTo(g.S[0] + nx * 8, g.S[1] + ny * 8); ctx.lineTo(L[0] + nx * r, L[1] + ny * r);
      ctx.moveTo(g.S[0] - nx * 8, g.S[1] - ny * 8); ctx.lineTo(L[0] - nx * r, L[1] - ny * r);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(g.S[0], g.S[1], 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = C.white; ctx.strokeStyle = C.light; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(L[0], L[1], r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.arc(L[0], L[1], r - 1, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L[0] - r, L[1]); ctx.lineTo(L[0] + r, L[1]); ctx.moveTo(L[0], L[1] - r); ctx.lineTo(L[0], L[1] + r); ctx.stroke();
      // 1-sd rings of each channel (measured step-0 Std)
      if (st.zvStd0 > 0) dashedEllipse(ctx, L[0], L[1], M * st.zvStd0 * 1.4, M * st.zvStd0 * 1.4, 0, C.orangeMid, null, [3, 2], 1.2);
      dashedEllipse(ctx, L[0], L[1], M * st.zaStd0 * 1.4, M * st.zaStd0 * 1.4, 0, C.blueMid, null, [3, 2], 1.2);
      var shown = Math.min(1, prog * 3);
      ctx.globalAlpha = fade * shown; ctx.fillStyle = col;
      draws.list.forEach(function (d) {
        var o = step0(key, d, M);
        ctx.beginPath(); ctx.arc(L[0] + o[0], L[1] + o[1], 2.4, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
      ctx.fillStyle = C.muted; ctx.font = font(10, 600); ctx.textAlign = "center";
      ctx.fillText(t("first step, zoomed", "第一步放大"), L[0], L[1] + r + 13);
      ctx.restore();
    }

    function drawAll() { keys.forEach(drawPanel); }

    function readouts() {
      keys.forEach(function (k) {
        var st = WD[k], r = panels[k].read;
        var zv = st.shareCh, z0 = st.shareS0;
        var sd = mode === "zv" ? st.zvStd : mode === "za" ? st.zaStd : st.jointStd;
        var sweepLbl = mode === "zv" ? t("z<sub>v</sub> only", "仅 z<sub>v</sub>") : mode === "za" ? t("z<sub>a</sub> only", "仅 z<sub>a</sub>") : t("both", "双通道");
        r.className = "wp-read mode-" + mode;
        r.innerHTML =
          '<div class="split" aria-hidden="true"><span class="sv" style="width:' + zv + '%"></span><span class="sa" style="width:' + (100 - zv) + '%"></span></div>' +
          '<p class="split-lbl"><b class="o">' + fx(zv, 1) + "% z<sub>v</sub></b> · <b class=\"b\">" + fx(100 - zv, 1) + "% z<sub>a</sub></b> <span>" + t("chunk", "整段") + "</span></p>" +
          '<div class="split thin" aria-hidden="true"><span class="sv" style="width:' + z0 + '%"></span><span class="sa" style="width:' + (100 - z0) + '%"></span></div>' +
          '<p class="split-lbl"><b class="o">' + fx(z0, 1) + "% z<sub>v</sub></b> · <b class=\"b\">" + fx(100 - z0, 1) + "% z<sub>a</sub></b> <span>" + t("first step", "第一步") + "</span></p>" +
          '<p class="wp-std">' + t("Std sweeping ", "扫动 ") + sweepLbl + t(" · ", " 标准差 · ") + "<b>" + (sd ? fx(sd, 3) : "0") + "</b></p>";
      });
    }

    function restart() { phase = "grow"; phaseT = 0; prog = reduced() ? 1 : 0; fade = 1; readouts(); drawAll(); kick(); }

    function loop(ts) {
      if (!visible || (!auto && phase === "hold")) { looping = false; return; }
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts;
      phaseT += dt;
      if (phase === "grow") {
        prog = reduced() ? 1 : easeOut(clamp(phaseT / T_GROW, 0, 1));
        if (phaseT >= T_GROW) { phase = "hold"; phaseT = 0; prog = 1; }
      } else if (phase === "hold") {
        if (phaseT >= T_HOLD) { phase = "fade"; phaseT = 0; }
      } else if (phase === "fade") {
        fade = 1 - clamp(phaseT / T_FADE, 0, 1);
        if (phaseT >= T_FADE) {
          mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
          setMode(mode);
          phase = "grow"; phaseT = 0; prog = 0; fade = 1; readouts();
        }
      }
      drawAll();
      raf(loop);
    }
    function kick() { if (!looping && visible) { looping = true; last = 0; raf(loop); } }

    var setMode = pillGroup($(".pills", root), "data-mode", function (v) {
      mode = v; auto = false; syncAuto(); restart();
    });
    function syncAuto() {
      if (!autoBtn) return;
      autoBtn.classList.toggle("is-on", auto);
      autoBtn.setAttribute("aria-pressed", auto ? "true" : "false");
    }
    if (autoBtn) autoBtn.addEventListener("click", function () { auto = !auto; syncAuto(); if (auto) { phase = "hold"; phaseT = T_HOLD; } kick(); });
    if (resBtn) resBtn.addEventListener("click", function () { seed += 1; makeDraws(); restart(); });
    onVisible(root, function (v) { visible = v; if (v) kick(); });

    function syncWamBtns() {
      if (resBtn) resBtn.textContent = t("Resample", "重采样");
      if (autoBtn) autoBtn.textContent = t("Auto", "自动");
    }
    makeDraws(); setMode(mode); syncAuto(); syncWamBtns(); readouts(); drawAll(); kick();
    onLang(function () { syncWamBtns(); readouts(); drawAll(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);
  }

  /* ================================================================
     TOC highlight + reading progress
     ================================================================ */
  function initChrome() {
    var sections = $$(".ar-main section[id]");
    var links = {};
    $$("#toc-list a").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    var bar = document.getElementById("progress-bar");
    var ticking = false;
    function update() {
      ticking = false;
      var y = window.scrollY + window.innerHeight * 0.28;
      var current = sections[0];
      sections.forEach(function (s) { if (s.offsetTop <= y) current = s; });
      Object.keys(links).forEach(function (k) { links[k].classList.toggle("active", !!current && k === current.id); });
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.width = (h > 0 ? Math.min(100, window.scrollY / h * 100) : 0) + "%";
    }
    function onScroll() { if (!ticking) { ticking = true; raf(update); } }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.error(e); } }
  function boot() {
    document.documentElement.classList.add("js");
    safe(initLang);
    safe(initChrome);
    safe(initHero);
    safe(initSwaps);
    safe(initArch);
    safe(initAlpha);
    safe(initWam);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
