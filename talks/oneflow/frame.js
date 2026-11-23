/* ==========================================================================
   OneFlow 讲座页 · v3 外壳动效（defer 加载，放在既有脚本之后）
   只做指示与装饰，不隐藏任何正文；没有 JS 时页面照样完整可读。
   A 阅读框架：全文进度线、当前章节标记（含章内进度）、章首纸面转场的进度变量
   B 投影：识别翻页方向，给进入页打一次性标记；同步当前章节与放映进度
   hero 流线、重规划、数据重绘由各自部件负责；切页、键盘、全屏、讲者提示
   仍由既有脚本负责——这里只旁听 DOM 变化，不接管任何交互。
   ========================================================================== */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  root.classList.add('v3-js');

  /* ---------- A 阅读框架 ---------- */
  function initReading() {
    const header = document.querySelector('[data-v3-header]');
    const nav = document.querySelector('[data-v3-nav]');
    const cover = document.querySelector('.v3-cover');
    const chapters = Array.from(document.querySelectorAll('#main .chapter[id]'));
    if (!header && !chapters.length) return;

    const readBar = header ? header.querySelector('.v3-read') : null;
    const ind = nav ? nav.querySelector('.v3-nav-ind') : null;
    const indFill = ind ? ind.firstElementChild : null;
    const links = new Map(); // 章节 id → 顶栏链接
    if (nav) {
      nav.querySelectorAll('a[href^="#"]').forEach((a) => links.set(a.getAttribute('href').slice(1), a));
    }

    const enterCache = new WeakMap();
    let currentId = null; // null = 尚未测量；'' = 还在第一章之前
    let queued = false;
    let relayout = true;  // 尺寸变了：当前章节标记需要重新量位置
    let printing = false;

    /* 章首进入进度 → --v3-enter（CSS 用它压平纸缘、画出章首线与刻度）。值不变就不写。 */
    const setEnter = (chapter, value) => {
      const text = value.toFixed(3);
      if (enterCache.get(chapter) === text) return;
      enterCache.set(chapter, text);
      chapter.style.setProperty('--v3-enter', text);
    };

    /* 把标记滑到当前章节的链接下；当前章不在顶栏里（讨论、来源）时收起。 */
    const placeIndicator = (link) => {
      if (!ind) return;
      nav.classList.toggle('has-current', Boolean(link));
      if (!link) return;
      ind.style.width = link.offsetWidth + 'px';
      ind.style.transform = 'translateX(' + link.offsetLeft + 'px)';
      if (nav.scrollWidth > nav.clientWidth) {
        nav.scrollLeft = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
      }
    };

    function update() {
      queued = false;

      /* 先读 */
      const vh = window.innerHeight || root.clientHeight;
      const scrollMax = root.scrollHeight - vh;
      const y = window.scrollY;
      const headH = header ? header.offsetHeight : 0;
      const probe = headH + (vh - headH) * 0.35; // “正在读哪一章”的判定线
      const rects = chapters.map((ch) => ch.getBoundingClientRect());
      const coverBottom = cover ? cover.getBoundingClientRect().bottom : -1;
      let cur = -1;
      rects.forEach((r, i) => { if (r.top <= probe) cur = i; });
      const still = reduce.matches || printing;

      /* 后写 */
      if (readBar) {
        readBar.style.transform = 'scaleX(' + (scrollMax > 0 ? clamp01(y / scrollMax) : 0).toFixed(4) + ')';
      }
      if (header) {
        header.classList.toggle('is-scrolled', y > 2);
        header.classList.toggle('is-past-cover', coverBottom < headH + 1);
      }
      /* 0 = 章首刚从视口底边露出；1 = 章首升到视口约 38% 高处。减少动态或打印时恒为 1。 */
      rects.forEach((r, i) => setEnter(chapters[i], still ? 1 : clamp01((vh - r.top) / (vh * 0.62))));

      const chapter = cur >= 0 ? chapters[cur] : null;
      const id = chapter ? chapter.id : '';
      if (id !== currentId) {
        currentId = id;
        if (id) root.setAttribute('data-v3-chapter', id);
        else root.removeAttribute('data-v3-chapter');
        links.forEach((a, key) => {
          if (key === id) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        });
        relayout = true;
      }
      if (relayout) {
        relayout = false;
        placeIndicator(links.get(id));
      }
      if (indFill && chapter && links.has(id)) {
        const r = rects[cur];
        indFill.style.transform = 'scaleX(' + clamp01((probe - r.top) / Math.max(1, r.height)).toFixed(3) + ')';
      }
    }

    /* 每帧至多一次；窗口隐藏时 rAF 自然停摆，回到前台再补一次。 */
    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    const requestRelayout = () => { relayout = true; request(); };

    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', requestRelayout);
    window.addEventListener('load', requestRelayout);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRelayout(); });
    if (reduce.addEventListener) reduce.addEventListener('change', requestRelayout);
    window.addEventListener('beforeprint', () => { printing = true; update(); });
    window.addEventListener('afterprint', () => { printing = false; requestRelayout(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestRelayout);
    if ('ResizeObserver' in window) {
      const main = document.getElementById('main');
      if (main) new ResizeObserver(request).observe(main); // 图表、动图挂载后章节高度会变
    }

    update(); // 首帧同步量好，标记直接出现在正确位置
  }

  /* ---------- B 投影 ---------- */
  function initDeck() {
    const deck = document.getElementById('deck');
    if (!deck) return;
    const slides = Array.from(deck.querySelectorAll('.slide'));
    if (!slides.length) return;

    let last = -1;
    let timer = 0;
    function clearTransition() {
      clearTimeout(timer);
      for (const slide of slides) slide.removeAttribute('data-v3-enter');
    }

    // The existing presentation controller emits deckstep after updating the active slide.
    // An intra-slide reveal keeps the chapter chrome and page transition stationary.
    for (const [index, slide] of slides.entries()) {
      slide.addEventListener('deckstep', () => {
        if (!deck.open || slide.hidden || index === last) return;
        const direction = last < 0 ? '' : index > last ? 'fwd' : 'back';
        last = index;
        deck.dataset.v3Section = slide.dataset.theme;
        deck.style.setProperty('--v3-deck-p', ((index + 1) / slides.length).toFixed(4));
        clearTransition();
        if (!direction || deck.classList.contains('is-flow') || reduce.matches || document.hidden) return;
        slide.dataset.v3Enter = direction;
        timer = setTimeout(clearTransition, 500);
      });
    }
    deck.addEventListener('close', () => {
      last = -1;
      clearTransition();
      delete deck.dataset.v3Section;
    });

  }

  const start = () => {
    initReading();
    initDeck();
    /* 首帧绘制之后才启用过渡（frame.css §8），加载时不会有任何元素滑入。 */
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('v3-ready')));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
