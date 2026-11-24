// Interactive 5-policy cumulative execution engine speedup cascade (Paper Table 4).
// Supports both the reading article and cloned presentation slides.
(() => {
  "use strict";

  const STAGES = [
    { key: "oneflow", short: "OneFlow 并行", full: "OneFlow（单次批量前向）" },
    { key: "cuda", short: "+ CUDA 图", full: "+ CUDA Graphs（消除内核发射开销）" },
    { key: "precomp", short: "+ 不变量预计算", full: "+ 不变量预计算（位置编码与网格权重）" },
    { key: "io", short: "+ I/O 优化", full: "+ 零拷贝 I/O 与持久化缓冲区" },
    { key: "fusion", short: "+ 算子融合", full: "+ 融合去噪与重建算子" },
    { key: "autotune", short: "+ 内核调优", full: "+ 内核自动调优（OneFlow+）" }
  ];

  // Frozen A100 warm medians (ms) from Paper Table 4 (hardware_ablation.tex).
  // Index 0 is Native; indices 1..6 correspond to STAGES.
  const POLICIES = [
    { name: "FM 策略（RGB）", meta: "N = 8 · RoboMimic", lat: [25.0488, 12.1698, 3.6637, 3.6103, 2.0231, 1.2244, 0.9896] },
    { name: "Xiaomi Robotics 0", meta: "N = 5 · SimplerEnv", lat: [131.1191, 69.8042, 28.9064, 28.9374, 24.8864, 13.2274, 12.6839] },
    { name: "GR00T N1.7", meta: "N = 4 · SimplerEnv", lat: [111.7282, 57.9495, 20.6344, 19.9068, 16.8046, 10.1200, 9.7692] },
    { name: "OpenWAM", meta: "N = 10 · RoboTwin 2.0", lat: [447.0769, 110.6241, 74.8252, 50.1436, 38.5968, 19.6163, 19.3971] },
    { name: "Fast-WAM", meta: "N = 10 · RoboTwin 2.0", lat: [503.5291, 103.2031, 52.1490, 42.2517, 34.8397, 16.8103, 16.6204] }
  ];

  const S = STAGES.length;
  const MOVE = 0.56, HOLD = 0.28, LEAD = 0.3;
  const STEP = MOVE + HOLD, TOTAL = LEAD + S * STEP;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = x => x * x * x * (10 - 15 * x + 6 * x * x);

  function mountCascade(root) {
    if (root.dataset.ecMounted === "1") return;
    root.dataset.ecMounted = "1";

    const stageList = root.querySelector(".ec-stages");
    const rowsHost = root.querySelector(".ec-rows");
    const currentBadge = root.querySelector(".ec-current-stage");
    const replayBtn = root.querySelector(".ec-replay");
    if (!stageList || !rowsHost) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    stageList.replaceChildren();
    rowsHost.replaceChildren();

    const stageButtons = STAGES.map((st, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<span class="ec-stage-bar" aria-hidden="true"><i></i></span><span class="ec-stage-name">${st.short}</span>`;
      btn.setAttribute("aria-label", `查看累计至 ${st.full} 的实测时延`);
      btn.addEventListener("click", () => seekStage(i + 1));
      li.appendChild(btn);
      stageList.appendChild(li);
      return btn;
    });

    const rows = POLICIES.map(policy => {
      const nativeMs = policy.lat[0];
      const row = document.createElement("div");
      row.className = "ec-row";
      row.innerHTML = `
        <div class="ec-policy"><strong>${policy.name}</strong><span>${policy.meta}</span></div>
        <div class="ec-bars">
          <div class="ec-lane"><div class="ec-track"><div class="ec-fill is-native"></div></div><span class="ec-ms">${nativeMs.toFixed(2)} ms</span></div>
          <div class="ec-lane is-ours"><div class="ec-track"><div class="ec-trail"></div><div class="ec-fill is-flow"></div></div><span class="ec-ms"></span></div>
        </div>
        <div class="ec-speedup"><span></span><small>×</small></div>`;
      rowsHost.appendChild(row);
      return {
        lat: policy.lat,
        trailW: 1,
        fill: row.querySelector(".ec-fill.is-flow"),
        trail: row.querySelector(".ec-trail"),
        ms: row.querySelector(".is-ours .ec-ms"),
        speed: row.querySelector(".ec-speedup span")
      };
    });

    let lastStage = -1;
    let raf = 0;
    let played = false;

    const stageAt = t => {
      const u = t - LEAD;
      if (u <= 0) return 0;
      const k = Math.min(S - 1, Math.floor(u / STEP));
      return k + smooth(clamp((u - k * STEP) / MOVE));
    };

    function render(s, dt) {
      const k = Math.min(S - 1, Math.floor(s));
      const f = s - k;
      for (const r of rows) {
        const cur = r.lat[k] + (r.lat[k + 1] - r.lat[k]) * f;
        const w = Math.max(0.015, cur / r.lat[0]);
        r.fill.style.transform = `scaleX(${w})`;
        r.trailW = dt == null ? w : Math.max(w, r.trailW + (w - r.trailW) * (1 - Math.exp(-dt / 0.22)));
        r.trail.style.transform = `scaleX(${r.trailW})`;
        r.ms.textContent = `${cur.toFixed(2)} ms`;
        r.speed.textContent = (r.lat[0] / cur).toFixed(1);
      }
      const reached = s >= S - 1e-6 ? S : Math.floor(s + 1e-6);
      root.classList.toggle("is-final", reached === S);
      if (reached !== lastStage) {
        lastStage = reached;
        stageButtons.forEach((b, i) => {
          b.classList.toggle("is-done", i + 1 <= reached);
          b.setAttribute("aria-pressed", String(i + 1 === reached));
        });
        if (currentBadge) {
          currentBadge.textContent = reached ? STAGES[reached - 1].full : "原生多步基线";
        }
      }
      stageButtons.forEach((b, i) => b.style.setProperty("--fill", clamp(s - i)));
    }

    function run() {
      cancelAnimationFrame(raf);
      if (reduced) { render(S); return; }
      let prev = 0;
      const t0 = performance.now();
      const frame = now => {
        const t = (now - t0) / 1000;
        render(stageAt(t), prev ? (now - prev) / 1000 : 0);
        prev = now;
        if (t < TOTAL) raf = requestAnimationFrame(frame);
        else { raf = 0; render(S); }
      };
      raf = requestAnimationFrame(frame);
    }

    function seekStage(target) {
      cancelAnimationFrame(raf);
      raf = 0;
      played = true;
      if (reduced) { render(target); return; }
      const from = Math.max(0, lastStage);
      const dur = 0.42 * Math.max(1, Math.abs(target - from)) ** 0.5;
      const start = performance.now();
      let prev = 0;
      const frame = now => {
        const f = clamp((now - start) / 1000 / dur);
        render(from + (target - from) * smooth(f), prev ? (now - prev) / 1000 : 0);
        prev = now;
        if (f < 1) raf = requestAnimationFrame(frame);
        else raf = 0;
      };
      raf = requestAnimationFrame(frame);
    }

    if (replayBtn) {
      replayBtn.addEventListener("click", () => {
        played = true;
        render(0);
        run();
      });
    }

    // Start at full OneFlow+ in static/reduced mode, or animate when scrolled into view.
    if (reduced || root.closest(".slide")) {
      render(S);
    } else {
      render(S);
      const io = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting || played) return;
        played = true;
        io.disconnect();
        render(0);
        run();
      }, { threshold: 0.35 });
      io.observe(rowsHost);
    }

    root.addEventListener("ec-play", () => {
      played = true;
      render(0);
      run();
    });
  }

  function init() {
    document.querySelectorAll("[data-engine-cascade]").forEach(mountCascade);
  }
  if (document.readyState === "complete") init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();
