// Videos: the hero cover, the real-world Highlights gallery and the inline overview film.
// The cover attaches after the load event and plays while the hero is on screen. In the gallery,
// switching cards pauses the outgoing pair immediately without tearing down decoders on the scroll
// frame; immediate neighbours stay warm for instant scrubbing, and distant cards release decoders
// lazily once scrolling settles. The film fetches nothing until Play. Under reduced motion or
// Save-Data no clip plays or downloads until the reader presses Play.
(function () {
  'use strict';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);
  const manual = reduced || saveData;                 // no autoplay and no fetch until Play
  const NEAR = { rootMargin: '100% 0px' };            // posters, one screen ahead
  const ATTACH = { rootMargin: '320px 0px' };         // sources
  const END = 0.04;                                   // a finished clip holds this far before its end
  const SETTLE = 140;                                 // ms the rail rests on a card before playing

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const clock = s => {
    s = Number.isFinite(s) && s > 0 ? s : 0;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };
  const finite = d => Number.isFinite(d) && d > 0;
  const attempt = v => { const p = v.play(); return p && p.catch ? p : Promise.resolve(); };
  const idle = (fn, timeout = 500) => {
    if ('requestIdleCallback' in window) return requestIdleCallback(fn, { timeout });
    return setTimeout(fn, 180);
  };

  // Full screen through the Fullscreen API, with the prefixed form for older Safari. Where an element cannot
  // go full screen, as on iPhone, the player expands over the page instead and Escape closes it.
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  function expander(el, btn, nativeVideo) {
    let expanded = false;
    const lock = on => document.documentElement.classList.toggle('media-lock', on);
    function sync() {
      const fs = fsElement() === el;
      el.classList.toggle('is-fs', fs);
      el.classList.toggle('is-expanded', expanded);
      lock(expanded);
      btn.setAttribute('aria-label', fs || expanded ? 'Exit full screen' : 'Full screen');
      btn.dataset.on = String(fs || expanded);
    }
    function setExpanded(on) { expanded = on; sync(); }
    function enter() {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
        try {
          const p = req.call(el);
          if (p && p.catch) p.catch(() => setExpanded(true));
          return;
        } catch (e) { /* fall through to the fallbacks */ }
      }
      if (nativeVideo && nativeVideo.webkitEnterFullscreen && nativeVideo.readyState >= 1) {
        try { nativeVideo.webkitEnterFullscreen(); return; } catch (e) { /* expand instead */ }
      }
      setExpanded(true);
    }
    function toggle() {
      if (fsElement() === el) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        const p = exit && exit.call(document);
        if (p && p.catch) p.catch(() => {});
      } else if (expanded) setExpanded(false);
      else enter();
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) setExpanded(false); });
    btn.addEventListener('click', toggle);
    return { toggle };
  }

  // Speed button: cycles through its rates and reports the new one.
  function speedButton(btn, rates, label, onChange) {
    let i = 0;
    btn.addEventListener('click', () => {
      i = (i + 1) % rates.length;
      const r = rates[i];
      btn.textContent = `${r}×`;
      btn.setAttribute('aria-label', `${label} ${r}×`);
      onChange(r);
    });
    return () => rates[i];
  }

  // Range input painted with its filled share in --p, and a guard while the reader drags it.
  function scrubber(input, onSeek) {
    let dragging = false;
    input.addEventListener('input', () => {
      dragging = true;
      const f = Number(input.value) / 1000;
      input.style.setProperty('--p', `${(f * 100).toFixed(2)}%`);
      onSeek(f);
    });
    input.addEventListener('change', () => { dragging = false; });
    input.addEventListener('pointerup', () => { dragging = false; });
    return {
      paint(f, text) {
        if (!dragging) input.value = String(Math.round(f * 1000));
        input.style.setProperty('--p', `${(f * 100).toFixed(2)}%`);
        if (text && input.getAttribute('aria-valuetext') !== text) input.setAttribute('aria-valuetext', text);
      },
    };
  }

  /* ---------- Hero cover: the five-task wall behind the title ---------- */
  // A muted loop under its poster. The source attaches after the load event and the next idle moment,
  // so the clip never competes with the first paint, and it plays while any of the hero is on screen.
  // Under reduced motion or Save-Data the poster stays until the round button is pressed.
  function cover(hero) {
    const video = hero.querySelector('.hero-video'), btn = hero.querySelector('.hero-toggle');
    let attached = false, armed = false, seen = true;
    let intent = manual ? 'pause' : 'auto';
    if (manual) { video.autoplay = false; video.removeAttribute('autoplay'); }

    function attach() {
      if (attached) return;
      attached = true;
      video.preload = 'auto';
      video.src = video.dataset.src;
    }
    function paint() {
      if (hero.dataset.video === 'error') return;
      const on = !video.paused && !video.ended;
      hero.dataset.video = on ? 'playing' : 'paused';
      btn.setAttribute('aria-label', on ? 'Pause the background video' : 'Play the background video');
    }
    function run() {
      const want = intent !== 'pause' && seen && !document.hidden && hero.dataset.video !== 'error';
      if (want && (armed || intent === 'play')) {
        attach();
        if (video.paused) attempt(video).catch(err => { if (err && err.name === 'NotAllowedError') { intent = 'pause'; paint(); } });
      } else if (!want && !video.paused) video.pause();
    }
    ['play', 'playing', 'pause', 'ended'].forEach(t => video.addEventListener(t, paint));
    video.addEventListener('error', () => { if (video.getAttribute('src')) hero.dataset.video = 'error'; });
    btn.addEventListener('click', () => {
      if (!video.paused) { intent = 'pause'; video.pause(); }
      else { intent = 'play'; run(); }
    });
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; run(); }).observe(hero);
    document.addEventListener('visibilitychange', run);
    if (!manual) {
      const arm = () => idle(() => { armed = true; run(); }, 800);
      if (document.readyState === 'complete') arm(); else addEventListener('load', arm, { once: true });
    }
    paint();
  }

  /* ---------- One gallery card: Native and OneFlow+ on one clock ---------- */
  // The longer clip is the clock. The shorter one follows it and holds its last frame under a
  // Finished pill once it ends. Both rest on their last frames for a beat, then restart together.
  function pair(card) {
    const d = card.dataset, q = s => card.querySelector(s);
    const playBtn = q('[data-act="play"]'), mark = q('.rw-mark'), now = q('.rw-now'), end = q('.rw-end');
    const sides = ['native', 'plus'].map(side => {
      const pane = q(`.rw-pane[data-side="${side}"]`);
      return { side, pane, video: pane.querySelector('video'), src: d[`${side}Src`], poster: d[`${side}Poster`], dur: Number(d[`${side}Dur`]), seekAt: 0 };
    });
    let attached = false, live = false, inView = false, playing = false, raf = 0, loopTimer = 0, heldT = 0;
    let intent = manual ? 'pause' : 'auto';
    let master = sides[0], follower = sides[1], T = 1;

    function timeline() {
      const [a, b] = sides;
      master = b.dur > a.dur ? b : a;
      follower = master === a ? b : a;
      T = master.dur;
      const f = follower.dur / T;
      mark.hidden = f > 0.995;
      mark.style.setProperty('--m', f.toFixed(4));
      end.textContent = clock(T);
    }
    const pos = () => {
      if (!attached) return heldT;
      const v = master.video;
      return v.ended ? T : Math.min(v.currentTime, T);
    };

    function posters() {
      for (const s of sides) if (s.video.getAttribute('poster') !== s.poster) s.video.poster = s.poster;
    }
    function attach() {
      if (attached) return;
      attached = true;
      posters();
      const r = speed();
      // Only the moov box until the pair actually plays, so a warm neighbour costs almost nothing.
      for (const s of sides) {
        s.video.defaultPlaybackRate = r;
        s.video.preload = 'metadata';
        s.video.src = s.src;
        s.video.playbackRate = r;
        if (heldT > 0) s.video.currentTime = Math.min(heldT, s.dur - END);
      }
    }
    // Full decoder release — always scheduled off the scroll hot path.
    function detach() {
      if (!attached) return;
      stopClock();
      for (const s of sides) {
        s.video.pause();
        if (s.video.hasAttribute('src')) { s.video.removeAttribute('src'); s.video.load(); }
        s.video.preload = 'none';
        s.pane.classList.remove('is-error');
      }
      attached = false;
    }

    function setPlaying(on) {
      playing = on;
      card.dataset.state = on ? 'playing' : 'paused';
      playBtn.setAttribute('aria-label', on ? 'Pause both clips' : 'Play both clips');
    }
    function stopClock() {
      clearTimeout(loopTimer);
      cancelAnimationFrame(raf);
      raf = 0;
      setPlaying(false);
    }
    function playBoth() {
      attach();
      for (const s of sides) s.video.preload = 'auto';
      clearTimeout(loopTimer);
      if (pos() >= T - END) seekAll(0);              // Play at the end starts over
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
    function pauseBoth() {
      const t = pos();
      stopClock();
      for (const s of sides) s.video.pause();
      paint(t);
    }
    function seekAll(t) {
      t = Math.min(Math.max(0, t), T);
      clearTimeout(loopTimer);
      heldT = t;
      if (attached) for (const s of sides) {
        s.video.currentTime = Math.max(0, Math.min(t, s.dur - END));
        if (t >= s.dur - END && !s.video.paused) s.video.pause();
      }
      paint(t);
    }

    // Every frame while playing: keep the follower on the master clock, wait for whichever clip is
    // buffering, and hold the follower once the timeline passes its end.
    function tick() {
      raf = 0;
      if (!playing) return;
      const t = pos(), m = master.video, f = follower.video;
      // play() on an ended clip would restart it from 0, so a follower that reached its own end is done.
      const fLive = t < follower.dur - END && !f.ended;
      const mReady = m.ended || m.readyState >= 3;
      const fReady = !fLive || f.readyState >= 3;
      if (mReady && fReady) {
        if (m.paused && !m.ended) attempt(m).catch(blocked);
        if (fLive) {
          if (f.paused) {
            if (Math.abs(f.currentTime - t) > 0.1) f.currentTime = t;
            attempt(f).catch(blocked);
          } else follow(t);
        }
      } else {
        // The waiting clip keeps playing so it fetches. The ready one pauses until both can move.
        if (!mReady) { if (m.paused && !m.ended) attempt(m).catch(blocked); if (fLive && !f.paused) f.pause(); }
        if (!fReady) { if (f.paused) attempt(f).catch(blocked); if (mReady && !m.paused) m.pause(); }
      }
      if (!fLive && !f.paused) f.pause();
      paint(t);
      raf = requestAnimationFrame(tick);
    }
    // Small drift is absorbed by a slight rate change, large drift by one seek per second at most.
    function follow(t) {
      const v = follower.video, r = speed(), dt = v.currentTime - t;
      if (Math.abs(dt) > 0.5) {
        const stamp = performance.now();
        if (stamp - follower.seekAt > 1000) { follower.seekAt = stamp; v.currentTime = t; }
        v.playbackRate = r;
      } else if (Math.abs(dt) > 0.05) v.playbackRate = r * (dt > 0 ? 0.94 : 1.06);
      else if (v.playbackRate !== r) v.playbackRate = r;
    }
    // Autoplay refused, for example in Low Power Mode: show the paused state and wait for Play. An
    // AbortError only means a pause, seek or card change interrupted play() and is ignored.
    function blocked(err) {
      if (!err || err.name !== 'NotAllowedError' || !sides.every(s => s.video.paused)) return;
      intent = 'pause';
      stopClock();
      paint(pos());
    }

    let lastText = '';
    const scrub = scrubber(q('.rw-scrub'), f => {
      if (manual && !attached) intent = 'play';
      attach();
      seekAll(f * T);
    });
    function paint(t) {
      const text = clock(t >= T - END ? T : t);
      scrub.paint(T > 0 ? Math.min(1, t / T) : 0, `${text} of ${clock(T)}`);
      if (text !== lastText) { now.textContent = text; lastText = text; }
      for (const s of sides) s.pane.classList.toggle('is-done', t >= s.dur - END);
    }

    const speed = speedButton(q('[data-act="speed"]'), [1, 2, 4], 'Playback speed', r => {
      for (const s of sides) { s.video.defaultPlaybackRate = r; s.video.playbackRate = r; }
    });

    for (const s of sides) {
      const v = s.video;
      v.addEventListener('loadedmetadata', () => {
        if (!finite(v.duration) || Math.abs(v.duration - s.dur) < 0.002) return;
        s.dur = v.duration;
        timeline();
        paint(pos());
      });
      v.addEventListener('ended', () => {
        if (s !== master || !playing) return;
        // Reduced motion stops on the last frames instead of looping.
        clearTimeout(loopTimer);
        loopTimer = setTimeout(() => {
          if (!playing) return;
          if (reduced) { intent = 'pause'; pauseBoth(); return; }
          seekAll(0);
        }, 900);
      });
      v.addEventListener('error', () => { if (v.getAttribute('src')) s.pane.classList.add('is-error'); });
    }

    // Play when the card is the live one, on screen, in a visible tab, and not paused by the reader.
    function sync() {
      const want = live && inView && !document.hidden && intent !== 'pause';
      if (want && !playing) playBoth();
      else if (!want && playing) pauseBoth();
    }
    function toggle() {
      if (playing) { intent = 'pause'; pauseBoth(); } else { intent = 'play'; playBoth(); }
    }
    playBtn.addEventListener('click', toggle);
    card.querySelectorAll('.rw-screen').forEach(el => el.addEventListener('click', toggle));
    q('[data-act="restart"]').addEventListener('click', () => { intent = 'play'; attach(); seekAll(0); playBoth(); });
    const fs = expander(card, q('[data-act="fullscreen"]'));
    card.addEventListener('keydown', e => {
      if (e.target.type === 'range' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); toggle(); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fs.toggle(); }
    });

    timeline();
    paint(0);
    return {
      posters,
      warm() { if (!manual && !attached) attach(); },
      setView(on) { inView = on; sync(); },
      sync,
      // Pause on leave without calling load() mid-scroll; distant cards call release() when idle.
      setLive(on) {
        if (on === live) return;
        live = on;
        if (on) {
          if (!manual) attach();
          sync();
        } else {
          pauseBoth();
          intent = manual ? 'pause' : 'auto';
        }
      },
      release() {
        if (live || !attached) return;
        detach();
        heldT = 0;
        paint(0);
      },
    };
  }

  /* ---------- Real-world Highlights gallery ---------- */
  // On wide screens with motion the section pins for 400vh of scroll. A C1-smooth magnetic dwell
  // curve gives every card a clear resting focus while damped GPU interpolation smooths discrete
  // wheel steps at 60/120fps with zero per-frame layout reads or synchronous decoder teardown.
  function gallery(section) {
    const scroller = section.querySelector('.rw-scroll'), sticky = section.querySelector('.rw-sticky');
    const viewport = section.querySelector('.rw-viewport'), rail = section.querySelector('.rw-rail');
    const pillBox = section.querySelector('.rw-pills');
    const pills = [...section.querySelectorAll('.rw-pill')];
    const progressBar = section.querySelector('#rwProgressBar');
    const cards = [...rail.querySelectorAll('.rw-card')];
    const players = cards.map(pair);
    const wide = matchMedia('(min-width: 960px) and (prefers-reduced-motion: no-preference)');
    const N = cards.length;
    const D = 0.44, G = 1, STEP = D + G, W = N * D + (N - 1) * G;

    // Sliding white Apple thumb behind the active pill on desktop.
    const thumb = document.createElement('span');
    thumb.className = 'seg-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    pillBox.prepend(thumb);
    pillBox.classList.add('has-thumb');

    let pinned = false, active = -1, loaded = -1, near = false, inView = false, armed = false;
    let settle = 0, releaseTimer = 0, lock = -1, lockTimer = 0, raf = 0;
    let vw = 0, cw = 0, gap = 0, stickyH = 0, scrollerTop = 0, scrollerSpan = 1;
    let pillMetrics = [], pillScrolls = false, thumbReady = false;
    let targetS = 0, displayS = 0, lastRenderedS = -1, lastTs = 0;
    const lastCardOp = new Array(N).fill(-1);
    const lastCardSc = new Array(N).fill(-1);

    // Card position s in [0, N - 1] at scroll progress p: smooth magnetic dwell + cosine glide.
    function stopAt(p) {
      const u = clamp(p) * W;
      const i = Math.min(N - 1, Math.floor(u / STEP));
      const r = u - i * STEP;
      if (r <= D || i >= N - 1) return i;
      const f = (r - D) / G;
      return i + 0.5 - 0.5 * Math.cos(Math.PI * f);
    }
    const progressOf = i => (i * STEP + D * 0.5) / W;

    function pageTop(el) {
      let top = 0;
      for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
      return top;
    }

    function moveThumb(i, instant) {
      const m = pillMetrics[i];
      if (!m || pillScrolls) { thumb.style.opacity = '0'; return; }
      if (instant || !thumbReady) {
        thumb.style.transition = 'none';
        thumb.style.width = `${m.width}px`;
        thumb.style.transform = `translate3d(${m.left}px, 0, 0)`;
        thumb.style.opacity = '1';
        thumb.offsetWidth; // commit initial position once before re-enabling spring transition
        thumb.style.transition = '';
        thumbReady = true;
      } else {
        thumb.style.width = `${m.width}px`;
        thumb.style.transform = `translate3d(${m.left}px, 0, 0)`;
        thumb.style.opacity = '1';
      }
    }

    function measure() {
      vw = viewport.clientWidth;
      cw = cards[0].offsetWidth;
      gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
      stickyH = sticky.offsetHeight;
      scrollerTop = pageTop(scroller);
      scrollerSpan = Math.max(1, scroller.offsetHeight - stickyH);
      pillScrolls = pillBox.scrollWidth > pillBox.clientWidth + 2 || innerWidth <= 734;
      pillMetrics = pills.map(p => ({ left: p.offsetLeft, width: p.offsetWidth }));
      if (active >= 0) moveThumb(active, true);
    }

    function progress() {
      return (scrollY - scrollerTop) / scrollerSpan;
    }

    // Index of the card whose centre is closest to the centre of the scroll-snap rail.
    function snapped() {
      const mid = rail.scrollLeft + rail.clientWidth / 2;
      let best = 0, dist = Infinity;
      cards.forEach((c, i) => { const dd = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (dd < dist) { dist = dd; best = i; } });
      return best;
    }

    function paintPinned(s, force) {
      if (!force && Math.abs(s - lastRenderedS) < 0.00025) return;
      lastRenderedS = s;
      const x = (vw - cw) / 2 - s * (cw + gap);
      rail.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      for (let i = 0; i < N; i++) {
        const d = Math.min(1, Math.abs(s - i));
        const op = 1 - 0.56 * d;
        const sc = 1 - 0.045 * d;
        if (force || Math.abs(op - lastCardOp[i]) > 0.002) {
          cards[i].style.opacity = op.toFixed(3);
          lastCardOp[i] = op;
        }
        if (force || Math.abs(sc - lastCardSc[i]) > 0.0008) {
          cards[i].style.transform = sc > 0.9992 ? 'translate3d(0, 0, 0)' : `translate3d(0, 0, 0) scale(${sc.toFixed(4)})`;
          lastCardSc[i] = sc;
        }
      }
      if (progressBar) progressBar.style.transform = `scaleX(${(s / (N - 1)).toFixed(4)})`;
      choose(Math.round(s));
    }

    function tickPinned(ts) {
      raf = 0;
      if (!pinned) return;
      targetS = stopAt(progress());
      const dt = lastTs ? Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000)) : 1 / 60;
      lastTs = ts;
      const alpha = 1 - Math.exp(-18 * dt);
      displayS += (targetS - displayS) * alpha;
      if (Math.abs(targetS - displayS) < 0.0004) displayS = targetS;
      paintPinned(displayS, false);
      if (displayS !== targetS) raf = requestAnimationFrame(tickPinned);
      else lastTs = 0;
    }

    function frameImmediate() {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTs = 0;
      if (pinned) {
        targetS = stopAt(progress());
        displayS = targetS;
        paintPinned(displayS, true);
      } else {
        const i = snapped();
        choose(i);
        if (progressBar) progressBar.style.transform = `scaleX(${(i / (N - 1)).toFixed(4)})`;
      }
    }

    const queue = () => {
      if (pinned) {
        if (!raf) raf = requestAnimationFrame(tickPinned);
      } else if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          const i = snapped();
          choose(i);
          if (progressBar) progressBar.style.transform = `scaleX(${(i / (N - 1)).toFixed(4)})`;
        });
      }
    };

    // Keep the current pill in view inside its strip without moving the page (mobile only).
    function showPill(i) {
      if (!pillScrolls || !pillMetrics[i]) return;
      const { left: l, width } = pillMetrics[i], r = l + width;
      if (l < pillBox.scrollLeft || r > pillBox.scrollLeft + pillBox.clientWidth) {
        pillBox.scrollTo({ left: Math.max(0, l - 24), behavior: reduced ? 'auto' : 'smooth' });
      }
    }

    function choose(i) {
      if (i === active) return;
      const fs = fsElement();
      if (fs && rail.contains(fs)) return;            // a card in full screen keeps its place
      active = i;
      for (let j = 0; j < N; j++) {
        if (j === i) pills[j].setAttribute('aria-current', 'true');
        else pills[j].removeAttribute('aria-current');
        cards[j].classList.toggle('is-active', j === i);
      }
      moveThumb(i, false);
      // Pause the previous card immediately with zero decoder teardown during scroll.
      if (loaded >= 0 && loaded !== i) { players[loaded].setLive(false); loaded = -1; }
      clearTimeout(settle);
      if (lock >= 0 && i !== lock) return;            // a pill jump loads only its target
      if (lock === i) { lock = -1; clearTimeout(lockTimer); }
      settle = setTimeout(onSettle, SETTLE);
    }

    function postersAround(i) {
      for (let j = Math.max(0, i - 1); j <= Math.min(N - 1, i + 1); j++) players[j].posters();
    }

    function onSettle() {
      if (active < 0) return;
      // Sync inertness and mobile pill strip once motion has rested.
      for (let j = 0; j < N; j++) cards[j].inert = j !== active;
      showPill(active);
      load();
    }

    function load() {
      if (!near || !armed || active < 0) return;
      postersAround(active);
      if (loaded !== active) {
        loaded = active;
        players[active].setView(inView);
        players[active].setLive(true);
      }
      // Lazily pre-warm immediate neighbours and release distant decoders off the scroll path.
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        idle(() => {
          if (active < 0) return;
          for (let j = 0; j < N; j++) {
            const dist = Math.abs(j - active);
            if (dist === 1 && near) players[j].warm();
            else if (dist >= 2) players[j].release();
          }
        }, 600);
      }, 260);
    }

    function go(i) {
      i = clamp(i, 0, N - 1);
      clearTimeout(lockTimer);
      lock = i === active ? -1 : i;
      // If the reader interrupts the jump, the card the rail rests on loads instead.
      if (lock >= 0) lockTimer = setTimeout(() => { lock = -1; clearTimeout(settle); settle = setTimeout(onSettle, SETTLE); }, 1600);
      const behavior = reduced ? 'auto' : 'smooth';
      if (pinned) {
        measure();
        scrollTo({ top: Math.round(scrollerTop + progressOf(i) * scrollerSpan), behavior });
      } else {
        const c = cards[i];
        rail.scrollTo({ left: c.offsetLeft + c.offsetWidth / 2 - rail.clientWidth / 2, behavior });
      }
    }

    pills.forEach((p, i) => {
      p.addEventListener('click', () => go(i));
      p.addEventListener('keydown', e => {
        const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? N - 1 : -1;
        if (j < 0 || j >= N) return;
        e.preventDefault();
        pills[j].focus({ preventScroll: true });
        go(j);
      });
    });

    // A click on a peeking card brings it to the centre.
    viewport.addEventListener('click', e => {
      if (e.target.closest('.rw-card.is-active')) return;
      const i = cards.findIndex(c => {
        const r = c.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (i >= 0 && i !== active) go(i);
    });

    function setMode() {
      pinned = wide.matches;
      if (!pinned) {
        rail.style.transform = '';
        cards.forEach((c, i) => { c.style.opacity = ''; c.style.transform = ''; lastCardOp[i] = -1; lastCardSc[i] = -1; });
      }
      measure();
      if (!pinned && active > 0) {
        const c = cards[active];
        rail.scrollLeft = c.offsetLeft + c.offsetWidth / 2 - rail.clientWidth / 2;
      }
      frameImmediate();
    }
    if (wide.addEventListener) wide.addEventListener('change', setMode); else wide.addListener(setMode);

    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; measure(); frameImmediate(); });
    };
    addEventListener('resize', onResize, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(document.documentElement);
    addEventListener('scroll', () => { if (pinned) queue(); }, { passive: true });
    rail.addEventListener('scroll', () => { if (!pinned) queue(); }, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);

    new IntersectionObserver(([e], io) => {
      if (!e.isIntersecting) return;
      postersAround(Math.max(0, active));
      io.disconnect();
    }, NEAR).observe(section);
    new IntersectionObserver(([e]) => {
      near = e.isIntersecting;
      if (near) load();
      else {
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(() => {
          if (near) return;
          idle(() => {
            if (loaded >= 0) { players[loaded].setLive(false); loaded = -1; }
            players.forEach(p => p.release());
          }, 800);
        }, 900);
      }
    }, ATTACH).observe(section);
    // Play from 30% in view and pause once the rail has left the screen.
    new IntersectionObserver(([e]) => {
      if (e.intersectionRatio >= 0.3) inView = true;
      else if (!e.isIntersecting) inView = false;
      else return;
      if (loaded >= 0) players[loaded].setView(inView);
    }, { threshold: [0, 0.3] }).observe(viewport);
    document.addEventListener('visibilitychange', () => { if (loaded >= 0) players[loaded].sync(); });

    const arm = () => idle(() => { armed = true; load(); }, 1500);
    if (document.readyState === 'complete') arm(); else addEventListener('load', arm, { once: true });

    setMode();
  }

  /* ---------- Overview film: the inline cinema card ---------- */
  // The poster arrives a screen ahead and the source on the first Play. A click on the frame toggles
  // playback, and the docked bar holds play, speed, the scrubber, sound and full screen. The film
  // pauses once it has scrolled fully out of view.
  function cinema(root) {
    const video = root.querySelector('video'), frame = root.querySelector('.cinema-frame');
    const posterImg = root.querySelector('.cinema-poster');
    const note = root.querySelector('.cinema-note'), q = s => root.querySelector(s);
    const playBtn = q('[data-act="play"]'), muteBtn = q('[data-act="mute"]');
    const now = q('.rw-now'), end = q('.rw-end');
    let attached = false, live = false, raf = 0, lastText = '';

    const poster = () => {
      if (posterImg) { if (!posterImg.getAttribute('src') && video.dataset.poster) posterImg.src = video.dataset.poster; }
      else if (!video.getAttribute('poster')) video.poster = video.dataset.poster;
    };
    function revealVideo() {
      if (live) return;
      live = true;
      const show = () => root.classList.add('is-live');
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => requestAnimationFrame(show));
      else requestAnimationFrame(() => requestAnimationFrame(show));
    }
    function attach() {
      if (attached) return;
      attached = true;
      poster();
      video.preload = 'auto';
      video.src = video.dataset.src;
      video.defaultPlaybackRate = speed();
      video.playbackRate = speed();
    }
    function paintState() {
      const on = !video.paused && !video.ended;
      root.dataset.state = on ? 'playing' : 'paused';
      playBtn.setAttribute('aria-label', on ? 'Pause the film' : 'Play the film');
    }
    function paintTime() {
      const dur = finite(video.duration) ? video.duration : 0, t = video.currentTime || 0;
      scrub.paint(dur ? Math.min(1, t / dur) : 0, `${clock(t)} of ${clock(dur)}`);
      const text = clock(t);
      if (text !== lastText) { now.textContent = text; lastText = text; }
    }
    function paintMute() {
      muteBtn.dataset.muted = String(video.muted);
      muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
    }
    function tick() {
      raf = 0;
      paintTime();
      if (!video.paused) raf = requestAnimationFrame(tick);
    }
    function play() {
      attach();
      root.classList.add('is-started');
      attempt(video).catch(err => {
        // Sound needs a gesture in some browsers: retry muted, and the sound button stays available.
        if (err && err.name === 'NotAllowedError' && !video.muted) { video.muted = true; paintMute(); attempt(video).catch(() => {}); }
      });
    }
    const toggle = () => { if (video.paused || video.ended) play(); else video.pause(); };

    const scrub = scrubber(q('.rw-scrub'), f => {
      attach();
      root.classList.add('is-started');
      const seek = () => { if (finite(video.duration)) video.currentTime = f * video.duration; paintTime(); };
      if (video.readyState >= 1) seek(); else video.addEventListener('loadedmetadata', seek, { once: true });
      video.addEventListener('seeked', revealVideo, { once: true });
    });
    const speed = speedButton(q('[data-act="speed"]'), [1, 1.5, 2], 'Playback speed', r => {
      video.defaultPlaybackRate = r;
      video.playbackRate = r;
    });

    video.addEventListener('play', paintState);
    video.addEventListener('pause', paintState);
    video.addEventListener('ended', paintState);
    video.addEventListener('playing', () => { revealVideo(); if (!raf) raf = requestAnimationFrame(tick); });
    video.addEventListener('loadedmetadata', () => { if (finite(video.duration)) end.textContent = clock(video.duration); paintTime(); });
    video.addEventListener('timeupdate', () => { if (video.paused) paintTime(); });
    video.addEventListener('volumechange', paintMute);
    video.addEventListener('error', () => { if (video.getAttribute('src')) note.hidden = false; });
    playBtn.addEventListener('click', toggle);
    frame.addEventListener('click', toggle);
    muteBtn.addEventListener('click', () => { video.muted = !video.muted; paintMute(); });
    const fs = expander(root, q('[data-act="fullscreen"]'), video);
    root.addEventListener('keydown', e => {
      if (e.target.type === 'range' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); toggle(); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fs.toggle(); }
      else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); muteBtn.click(); }
    });

    new IntersectionObserver(([e], io) => { if (e.isIntersecting) { poster(); io.disconnect(); } }, NEAR).observe(root);
    new IntersectionObserver(([e]) => { if (!e.isIntersecting && !video.paused) video.pause(); }).observe(root);
    paintState();
    paintMute();
    paintTime();
  }

  const hero = document.getElementById('top');
  if (hero && hero.querySelector('.hero-video')) cover(hero);
  const rw = document.getElementById('real-world');
  if (rw && rw.querySelector('.rw-rail')) gallery(rw);
  const film = document.getElementById('cinema');
  if (film) cinema(film);
})();
