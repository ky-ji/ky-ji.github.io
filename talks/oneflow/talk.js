(() => {
  /* Reading view: mark the chapter that is on screen in the masthead. */
  const links = Array.from(document.querySelectorAll('.contents a[href^="#"]'));
  const chapters = links.map(link => document.getElementById(link.hash.slice(1))).filter(Boolean);
  if ('IntersectionObserver' in window && chapters.length) {
    const spy = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links) {
          if (link.hash === '#' + entry.target.id) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        }
      }
    }, { rootMargin: '-40% 0px -55% 0px' });
    chapters.forEach(chapter => spy.observe(chapter));
  }

  // A direct link can target a policy table or a task inside a collapsed panel.
  function openLinkedPanel() {
    const target = document.getElementById(location.hash.slice(1));
    const panel = target?.closest('.res-panel, .field-case');
    if (!panel?.hidden) return;
    const input = document.querySelector('input[aria-controls="' + CSS.escape(panel.id) + '"]');
    if (!input) return;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    target.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('pageshow', openLinkedPanel);
  window.addEventListener('hashchange', openLinkedPanel);

  /* Presentation mode. */
  const dialog = document.getElementById('deck');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  const slides = Array.from(dialog.querySelectorAll('.slide'));
  const stage = dialog.querySelector('.deck-stage');
  const canvas = dialog.querySelector('.deck-canvas');
  const previous = document.getElementById('deck-prev');
  const next = document.getElementById('deck-next');
  const position = document.getElementById('deck-position');
  const select = document.getElementById('deck-select');
  const reading = document.getElementById('deck-reading');
  const fullScreen = document.getElementById('deck-full');
  const notes = document.getElementById('deck-notes');
  const notesButton = document.getElementById('deck-notes-button');
  const timing = document.getElementById('deck-time');
  const clock = document.getElementById('deck-clock');
  const progress = document.getElementById('deck-progress');

  /* Suggested time and speaker cue for each page, keyed by data-section. */
  const cues = {
    "main": ["00:00–01:00", "机器人刚收到一次观测。要把这条新信息变成动作，还要等多久？看图左侧原生采样的那一列。从噪声出发，网络先预测一次速度，更新动作估计，再把更新后的估计交给下一步。沿箭头走到底，才得到这次观测下可以执行的动作块。在物体移动或接触状态变化时，观测与响应之间的这段时间格外重要。如果缩短这条计算链，动作质量会怎样？"],
    "problem": ["01:00–03:00", "从专用流策略到部分视觉语言动作模型和世界动作模型，许多预训练策略都通过多步去噪生成一段动作。沿左边的原生十步读，每增加一格，就多等一次串行网络调用。现在揭示同一个 Fast-WAM 的测试结果：从十步减到一步，50 项任务的平均成功率从 89.4% 降到 40.8%。这里先看任务表现，毫秒数稍后在同一硬件上比较。还有哪些办法能缩短机器人等待新动作的时间？"],
    "question": ["03:00–05:30", "先看三条已有的路。少步求解能减少网络调用，步数很少时，离散化误差可能影响任务成功率。蒸馏可把多步压缩到少数几次前向，但需要针对具体策略训练。缓存中间特征或动作状态也能节省计算，复用过多则会引入近似误差。请翻出研究问题，停一下。我们的出发点是固定预训练策略的权重，在一次前向里并行求多个阶段的速度。要做到这一点，调用网络之前就得备齐各阶段的输入。从哪里找？请看动作 9。"],
    "action-path": ["05:30–08:30", "先看左图的动作 9。机器人执行第 3、4 步后，新的窗口从第 5 步开始，动作 9 从第 7 格移到第 5 格。每按一次键多显示一轮，接下来是第 3、第 1 格。动作 9 指同一个执行时刻，届时发什么指令可以逐轮修正。现在看右图：一列是同一次重规划，四个噪声阶段共用新观测。沿橙色对角线读，才是跨轮传递的一条修正路径。接下来逐轮数网络调用。"],
    "replanning-demo": ["08:30–11:30", "先选“初始化”。历史估计为空，原生采样和 OneFlow 都要串行调用四次网络。OneFlow 留下每个阶段的中间状态。依次推进四轮，原生累计调用升到 20 次，OneFlow 升到 8 次。请听众指出新进入窗口的两格。每轮只加一，是因为四个候选可以共用新观测，在同一批次里求速度。批次里确实还有四个候选，实际时延要靠后面的计时实验回答。"],
    "mechanics": ["11:30–15:30", "接着刚才四个阶段的例子。机器人向前走了两步，先把各段动作和对应的源噪声一起前移。补齐末尾时，要先扣除旧的噪声分量，把末端余量延伸到新增位置，再按各阶段的噪声水平加上同一份新噪声。四个对齐后的候选共用最新观测，在一个批次里预测速度、估计各自的终点，再用预先算好的权重重建各阶段。机器人只执行最终动作段的前两步，其余中间状态还会参与下一轮规划。为什么不能只更新最后的动作？在 Google Robot 的变体聚合测试中，Xiaomi Robotics 0 采用完整方法时成功率为 75.9%，只更新输出端时降到 8.7%。下一步，我们把完整方法放回一个多步采样本来就很强的策略里，看它能保留多少任务表现。"],
    "simulation": ["15:30–17:30", "这里看 RoboTwin 2.0 的全部 50 项任务。每项任务有 100 个标准场景和 100 个随机化场景，每种采样配置一共跑 10,000 个回合。刚才看到，直接把十步压成一步，平均成功率从 89.4% 掉到 40.8%。现在把十个去噪阶段保留下来，每轮只做一次批量前向。可以先猜一下结果。（停顿）OneFlow 是 91.0%，加上执行引擎是 91.1%。这两个百分比表示测试回合中完成任务的比例。为什么跨轮更新能够保留这样的表现？接下来的对照把观测、噪声和前向传播次数都固定下来，专门考察中间预测该不该留下。"],
    "continuation": ["17:30–19:30", "这里换到用状态作为输入的流匹配策略。两组原生采样使用配对的源噪声，最早一次观测用三步，接着一次用四步，当前观测再用三步。第一组等到当前轮次才开始，一次取出三份观测记录，把十步全部从头算完。第二组提前两轮开始。机器人每执行四步，就把尚未完成的动作段向前对齐，在新观测下继续计算。稳态时，两组每轮都调用网络十次。平均成功率从 54.1% 到 61.2%，说明在这些任务上，让新观测继续修正同一批未来动作确实有用。作为参照，OneFlow 每轮一次批量前向达到 60.0%。接下来把批次里的阶段数逐渐加大，看看成功率和等待时间各自怎么变。"],
    "scaling": ["19:30–21:00", "这次只看 Handover Block，也就是交接方块。每个设置评测 25 个标准场景和 25 个随机化场景，两种方法都关闭执行引擎。看图上选出的四个阶段数，分别是 1、2、5、10。OneFlow 的成功率依次是 18%、52%、84%、88%。再看时延，1 个阶段是 126.2 毫秒，10 个阶段是 123.1 毫秒。同样增加到 10 个阶段，原生采样要逐步等待，时延从 122.2 毫秒增到 469.2 毫秒。所以在这个任务和这块 GPU 上，把更多阶段放进一次调用，能改善动作质量，而每轮的等待时间变化很小。到这里我们看到的是采样方式的作用。再把执行引擎接上，实际生成一段动作还要等多久？"],
    "latency": ["21:00–23:00", "先读未优化的原生十步与 OneFlow+：503.53 对 16.62 毫秒。论文的 30.3 倍同时包含采样方式和执行引擎的收益。按键揭示同一引擎下的十步基线，51.83 毫秒，约为 OneFlow+ 的 3.1 倍。再揭示一步基线：14.80 毫秒。保留十个阶段，比原生一步多等 1.82 毫秒，约 12.3%。这些数字都从 CPU 观测计到解码后的 CPU 动作，取 A100 预热后的中位数。换到真实机械臂上，这种变化意味着什么？"],
    "field": ["23:00–26:00", "冰球每回合连续来 10 个，50 回合共 500 球。看接触前后这几帧，从原生四步换到 OneFlow+，回击率从 6% 到 66%。现在按键，只看中间两组的时延：28.77 和 27.98 毫秒。请听众猜两组回击率是否接近，停一拍，再揭示 12% 和 34%。这里计的是 RTX 4090 上的模型推理。中位数接近的两种配置仍有不同回击率，仅凭这组对照无法把差异归给单一原因。"],
    "discussion": ["26:00–30:00", "用最后一分钟回到开场：相邻的规划窗口重叠，使不同噪声阶段可以共用一次批量前向传播。论文中这保留了多步采样的任务表现。每个回合仍需初始化，GPU 也要容得下并行候选。27:00 开放提问，留到 30:00。如果有人问目标突然移动会怎样，指向左图：目标架平移 8 厘米后，OneFlow 的放置成功率由 88.0% 降至 66.0%，原生十步由 86.7% 降至 57.3%。"]
  };

  /* Figures drawn once in the reading view are cloned into their slides. */
  for (const slot of dialog.querySelectorAll('[data-clone]')) {
    const source = document.getElementById(slot.dataset.clone);
    if (!source) continue;
    const copy = source.cloneNode(true);
    for (const node of [copy, ...copy.querySelectorAll('[id], [aria-labelledby], [aria-controls]')]) {
      node.removeAttribute('id');
      node.removeAttribute('aria-labelledby');
      node.removeAttribute('aria-controls');
    }
    slot.append(copy);
  }

  const steps = slides.map(() => 0);
  let current = 0;
  let enteredFullscreen = false;
  let readingTarget;
  let startedAt = 0;
  let clockTimer;

  slides.forEach((slide, index) => {
    select.add(new Option((index + 1) + ' · ' + slide.dataset.title, index));
    progress.append(document.createElement('i'));
  });
  const ticks = Array.from(progress.children);

  function maxStep(slide) {
    let max = Number(slide.dataset.steps || 0);
    slide.querySelectorAll('[data-step]').forEach(node => { max = Math.max(max, Number(node.dataset.step)); });
    slide.querySelectorAll('[data-until]').forEach(node => { max = Math.max(max, Number(node.dataset.until)); });
    return max;
  }
  function updateControls() {
    const pending = steps[current] < maxStep(slides[current]);
    const label = pending ? '下一步' : '下一页';
    next.textContent = label;
    next.setAttribute('aria-label', label);
    next.disabled = !pending && current === slides.length - 1;
    previous.disabled = current === 0 && steps[current] === 0;
  }
  function applyStep() {
    const slide = slides[current];
    const step = steps[current];
    slide.querySelectorAll('[data-step]').forEach(node => {
      node.classList.toggle('is-pending', Number(node.dataset.step) > step);
    });
    slide.querySelectorAll('[data-until]').forEach(node => {
      node.classList.toggle('is-gone', step >= Number(node.dataset.until));
    });
    slide.dataset.at = String(step);
    slide.dispatchEvent(new CustomEvent('deckstep', { detail: { step } }));
    updateControls();
  }
  function renderNotes() {
    const slide = slides[current];
    const [time, cue] = cues[slide.dataset.section] || ['', ''];
    timing.textContent = '本页 ' + time;
    const meta = document.createElement('p');
    meta.className = 'notes-meta';
    meta.textContent = '第 ' + (current + 1) + ' 页 · 建议时间 ' + time;
    const body = document.createElement('p');
    body.textContent = cue;
    const after = document.createElement('p');
    after.className = 'notes-next';
    after.textContent = slides[current + 1] ? '下一页：' + slides[current + 1].dataset.title : '27:00–30:00 · 现场问答';
    notes.replaceChildren(meta, body, after);
  }
  function showSlide(index, revealed) {
    current = Math.max(0, Math.min(index, slides.length - 1));
    const slide = slides[current];
    steps[current] = revealed ? maxStep(slide) : 0;
    slides.forEach(item => { item.hidden = item !== slide; });
    ticks.forEach((tick, i) => {
      tick.classList.toggle('is-done', i < current);
      tick.classList.toggle('is-now', i === current);
    });
    select.value = String(current);
    position.textContent = (current + 1) + ' / ' + slides.length;
    reading.hash = slide.dataset.section;
    renderNotes();
    applyStep();
    stage.scrollTop = 0;
    slide.querySelector('h2').focus({ preventScroll: true });
  }
  function forward() {
    if (steps[current] < maxStep(slides[current])) {
      steps[current] += 1;
      applyStep();
    } else if (current < slides.length - 1) showSlide(current + 1, false);
  }
  function back() {
    if (steps[current] > 0) {
      steps[current] -= 1;
      applyStep();
    } else if (current > 0) showSlide(current - 1, true);
  }

  /* Fit the 1280 × 720 canvas to the stage, or reflow on narrow screens. */
  function fit() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    const flow = width < 820;
    dialog.classList.toggle('is-flow', flow);
    canvas.style.setProperty('--deck-scale', flow ? '1' : String(Math.min(width / 1280, height / 720)));
  }
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stage);
  window.addEventListener('resize', fit);

  function tick() {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    clock.textContent = '已用 ' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function toggleNotes() {
    notes.hidden = !notes.hidden;
    notesButton.setAttribute('aria-pressed', String(!notes.hidden));
    fit();
  }
  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        enteredFullscreen = true;
      }
    } catch {
      fullScreen.hidden = true;
    }
  }
  function openDeck() {
    if (dialog.open) return;
    dialog.showModal();
    document.documentElement.classList.add('presenting');
    startedAt = Date.now();
    tick();
    clockTimer = setInterval(tick, 1000);
    fit();
    showSlide(0, false);
  }

  for (const launcher of document.querySelectorAll('[data-start-talk]')) {
    launcher.hidden = false;
    launcher.addEventListener('click', openDeck);
  }
  for (const hint of document.querySelectorAll('[data-talk-hint]')) hint.hidden = false;

  previous.addEventListener('click', back);
  next.addEventListener('click', forward);
  select.addEventListener('change', () => showSlide(Number(select.value), false));
  notesButton.addEventListener('click', toggleNotes);
  document.getElementById('deck-exit').addEventListener('click', () => dialog.close());
  reading.addEventListener('click', event => {
    event.preventDefault();
    readingTarget = document.getElementById(slides[current].dataset.section);
    dialog.close();
  });
  /* A figure inside the current slide may choose a step itself (round tabs). */
  dialog.addEventListener('stepselect', event => {
    const slide = slides[current];
    if (!slide.contains(event.target)) return;
    steps[current] = Math.max(0, Math.min(Number(event.detail.step), maxStep(slide)));
    applyStep();
  });
  dialog.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target.closest('select, input, textarea')) return;
    const onControl = Boolean(target.closest('button, a, summary'));
    const key = event.key;
    if (key === 'ArrowRight' || key === 'PageDown' || ((key === ' ' || key === 'Enter') && !onControl && !event.shiftKey)) {
      event.preventDefault();
      forward();
    } else if (key === 'ArrowLeft' || key === 'PageUp' || ((key === 'Backspace' || (key === ' ' && event.shiftKey)) && !onControl)) {
      event.preventDefault();
      back();
    } else if (key === 'Home') {
      event.preventDefault();
      showSlide(0, false);
    } else if (key === 'End') {
      event.preventDefault();
      showSlide(slides.length - 1, false);
    } else if (key === 'n' || key === 'N') {
      toggleNotes();
    } else if ((key === 'f' || key === 'F') && !fullScreen.hidden) {
      toggleFull();
    }
  });
  dialog.addEventListener('close', () => {
    clearInterval(clockTimer);
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
    fullScreen.addEventListener('click', toggleFull);
    document.addEventListener('fullscreenchange', () => {
      fullScreen.textContent = document.fullscreenElement ? '离开全屏' : '全屏';
    });
  }
})();
