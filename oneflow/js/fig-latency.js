// Efficiency figure: the OneFlow latency falls through the cumulative configurations of
// Table 5 while Native stays fixed as the reference. Each pair uses its own scale (Native = full
// width). Every value is read from the static table's data-latency-ms attributes, so the table is
// the single source of truth. The drop plays once when the figure comes into view; Replay and the
// stage buttons let the reader repeat it or inspect one configuration.
(function () {
  const root = document.getElementById('fig-latency');
  const table = document.querySelector('.latency-table');
  if (!root || !table) return;

  const headers = [...table.querySelectorAll('thead th[data-n]')];
  const tableRows = [...table.querySelectorAll('tbody tr')];
  // Stage 0 is Native; stages 1..S are the cumulative OneFlow configurations.
  const S = tableRows.length - 1;
  const stageName = tr => tr.querySelector('th').textContent.replace(/\s*\(.*\)\s*$/, '').trim();
  const series = headers.map((_, j) => tableRows.map(tr => Number(tr.querySelectorAll('td')[j].dataset.latencyMs)));

  const MOVE = 0.62, HOLD = 0.34, LEAD = 0.45;               // seconds per drop, pause per stage, initial pause
  const STEP = MOVE + HOLD, TOTAL = LEAD + S * STEP;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = x => x * x * x * (10 - 15 * x + 6 * x * x);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  // Stage selector: one button per cumulative configuration.
  const stageList = root.querySelector('.latency-stages');
  const current = root.querySelector('.latency-stage-current');
  const stageButtons = tableRows.slice(1).map((tr, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="latency-stage-bar" aria-hidden="true"><i></i></span><span class="latency-stage-name">${stageName(tr)}</span>`;
    b.setAttribute('aria-label', `Show latency after ${stageName(tr)}`);
    b.addEventListener('click', () => seekStage(i + 1));
    li.appendChild(b);
    stageList.appendChild(li);
    return b;
  });

  const rows = headers.map((header, j) => {
    const name = header.textContent.trim(), lat = series[j], a = lat[0], b = lat[S];
    const row = document.createElement('div');
    row.className = 'latency-row';
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', `${name}, N = ${header.dataset.n}: Native ${a.toFixed(2)} ms; OneFlow plus execution engine ${b.toFixed(2)} ms; ${(a / b).toFixed(1)} times speedup.`);
    row.innerHTML = `
      <div class="latency-policy" aria-hidden="true"><strong>${name}</strong><span>N = ${header.dataset.n}${j === 0 ? ' · selected repeat' : ''}</span></div>
      <div class="latency-bars" aria-hidden="true">
        <div class="latency-lane"><div class="latency-track"><div class="latency-fill native-fill"></div></div><span class="latency-ms">${a.toFixed(2)} ms</span></div>
        <div class="latency-lane is-ours"><div class="latency-track"><div class="latency-trail"></div><div class="latency-fill parallel-fill"></div></div><span class="latency-ms"></span></div>
      </div>
      <div class="latency-speedup" aria-hidden="true"><span></span><small>×</small></div>`;
    root.querySelector('.latency-rows').appendChild(row);
    return {
      lat, row, trailW: 1,
      fill: row.querySelector('.parallel-fill'),
      trail: row.querySelector('.latency-trail'),
      ms: row.querySelector('.is-ours .latency-ms'),
      speed: row.querySelector('.latency-speedup span'),
    };
  });

  // Fractional stage at time t (seconds): holds at each stage, smooth drop between stages.
  const stageAt = t => {
    const u = t - LEAD;
    if (u <= 0) return 0;
    const k = Math.min(S - 1, Math.floor(u / STEP));
    return k + smooth(clamp((u - k * STEP) / MOVE));
  };

  let lastStage = -1;
  function render(s, dt) {
    const k = Math.min(S - 1, Math.floor(s)), f = s - k;
    for (const r of rows) {
      const cur = r.lat[k] + (r.lat[k + 1] - r.lat[k]) * f, w = cur / r.lat[0];
      r.fill.style.transform = `scaleX(${w})`;
      // The trail lags behind the bar, so each removed share of latency is visible as it drops.
      r.trailW = dt == null ? w : Math.max(w, r.trailW + (w - r.trailW) * (1 - Math.exp(-dt / 0.22)));
      r.trail.style.transform = `scaleX(${r.trailW})`;
      r.ms.textContent = `${cur.toFixed(2)} ms`;
      r.speed.textContent = (r.lat[0] / cur).toFixed(1);
    }
    const reached = s >= S - 1e-6 ? S : Math.floor(s + 1e-6);
    root.classList.toggle('is-final', reached === S);
    if (reached !== lastStage) {
      lastStage = reached;
      stageButtons.forEach((b, i) => {
        b.classList.toggle('is-done', i + 1 <= reached);
        b.setAttribute('aria-pressed', String(i + 1 === reached));
      });
      // Narrow screens show only the bars of the stepper and name the current stage here.
      current.textContent = reached ? stageName(tableRows[reached]) : 'Native';
    }
    stageButtons.forEach((b, i) => b.style.setProperty('--fill', clamp(s - i)));
  }

  let raf = 0, t0 = 0, played = false;
  function run(from = 0) {
    cancelAnimationFrame(raf);
    let prev = 0;
    t0 = performance.now() - from * 1000;
    const frame = now => {
      const t = (now - t0) / 1000;
      render(stageAt(t), prev ? (now - prev) / 1000 : 0);
      prev = now;
      if (t < TOTAL) raf = requestAnimationFrame(frame);
      else { raf = 0; render(S); }
    };
    raf = requestAnimationFrame(frame);
  }
  function seekStage(k) {
    cancelAnimationFrame(raf); raf = 0; played = true;
    if (reduced) { render(k); return; }
    // Animate from the current stage to the chosen one.
    const from = Math.max(0, lastStage), dur = 0.45 * Math.max(1, Math.abs(k - from)) ** 0.5;
    const start = performance.now();
    let prev = 0;
    const frame = now => {
      const f = clamp((now - start) / 1000 / dur);
      render(from + (k - from) * smooth(f), prev ? (now - prev) / 1000 : 0);
      prev = now;
      if (f < 1) raf = requestAnimationFrame(frame); else raf = 0;
    };
    raf = requestAnimationFrame(frame);
  }

  root.querySelector('.latency-replay').addEventListener('click', () => {
    played = true;
    if (reduced) { render(S); return; }
    render(0); run(0);
  });

  // `#fig-latency=<stage>` freezes the figure at a fractional stage (used for screenshots).
  const pin = /fig-latency=([\d.]+)/.exec(location.hash);
  if (pin) { render(clamp(Number(pin[1]), 0, S)); return; }
  if (reduced) { render(S); return; }
  render(0);
  const io = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting || played) return;
    played = true;
    io.disconnect();
    run(0);
  }, { threshold: 0.45 });
  io.observe(root.querySelector('.latency-rows'));
})();
