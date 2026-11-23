(() => {
  const frames = Array.from(document.querySelectorAll('.frames a'));
  const image = document.getElementById('hockey-frame');
  const timecode = document.getElementById('timecode');
  const replayButton = document.getElementById('play-frames');
  let replayTimer;

  function selectFrame(frame) {
    image.src = frame.href;
    image.alt = frame.dataset.alt;
    timecode.textContent = frame.dataset.time;
    for (const item of frames) {
      if (item === frame) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
  }
  function stopReplay() {
    clearTimeout(replayTimer);
    replayTimer = undefined;
    replayButton.textContent = '¼ 速回放';
  }
  function playFrom(index) {
    selectFrame(frames[index]);
    const next = frames[index + 1];
    if (!next) {
      stopReplay();
      return;
    }
    const elapsed = Number(next.dataset.time) - Number(frames[index].dataset.time);
    replayTimer = setTimeout(() => playFrom(index + 1), elapsed * 4);
  }
  for (const frame of frames) {
    frame.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      stopReplay();
      selectFrame(frame);
    });
  }
  replayButton.hidden = false;
  replayButton.addEventListener('click', () => {
    if (replayTimer !== undefined) stopReplay();
    else {
      replayButton.textContent = '暂停回放';
      playFrom(0);
    }
  });

  const dialog = document.getElementById('deck');
  const launch = document.getElementById('start-talk');
  if (typeof dialog.showModal !== 'function') return;
  const slides = Array.from(dialog.querySelectorAll('.slide'));
  const stage = dialog.querySelector('.deck-stage');
  const previous = document.getElementById('deck-prev');
  const next = document.getElementById('deck-next');
  const position = document.getElementById('deck-position');
  const select = document.getElementById('deck-select');
  const reading = document.getElementById('deck-reading');
  const fullScreen = document.getElementById('deck-full');
  const figures = Array.from(dialog.querySelectorAll('[data-stage-figure]'), slot => {
    const figure = document.getElementById(slot.dataset.stageFigure);
    const marker = document.createComment('Figure in the reading view');
    figure.before(marker);
    return { slot, figure, marker };
  });
  const notes = document.getElementById('deck-notes');
  const notesButton = document.getElementById('deck-notes-button');
  const timing = document.getElementById('deck-time');
  const cues = {
    main: ['00:00–02:00', '先讲流策略的共同点：从专用操作策略到通用 VLA 和世界动作模型，它们都可以用多次去噪生成一整段动作。指着图左的一列，让听众看到每一次重规划都要从上走到底。这样的策略能生成高质量动作，却需要等多个前向传播串行完成。带着这处矛盾进入下一页。'],
    problem: ['02:00–04:00', '把三种代价讲成三句话：少算几步可能损失质量，蒸馏需要重训，激进缓存引入误差。停一下，问能否在已有流策略上同时保留多步质量和低时延。再提出一次前向内做更多计算的方向。串行依赖从哪里来、又可以放到哪里？到下一页再用重叠窗口回答。'],
    'action-path': ['04:00–07:00', '先只看窗口那一行。请听众找到动作 9，它从窗口后部逐轮走到最前。再竖着看一列，把四个噪声阶段看作同一批输入。最后读深色对角线：较早的观测打底，接近执行的观测修正。给大家几秒钟把两种读法对上。'],
    'replanning-demo': ['07:00–10:30', '先选择“初始化”，两边都要四次。切到第 1 轮，请大家指出哪六个位置保留下来、哪两个是新添的，再切到第 3 轮比较累计数。OneFlow 每轮的一次是批量调用，里面有四组候选。下一页要解释这些候选怎样保持有效。'],
    method: ['10:30–14:00', '沿图左侧走一轮，再看右侧两处。先问“同一个动作现在排在窗口的第几格”，再问“最新观测怎样修正不同噪声水平的估计”。最后指向输出：机器人执行动作块的开头，更新后的中间状态留给下一轮。完整矩阵推导留到问答。'],
    simulation: ['14:00–16:00', '先让大家看两条原生基线：一步很快，却丢掉近半数任务。再揭示 OneFlow 的 91.0%。只比较同一个 Fast-WAM 和同一套任务。这里支持的是同一模型能在一次调用下达到多步成功率，实际耗时留给后面的硬件对照。'],
    continuation: ['16:00–18:30', '先提出竞争解释：是否只要把历史观测都拿出来就行？两种控制都看同样三帧，用同样的十次前向。区别是把问题留到最后一次性重算，还是边执行边对齐、继续同一个计划。读完 54.1% 与 61.2% 就停，给大家时间把它和对角线联系起来。'],
    scaling: ['18:30–20:00', '只指最左侧的交接方块。先沿深蓝折线从左向右读成功率，再回去看同色的时延柱。追加的是一次调用里的并行工作。把“在这组硬件和预算范围内”这句话讲出来，再进入真实动作生成时间的比较。'],
    latency: ['20:00–22:00', '从最左和最右读出 30.3 倍，然后补上中间的 51.83 毫秒。让两种方法都享受引擎优化，保留下来的约 3.1 倍才回答“采样方式贡献了多少”。这三项都是 A100 上从 CPU 观测到 CPU 动作的预热中位数。'],
    field: ['22:00–24:00', '由仿真转向真实动态任务，用冰球说明一次快速接触是怎样计分的。随后让大家看六碗：需要连续完成全部操作，整轮才成功。把“快了所以全都解决了”的直觉留在这里，下一页用一个更难的近等时延对照检验。'],
    'field-control': ['24:00–26:00', '先只读 28.77 和 27.98 两个时延，请听众预测两组回击率是否接近。稍停，再读 12% 与 34%。这个对照表明仅凭中位时延无法解释全部差异，再回扣跨轮持续更新计划的机制。'],
    discussion: ['26:00–30:00', '用一分钟收束：去噪的顺序关系仍然存在，把它分摊到连续交互中，就能用最新观测完成最后的修正。第 27 分钟开放讨论。若现场安静，问“如果每轮都把 16 步全执行完，还有多少历史能复用？”需要数据时，从“阅读本节”打开目标扰动与显存结果。']
  };
  let current = 0;
  let enteredFullscreen = false;
  let readingTarget;

  slides.forEach((slide, i) => {
    select.add(new Option((i + 1) + ' · ' + slide.querySelector('h2').textContent, i));
  });
  function updateAdvanceButton() {
    const label = slides[current].querySelector('[data-answer][hidden]') ? '揭示结果' : '下一页';
    next.textContent = label;
    next.setAttribute('aria-label', label);
  }
  function advance() {
    const slide = slides[current];
    if (!slide.querySelector('[data-answer][hidden]')) {
      showSlide(current + 1);
      return;
    }
    slide.querySelectorAll('[data-answer]').forEach(item => { item.hidden = false; });
    slide.querySelectorAll('[data-question]').forEach(item => { item.hidden = true; });
    updateAdvanceButton();
  }
  function showSlide(index) {
    current = Math.max(0, Math.min(index, slides.length - 1));
    const slide = slides[current];
    slides.forEach(item => { item.hidden = item !== slide; });
    for (const { slot, figure, marker } of figures) {
      if (slide.contains(slot)) slot.append(figure);
      else if (slot.contains(figure)) marker.after(figure);
    }
    const [plannedTime, cue] = cues[slide.dataset.section];
    timing.textContent = plannedTime;
    notes.textContent = cue;
    select.value = String(current);
    position.textContent = (current + 1) + ' / ' + slides.length;
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    updateAdvanceButton();
    reading.hash = slide.dataset.section;
    stage.scrollTop = 0;
    slide.querySelector('h2').focus({ preventScroll: true });
  }

  launch.hidden = false;
  launch.addEventListener('click', () => {
    stopReplay();
    dialog.querySelectorAll('[data-answer]').forEach(item => { item.hidden = true; });
    dialog.querySelectorAll('[data-question]').forEach(item => { item.hidden = false; });
    dialog.showModal();
    document.documentElement.classList.add('presenting');
    showSlide(0);
  });
  previous.addEventListener('click', () => showSlide(current - 1));
  next.addEventListener('click', advance);
  select.addEventListener('change', () => showSlide(Number(select.value)));
  notesButton.addEventListener('click', () => {
    notes.hidden = !notes.hidden;
    notesButton.setAttribute('aria-pressed', String(!notes.hidden));
  });
  document.getElementById('deck-exit').addEventListener('click', () => dialog.close());
  reading.addEventListener('click', event => {
    event.preventDefault();
    readingTarget = document.getElementById(slides[current].dataset.section);
    dialog.close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.target.closest('input, select') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const targets = { ArrowRight: current + 1, PageDown: current + 1, ArrowLeft: current - 1, PageUp: current - 1, Home: 0, End: slides.length - 1 };
    if (Object.hasOwn(targets, event.key)) {
      event.preventDefault();
      if (event.key === 'ArrowRight' || event.key === 'PageDown') advance();
      else showSlide(targets[event.key]);
    }
  });
  dialog.addEventListener('close', () => {
    for (const { slot, figure, marker } of figures) {
      if (slot.contains(figure)) marker.after(figure);
    }
    notes.hidden = true;
    notesButton.setAttribute('aria-pressed', 'false');
    document.documentElement.classList.remove('presenting');
    if (enteredFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    enteredFullscreen = false;
    if (readingTarget) {
      const target = readingTarget;
      readingTarget = undefined;
      location.hash = target.id;
      requestAnimationFrame(() => {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start' });
      });
    }
  });
  if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
    fullScreen.hidden = false;
    fullScreen.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
          await document.documentElement.requestFullscreen();
          enteredFullscreen = true;
        }
      } catch {
        fullScreen.hidden = true;
      }
    });
    document.addEventListener('fullscreenchange', () => {
      fullScreen.textContent = document.fullscreenElement ? '离开全屏' : '全屏';
    });
  }
})();
