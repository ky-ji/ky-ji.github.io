// Compare network-call schedules for five identical, illustrative action chunks.
(() => {
  const end = 20;
  const segmentCount = 5;
  const frameCount = 64;
  const slideStops = [4.8, 5.8, 6.8, 8.8, end];
  const schedules = { native: [4, 8, 12, 16, 20], oneflow: [4, 5, 6, 7, 8] };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  for (const studio of document.querySelectorAll('[data-call-studio]')) {
    const slide = studio.closest('.slide');
    const player = studio.querySelector('.cs-player');
    const range = player.querySelector('input');
    const toggle = player.querySelector('[data-cs-play]');
    const count = player.querySelector('[data-cs-count]');
    const lanes = Array.from(studio.querySelectorAll('[data-sampler]'), lane => ({
      times: schedules[lane.dataset.sampler],
      robot: lane.querySelector('.cs-robot'),
      chunks: lane.querySelector('[data-chunks]'),
      tape: lane.querySelector('.cs-tape'),
      segments: Array.from(lane.querySelectorAll('.cs-tape i'))
    }));
    let tick = 4.8;
    let pending = 0;
    let playing = false;
    let last = null;
    let played = false;
    function render(value) {
      tick = Math.max(0, Math.min(end, value));
      range.value = String(tick);
      count.textContent = Math.floor(tick) + ' / ' + end;
      range.setAttribute('aria-valuetext', '第 ' + Math.floor(tick) + ' 次网络调用');
      for (const lane of lanes) {
        const n = lane.times.filter(t => t <= tick).length;
        const t = n ? Math.min(1, (tick - lane.times[n - 1]) / .75) : 0;
        const pose = n ? n - 1 + t : 0;
        const frame = Math.round((tick === end ? segmentCount : pose) / segmentCount * (frameCount - 1));
        lane.robot.style.setProperty('--sprite-x', (frame % 8) * 100 / 7 + '%');
        lane.robot.style.setProperty('--sprite-y', Math.floor(frame / 8) * 100 / 7 + '%');
        lane.chunks.textContent = String(n);
        lane.tape.classList.toggle('is-empty', n === 0);
        lane.segments.forEach((mark, index) => mark.classList.toggle('is-ready', index < n));
      }
    }
    function stop() {
      if (pending) cancelAnimationFrame(pending);
      pending = 0;
      last = null;
      playing = false;
      toggle.textContent = tick >= end ? '重播' : '播放';
      toggle.setAttribute('aria-pressed', 'false');
    }
    function advance(now) {
      if (!playing) return;
      if (last !== null) render(tick + Math.min(now - last, 100) / 520);
      last = now;
      if (tick >= end) stop();
      else pending = requestAnimationFrame(advance);
    }
    function play() {
      played = true;
      if (tick >= end) render(0);
      playing = true;
      last = null;
      toggle.textContent = '暂停';
      toggle.setAttribute('aria-pressed', 'true');
      pending = requestAnimationFrame(advance);
    }
    toggle.addEventListener('click', () => playing ? stop() : play());
    range.addEventListener('input', () => { played = true; stop(); render(Number(range.value)); });
    player.querySelector('[data-cs-reset]').addEventListener('click', () => {
      played = true; render(0); stop();
    });
    studio.addEventListener('focusin', event => { if (event.target === range) stop(); });
    slide?.addEventListener('deckstep', event => { stop(); render(slideStops[Math.min(event.detail.step, slideStops.length - 1)]); });
    if (window.IntersectionObserver) new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { stop(); return; }
      if (!slide && entry.intersectionRatio > .4 && !played && !reduce.matches &&
          !document.hidden && !document.querySelector('#deck[open]')) { render(0); play(); }
    }, {threshold: [0, .42]}).observe(studio);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    document.querySelector('#deck')?.addEventListener('close', stop);
    for (const launch of document.querySelectorAll('[data-start-talk]')) launch.addEventListener('click', stop);
    reduce.addEventListener?.('change', () => { if (reduce.matches) stop(); });
    render(tick);
    stop();
    player.hidden = false;
  }
})();
