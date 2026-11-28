// Page behaviour: floating top navigation with sliding active indicator, hero scroll depth,
// top progress hairline, sliding segmented result tabs, pointer studio sheen, metric count-up,
// scroll reveal and BibTeX copy. Figures live in fig-*.js and videos in real-world.js.
(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const pinned = /fig-[a-z]+=/.test(location.hash);          // screenshot URLs (#fig-...=t) skip entrances

  /* ---------- Top navigation, hero depth & page progress ---------- */
  const nav = document.getElementById('topnav'), toggle = document.getElementById('navToggle');
  const navLinksBox = document.getElementById('navLinks');
  const links = [...document.querySelectorAll('#navLinks a')];
  const hero = document.getElementById('top');
  const heroVideo = hero ? hero.querySelector('.hero-video') : null;
  const heroHead = hero ? hero.querySelector('.hero-head') : null;
  const progressWrap = document.getElementById('scrollProgress');
  const progressFill = progressWrap ? progressWrap.querySelector('span') : null;
  const compact = matchMedia('(max-width: 860px)');

  // Sliding active pill inside the desktop floating navbar.
  const navIndicator = document.createElement('span');
  navIndicator.className = 'nav-indicator';
  navIndicator.setAttribute('aria-hidden', 'true');
  navLinksBox.prepend(navIndicator);
  navLinksBox.classList.add('has-indicator');
  let navIndicatorReady = false;

  function moveNavIndicator(a, instant) {
    if (!a || compact.matches) {
      navIndicator.style.opacity = '0';
      return;
    }
    const x = a.offsetLeft, w = a.offsetWidth;
    if (instant || !navIndicatorReady) {
      navIndicator.style.transition = 'none';
      navIndicator.style.width = `${w}px`;
      navIndicator.style.transform = `translate3d(${x}px, 0, 0)`;
      navIndicator.style.opacity = '1';
      navIndicator.offsetWidth;
      navIndicator.style.transition = '';
      navIndicatorReady = true;
    } else {
      navIndicator.style.width = `${w}px`;
      navIndicator.style.transform = `translate3d(${x}px, 0, 0)`;
      navIndicator.style.opacity = '1';
    }
  }

  let heroH = hero ? hero.offsetHeight : 0;
  let docSpan = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  let heroTouched = false;
  let queued = false;

  function measurePage() {
    heroH = hero ? hero.offsetHeight : 0;
    docSpan = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    if (current) moveNavIndicator(current, true);
    paintScroll();
  }

  function paintScroll() {
    queued = false;
    const y = scrollY;
    const pastHero = y > heroH - 80;
    nav.classList.toggle('scrolled', pastHero);
    if (progressWrap && progressFill) {
      progressWrap.classList.toggle('is-on', pastHero);
      progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, y / docSpan)).toFixed(4)})`;
    }
    // Subtle Apple depth parallax while leaving the full-bleed cover.
    if (!reduced && !pinned && heroVideo && heroHead && heroH > 0) {
      if (y <= heroH + 120) {
        const f = Math.min(1, Math.max(0, y / heroH));
        heroVideo.style.setProperty('--hero-y', `${(f * 84).toFixed(1)}px`);
        heroHead.style.transform = `translate3d(0, ${(-f * 46).toFixed(1)}px, 0)`;
        heroHead.style.opacity = (1 - f * 0.72).toFixed(3);
        heroTouched = true;
      } else if (heroTouched) {
        heroVideo.style.setProperty('--hero-y', '84px');
        heroHead.style.transform = 'translate3d(0, -46px, 0)';
        heroHead.style.opacity = '0.28';
        heroTouched = false;
      }
    }
  }

  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paintScroll); } }, { passive: true });
  let measureRaf = 0;
  const queueMeasure = () => {
    if (measureRaf) return;
    measureRaf = requestAnimationFrame(() => { measureRaf = 0; measurePage(); });
  };
  addEventListener('resize', queueMeasure, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe(document.documentElement);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueMeasure);
  paintScroll();

  // Section spy: a line 38% down the screen. The section crossing it marks its link. In the hero no
  // link is marked.
  const targets = links.map(a => ({ a, s: document.getElementById(a.getAttribute('href').slice(1)) })).filter(t => t.s);
  const hit = new Set();
  let current = null;
  function mark() {
    const t = targets.find(x => hit.has(x.s));
    const a = t ? t.a : null;
    if (a === current) return;
    links.forEach(l => { if (l === a) l.setAttribute('aria-current', 'true'); else l.removeAttribute('aria-current'); });
    current = a;
    moveNavIndicator(a, false);
  }
  const spy = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) hit.add(e.target); else hit.delete(e.target); });
    mark();
  }, { rootMargin: '-38% 0px -61% 0px' });
  targets.forEach(t => spy.observe(t.s));

  // Narrow screens: the links fold into a rounded drawer under the brand.
  function setMenu(open) {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close the section menu' : 'Open the section menu');
  }
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const open = !nav.classList.contains('open');
    setMenu(open);
    if (open) links[0].focus({ preventScroll: true });
  });
  links.forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('click', e => { if (nav.classList.contains('open') && !e.target.closest('.topnav')) setMenu(false); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); toggle.focus(); }
  });
  nav.addEventListener('focusout', e => {
    if (compact.matches && nav.classList.contains('open') && !nav.contains(e.relatedTarget)) setMenu(false);
  });
  const onCompact = () => { if (!compact.matches) setMenu(false); if (current) moveNavIndicator(current, true); };
  if (compact.addEventListener) compact.addEventListener('change', onCompact); else compact.addListener(onCompact);

  /* ---------- Result tabs with sliding Apple thumb ---------- */
  // Arrow keys, Home and End move between tabs. Without JavaScript all three tables stay visible.
  function tabset(box) {
    if (!box) return;
    const tabs = [...box.querySelectorAll('[role="tab"]')];
    if (!tabs.length) return;
    const thumb = document.createElement('span');
    thumb.className = 'seg-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    box.prepend(thumb);
    box.classList.add('has-thumb');

    let activeTab = null, thumbReady = false;
    function moveThumb(tab, instant) {
      if (!tab || innerWidth <= 734 || box.scrollWidth > box.clientWidth + 2) {
        thumb.style.opacity = '0';
        return;
      }
      const x = tab.offsetLeft, w = tab.offsetWidth;
      if (instant || !thumbReady) {
        thumb.style.transition = 'none';
        thumb.style.width = `${w}px`;
        thumb.style.transform = `translate3d(${x}px, 0, 0)`;
        thumb.style.opacity = '1';
        thumb.offsetWidth;
        thumb.style.transition = '';
        thumbReady = true;
      } else {
        thumb.style.width = `${w}px`;
        thumb.style.transform = `translate3d(${x}px, 0, 0)`;
        thumb.style.opacity = '1';
      }
    }

    function select(tab, focus, animatePanel) {
      activeTab = tab;
      tabs.forEach(t => {
        const on = t === tab;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panel.hidden = !on;
        panel.classList.remove('tab-enter');
        if (on && animatePanel && !reduced) {
          panel.offsetWidth;
          panel.classList.add('tab-enter');
        }
      });
      moveThumb(tab, !animatePanel);
      if (focus) tab.focus();
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t, false, true));
      t.addEventListener('keydown', e => {
        const n = tabs.length;
        const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n
          : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
        if (j >= 0) { e.preventDefault(); select(tabs[j], true, true); }
      });
    });
    select(tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0], false, false);
    const syncThumb = () => { if (activeTab) moveThumb(activeTab, true); };
    addEventListener('resize', syncThumb, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncThumb);
  }
  tabset(document.querySelector('.tabs'));

  /* ---------- Pointer-following studio sheen on Apple bento & speedup cards ---------- */
  if (finePointer && !reduced) {
    document.querySelectorAll('.hl-grid > li, .xcards > li').forEach(card => {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(1)}px`);
        card.style.setProperty('--my', `${(e.clientY - r.top).toFixed(1)}px`);
      }, { passive: true });
    });
  }

  /* ---------- Tabular-nums count-up on reveal ---------- */
  function runCounts(root) {
    if (reduced || pinned) return;
    root.querySelectorAll('[data-count]').forEach(el => {
      if (el.dataset.counted) return;
      el.dataset.counted = '1';
      const raw = el.dataset.count;
      const target = parseFloat(raw);
      if (!Number.isFinite(target)) return;
      const decimals = (raw.split('.')[1] || '').length;
      const dur = 920;
      const t0 = performance.now();
      function step(now) {
        const f = Math.min(1, (now - t0) / dur);
        const eased = f >= 1 ? 1 : 1 - Math.pow(2, -10 * f);
        el.textContent = (target * eased).toFixed(decimals);
        if (f < 1) requestAnimationFrame(step);
        else el.textContent = raw;
      }
      requestAnimationFrame(step);
    });
  }

  /* ---------- Scroll reveal ---------- */
  // Blocks that start below the fold rise into place once as they are reached. Nothing already on
  // screen is hidden, and reduced motion or a pinned screenshot URL skips the effect.
  if (!reduced && !pinned) {
    const reveal = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      runCounts(e.target);
      reveal.unobserve(e.target);
    }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('main :is(.head, .hl-grid > li, .act-head, .act .figure, .xcards > li, .panel, #results .figure, .card, .cinema, .paper > *)').forEach(n => {
      const r = n.getBoundingClientRect();
      if (n.closest('[hidden]') || r.height === 0 || r.top < innerHeight) return;
      n.classList.add('reveal');
      reveal.observe(n);
    });
  }

  // Placeholder links until the paper is public.
  document.querySelectorAll('a[aria-disabled="true"]').forEach(a => a.addEventListener('click', e => e.preventDefault()));

  const copy = document.getElementById('copyBib');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('bibText').textContent);
      copy.textContent = 'Copied';
      copy.classList.add('done');
    } catch {
      copy.textContent = 'Select and copy';
    }
    setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('done'); }, 1600);
  });
})();
