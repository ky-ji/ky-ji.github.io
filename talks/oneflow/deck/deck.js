/* OneFlow Keynote engine.
   Modes: audience (default), presenter (?presenter), embed (?embed, used by the presenter previews).
   Keys: → Space PageDown next · ← PageUp previous · O overview · P presenter · F fullscreen · B black · ? help */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const MODE = params.has('presenter') ? 'presenter' : params.has('embed') ? 'embed' : 'audience';
  const STILL = params.has('still');
  const W = 1920, H = 1080;
  const html = document.documentElement;
  html.dataset.mode = MODE;

  const viewport = document.querySelector('.ofd-viewport');
  const stage = document.querySelector('.ofd-stage');
  const slides = [...stage.querySelectorAll(':scope > .slide')];
  const N = slides.length;
  const scenes = window.OFDScenes || {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  slides.forEach((s, i) => {
    s.classList.add('theme-' + (s.dataset.theme || 'light'));
    const num = document.createElement('span');
    num.className = 'ov-num';
    num.textContent = String(i + 1).padStart(2, '0');
    s.append(num);
  });
  const maxStep = slides.map(s => {
    let m = Number(s.dataset.steps || 0);
    s.querySelectorAll('[data-in],[data-out],[data-dim]').forEach(e => {
      m = Math.max(m, Number(e.dataset.in || 0), Number(e.dataset.out || 0), Number(e.dataset.dim || 0));
    });
    return m;
  });

  /* chrome inside the stage */
  const chrome = document.createElement('div');
  chrome.className = 'ofd-chrome';
  chrome.innerHTML = '<span class="brand"><img src="oneflow/assets/figures/oneflow-mark.svg" alt=""><b>OneFlow</b><i></i><span class="chap"></span></span><span class="num"></span>';
  const progress = document.createElement('div');
  progress.className = 'ofd-progress';
  stage.append(chrome, progress);

  let cur = 0, step = 0, overview = false;

  /* ---------- fitting ---------- */
  function fit() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.setProperty('--scale', String(s));
  }
  addEventListener('resize', () => requestAnimationFrame(fit));
  fit();

  /* ---------- count-up numbers ---------- */
  function countUp(el) {
    if (el._counted) return;
    el._counted = true;
    const target = Number(el.dataset.count);
    const dec = Number(el.dataset.dec || (String(el.dataset.count).split('.')[1] || '').length);
    const from = Number(el.dataset.from || 0);
    if (reduced || STILL) { el.textContent = target.toFixed(dec); return; }
    const dur = Number(el.dataset.dur || 1400);
    const t0 = performance.now();
    const tick = now => {
      const f = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - f, 4);
      el.textContent = (from + (target - from) * e).toFixed(dec);
      if (f < 1 && el._counted) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ---------- videos ---------- */
  function videosOf(s) { return [...s.querySelectorAll('video')]; }
  function loadVideos(s) {
    videosOf(s).forEach(v => {
      if (!v.src && v.dataset.src) { v.src = v.dataset.src; v.preload = 'auto'; }
    });
  }
  function playVideos(s) {
    if (MODE === 'embed' && params.has('preview')) return;
    videosOf(s).forEach(v => {
      if (v.closest('[data-in]:not(.on)') || v.closest('.off')) { v.pause(); return; }
      if (v.dataset.rate) v.playbackRate = Number(v.dataset.rate);
      if (v.dataset.restart !== undefined && v._restart) v.currentTime = 0;
      const p = v.play();
      if (p) p.catch(() => {});
    });
  }
  function pauseVideos(s) { videosOf(s).forEach(v => { v.pause(); v._restart = true; }); }

  /* ---------- state ---------- */
  function applyBuilds(s, st, active = true) {
    s.dataset.step = st;
    s.querySelectorAll('[data-in]').forEach(e => {
      const n = Number(e.dataset.in);
      e.classList.toggle('on', active ? st >= n : n > 0 && st >= n);
    });
    s.querySelectorAll('[data-out]').forEach(e => e.classList.toggle('off', st >= Number(e.dataset.out)));
    s.querySelectorAll('[data-dim]').forEach(e => e.classList.toggle('dim', st >= Number(e.dataset.dim)));
  }
  function runCounts(s) {
    s.querySelectorAll('[data-count]').forEach(el => {
      const host = el.closest('[data-in]');
      if (!host || host.classList.contains('on')) countUp(el);
    });
  }
  function resetCounts(s) { s.querySelectorAll('[data-count]').forEach(el => { el._counted = false; }); }

  let lastCur = -1;
  function render(opts = {}) {
    const prev = lastCur;
    slides.forEach((s, i) => {
      s.dataset.state = i === cur ? 'active' : i < cur ? 'past' : 'future';
      s.inert = i !== cur;
      if (i !== cur) applyBuilds(s, i < cur ? maxStep[i] : 0, false);
    });
    const s = slides[cur];
    applyBuilds(s, step);
    html.dataset.theme = s.dataset.theme || 'light';
    chrome.classList.toggle('is-hidden', s.dataset.chrome === 'off');
    chrome.querySelector('.chap').textContent = s.dataset.chapter || '';
    chrome.querySelector('.num').textContent = String(cur + 1).padStart(2, '0') + ' / ' + String(N).padStart(2, '0');
    progress.style.setProperty('--p', String((cur + (maxStep[cur] ? step / (maxStep[cur] + 1) : 0)) / (N - 1)));

    if (prev !== cur) {
      if (prev >= 0) {
        const old = slides[prev];
        pauseVideos(old);
        resetCounts(old);
        if (MODE !== 'presenter') scenes[old.dataset.scene]?.leave?.(old);
      }
      if (MODE !== 'presenter') {
        loadVideos(s);
        if (slides[cur + 1]) loadVideos(slides[cur + 1]);
        scenes[s.dataset.scene]?.enter?.(s, step, opts);
      }
      lastCur = cur;
    }
    if (MODE !== 'presenter') {
      scenes[s.dataset.scene]?.step?.(s, step, opts);
      if (!overview) playVideos(s);
      setTimeout(() => runCounts(s), prev !== cur ? 350 : 120);
    }

    if (MODE === 'audience') {
      const hash = '#/' + (cur + 1) + (step ? '/' + step : '');
      if (location.hash !== hash) history.replaceState(null, '', hash);
    }
    if (!opts.silent && MODE !== 'embed') post();
    onChange.forEach(fn => fn(cur, step));
  }

  function go(i, st = 0, opts = {}) {
    cur = Math.max(0, Math.min(N - 1, i));
    step = Math.max(0, Math.min(maxStep[cur], st));
    render(opts);
  }
  function next() {
    if (step < maxStep[cur]) { step++; render({ dir: 1 }); }
    else if (cur < N - 1) { cur++; step = 0; render({ dir: 1 }); }
  }
  function prev() {
    if (step > 0) { step--; render({ dir: -1 }); }
    else if (cur > 0) { cur--; step = maxStep[cur]; render({ dir: -1 }); }
  }

  /* ---------- sync between windows ---------- */
  const channel = 'BroadcastChannel' in window && MODE !== 'embed' ? new BroadcastChannel('ofd-oneflow-261125') : null;
  function post() { channel?.postMessage({ type: 'state', cur, step }); }
  channel?.addEventListener('message', e => {
    const d = e.data;
    if (d?.type === 'state' && (d.cur !== cur || d.step !== step)) go(d.cur, d.step, { silent: true });
    if (d?.type === 'hello' && MODE === 'audience') post();
  });

  /* ---------- overview ---------- */
  function layoutOverview() {
    const cols = 6, gap = 26, pad = 40;
    const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    const sc = cw / W, ch = H * sc;
    const rows = Math.ceil(N / cols);
    const top = (H - (rows * ch + (rows - 1) * gap)) / 2;
    slides.forEach((s, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      s.style.setProperty('--ox', (pad + c * (cw + gap)) + 'px');
      s.style.setProperty('--oy', (top + r * (ch + gap)) + 'px');
      s.style.setProperty('--os', String(sc));
    });
  }
  function toggleOverview(force) {
    overview = force ?? !overview;
    if (overview) { layoutOverview(); slides.forEach(s => { s.inert = false; applyBuilds(s, maxStep[slides.indexOf(s)]); pauseVideos(s); }); }
    html.classList.toggle('is-overview', overview);
    if (!overview) render({ silent: true });
  }
  stage.addEventListener('click', e => {
    if (!overview) return;
    const s = e.target.closest('.slide');
    if (!s) return;
    e.stopPropagation();
    cur = slides.indexOf(s); step = 0;
    toggleOverview(false);
    render();
  }, true);

  /* ---------- input ---------- */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, select, textarea')) return;
    const k = e.key;
    if (['ArrowRight', 'PageDown', ' ', 'Enter', 'ArrowDown'].includes(k)) { e.preventDefault(); if (overview) toggleOverview(false); else next(); }
    else if (['ArrowLeft', 'PageUp', 'Backspace', 'ArrowUp'].includes(k)) { e.preventDefault(); if (!overview) prev(); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(N - 1, maxStep[N - 1]);
    else if (k === 'o' || k === 'O' || (k === 'Escape' && !html.classList.contains('is-help'))) { if (MODE !== 'presenter') toggleOverview(); }
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'b' || k === 'B' || k === '.') html.classList.toggle('is-black');
    else if (k === 'p' || k === 'P') openPresenter();
    else if (k === '?' || k === 'h' || k === 'H') html.classList.toggle('is-help');
    else if (k === 'Escape') html.classList.remove('is-help');
  }
  if (MODE !== 'embed') addEventListener('keydown', onKey);

  if (MODE === 'audience') {
    viewport.addEventListener('click', e => {
      if (overview || e.target.closest('button, a, input, select, label, .no-advance')) return;
      const rect = viewport.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width * 0.18) prev(); else next();
    });
    let tx = 0, ty = 0;
    viewport.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    viewport.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? next() : prev(); }
    });
    let idle;
    addEventListener('mousemove', () => {
      html.classList.add('hud-on');
      document.body.style.cursor = '';
      clearTimeout(idle);
      idle = setTimeout(() => { html.classList.remove('hud-on'); document.body.style.cursor = 'none'; }, 2200);
    });
  }

  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {}
  }
  function openPresenter() {
    if (MODE !== 'audience') return;
    const url = location.pathname + '?presenter#/' + (cur + 1) + '/' + step;
    window.open(url, 'oneflow-presenter', 'width=1400,height=860');
  }

  document.querySelector('[data-act="overview"]')?.addEventListener('click', e => { e.stopPropagation(); toggleOverview(); });
  document.querySelector('[data-act="presenter"]')?.addEventListener('click', e => { e.stopPropagation(); openPresenter(); });
  document.querySelector('[data-act="full"]')?.addEventListener('click', e => { e.stopPropagation(); toggleFull(); });
  document.querySelector('[data-act="help"]')?.addEventListener('click', e => { e.stopPropagation(); html.classList.toggle('is-help'); });
  document.querySelector('.ofd-help')?.addEventListener('click', () => html.classList.remove('is-help'));

  /* ---------- presenter console ---------- */
  const onChange = [];
  function buildPresenter() {
    const plan = [];
    let acc = 0;
    slides.forEach(s => { plan.push(acc); acc += Number(s.dataset.time || 1); });
    const total = acc;
    const ui = document.createElement('div');
    ui.className = 'ofp';
    ui.innerHTML = `
      <header>
        <div class="clock" data-elapsed>00:00<small>已用</small></div>
        <span class="pace" data-pace>计划 00:00</span>
        <div class="clock" data-now style="font-size:26px;color:#9fb0c8">--:--</div>
        <button type="button" data-reset>重置计时</button>
        <button type="button" data-prev>上一步</button>
        <button type="button" data-next>下一步</button>
        <div class="where"><b data-title></b><span data-meta></span></div>
      </header>
      <main>
        <div class="frame cur"><label>观众画面</label><iframe data-cur title="当前画面"></iframe></div>
        <aside>
          <div class="frame next"><label data-next-label>下一步</label><iframe data-nextf title="下一步预览"></iframe></div>
          <div class="steps" data-steps></div>
          <div class="notes" data-notes></div>
        </aside>
      </main>`;
    document.body.append(ui);
    const base = location.pathname;
    const fc = ui.querySelector('[data-cur]'), fn = ui.querySelector('[data-nextf]');
    fc.src = base + '?embed';
    fn.src = base + '?embed&preview';
    const ready = f => new Promise(r => f.addEventListener('load', r, { once: true }));
    let start = null;
    const fmt = sec => { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
    function tickClock() {
      const now = new Date();
      ui.querySelector('[data-now]').textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      const el = start ? (Date.now() - start) / 1000 : 0;
      ui.querySelector('[data-elapsed]').innerHTML = fmt(el) + '<small>已用 / 计划 ' + fmt(total * 60) + '</small>';
      const planned = plan[cur] * 60;
      const pace = ui.querySelector('[data-pace]');
      const diff = el - planned;
      pace.textContent = '本页计划 ' + fmt(planned) + (start ? (diff >= 0 ? ' · 慢 ' : ' · 快 ') + fmt(Math.abs(diff)) : '');
      pace.className = 'pace' + (start ? (diff > 45 ? ' late' : diff < -45 ? ' early' : '') : '');
    }
    setInterval(tickClock, 500);
    ui.querySelector('[data-reset]').addEventListener('click', () => { start = Date.now(); tickClock(); });
    ui.querySelector('[data-prev]').addEventListener('click', () => { prev(); });
    ui.querySelector('[data-next]').addEventListener('click', () => { if (!start) start = Date.now(); next(); });
    addEventListener('keydown', e => { if (!start && ['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) start = Date.now(); }, true);

    Promise.all([ready(fc), ready(fn)]).then(() => sync());
    function sync() {
      const s = slides[cur];
      ui.querySelector('[data-title]').textContent = (cur + 1) + ' · ' + (s.dataset.title || '');
      ui.querySelector('[data-meta]').textContent = (s.dataset.chapter || '') + ' · 建议 ' + (s.dataset.time || 1) + ' 分钟';
      const notes = s.querySelector('aside.notes');
      ui.querySelector('[data-notes]').innerHTML = '<span class="t">讲稿提示</span>' + (notes ? notes.innerHTML : '<p>（本页无提示）</p>');
      ui.querySelector('[data-steps]').innerHTML = maxStep[cur] ? '动画步骤 ' + Array.from({ length: maxStep[cur] + 1 }, (_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('') : '本页无分步动画';
      let ni = cur, ns = step + 1;
      if (ns > maxStep[cur]) { ni = cur + 1; ns = 0; }
      ui.querySelector('[data-next-label]').textContent = ni >= N ? '结束' : ni === cur ? '下一步 · 本页动画' : '下一页 · ' + (slides[ni].dataset.title || '');
      try {
        fc.contentWindow.OFD?.go(cur, step, { silent: true });
        if (ni < N) fn.contentWindow.OFD?.go(ni, ns, { silent: true });
      } catch {}
      tickClock();
    }
    onChange.push(sync);
    channel?.postMessage({ type: 'hello' });
  }

  /* ---------- boot ---------- */
  Object.values(scenes).forEach(sc => sc.init?.());
  slides.forEach(s => scenes[s.dataset.scene]?.mount?.(s, { W, H }));
  const m = /#\/(\d+)(?:\/(\d+))?/.exec(location.hash);
  if (m) { cur = Math.max(0, Math.min(N - 1, Number(m[1]) - 1)); step = Math.min(maxStep[cur], Number(m[2] || 0)); }
  if (MODE === 'presenter') buildPresenter();
  render({ silent: MODE !== 'audience' || !channel });
  if (MODE === 'audience') {
    addEventListener('hashchange', () => {
      const h2 = /#\/(\d+)(?:\/(\d+))?/.exec(location.hash);
      if (!h2) return;
      const i = Number(h2[1]) - 1, st = Number(h2[2] || 0);
      if (i !== cur || st !== step) go(i, st);
    });
  }
  if (MODE === 'embed') html.classList.add('no-transition');

  window.OFD = { go, next, prev, get cur() { return cur; }, get step() { return step; }, slides, maxStep };
})();
