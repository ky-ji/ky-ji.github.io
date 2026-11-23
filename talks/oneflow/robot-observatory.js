/* Paper Fig. 1 uses a 333 ms excerpt. Fig. 5 gives actual source PTS for
   individual stills. Only the excerpt is replayed according to elapsed time. */
(() => {
  const template = document.getElementById('robot-observatory-template');
  const atlas = document.querySelector('[data-field-atlas]');
  const table = document.querySelector('.field-table');
  if (!template || !atlas || !table) return;
  const config = {
    hockey: {title:'球拍能赶上来球吗？', rule:'每个回合连续发 10 球，击回发球一侧即得分。50 回合共 500 球。', metric:'冰球回击率', row:0, times:[0,67,133,200,267,333], source:'图 1 · OneFlow+ 回击录像', units:'ms'},
    bottle: {title:'夹爪何时抓住滚动的瓶子？', rule:'每种方法评估 50 回合。抓到移动中的瓶子即算成功，放进容器是这次示例的后续动作。', metric:'成功抓取的回合占比', row:1, times:[0,1.002,9.210], source:'图 5b · 滚动瓶抓取', units:'s'},
    car: {title:'小车转向后，还在腕部相机里吗？', rule:'图中是外部视角。计分看腕部相机中小车至少部分可见的时间占比，每回合 20 秒，取 50 回合平均。', metric:'腕部相机内可见时间占比', row:2, times:[0,1.996,4.507], source:'图 5d · 跟随移动小车', units:'s'},
    conveyor: {title:'能否连续收齐六只碗？', rule:'每种方法评估 50 回合。机器人须从移动的传送带取下全部六只碗，叠成一摞才算完成。', metric:'六只碗全部叠好的回合占比', row:3, times:[0,31.500,57.800], source:'图 5c · 传送带堆叠', units:'s'}
  };
  const names = ['原生四步','原生四步＋引擎','OneFlow','OneFlow+'];
  const tasks = {};
  for (const [key, settings] of Object.entries(config)) {
    const panel = atlas.querySelector('#field-' + key);
    const row = table.tBodies[0]?.rows[settings.row];
    if (!panel || !row) return;
    const pictures = key === 'hockey'
      ? Array.from(panel.querySelectorAll('.frames a'), a => ({src:a.getAttribute('href'), alt:a.dataset.alt, caption:a.dataset.alt}))
      : Array.from(panel.querySelectorAll('.field-photos figure'), figure => {
        const image = figure.querySelector('img');
        return {src:image.getAttribute('src'), alt:image.alt, caption:figure.querySelector('figcaption').textContent};
      });
    if (pictures.length !== settings.times.length || row.cells.length !== names.length + 1) return;
    tasks[key] = {...settings, pictures, values:Array.from(row.cells).slice(1).map(cell=>cell.textContent.trim())};
  }

  const players = [];
  function mount(host, slide) {
    const root = template.content.firstElementChild.cloneNode(true);
    const el = name => root.querySelector('.ro-' + name);
    const picks = root.querySelectorAll('[data-task]');
    const ticks = el('ticks');
    const photo = el('photo');
    const play = el('play');
    const prev = el('prev');
    const next = el('next');
    let key = 'hockey', frame = 0, timer = null;
    function timeText(index) {
      const {times,units} = tasks[key];
      if (units === 'ms') return String(times[index]);
      return Number(times[index].toFixed(3)).toString();
    }
    function showFrame(index, announce) {
      frame = index;
      const {pictures, units} = tasks[key];
      const selected = pictures[index];
      photo.src = selected.src;
      photo.alt = selected.alt;
      el('clock').textContent = '+' + timeText(index) + ' ' + units;
      el('description').textContent = selected.caption;
      el('counter').textContent = (index + 1) + ' / ' + pictures.length;
      prev.disabled = index === 0;
      next.disabled = index === pictures.length - 1;
      Array.from(ticks.children).forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      if (announce) el('status').textContent = '第 ' + (index + 1) + ' 张，距首帧 ' + timeText(index) + ' ' + units + '。' + selected.caption;
    }
    function pause() {
      clearTimeout(timer);
      timer = null;
      play.setAttribute('aria-pressed', 'false');
      el('play-symbol').textContent = '▶';
      el('play-label').textContent = key === 'hockey' ? '¼ 速回放' : '逐张播放';
    }
    function advance() {
      const task = tasks[key];
      if (frame === task.pictures.length - 1) { pause(); return; }
      const duration = key === 'hockey' ? (task.times[frame + 1] - task.times[frame]) * 4 : 1600;
      timer = setTimeout(() => { showFrame(frame + 1, false); advance(); }, duration);
    }
    function selectTask(value, announce) {
      key = value;
      root.dataset.roTask = key;
      const task = tasks[key];
      pause();
      for (const button of picks) button.setAttribute('aria-pressed', String(button.dataset.task === key));
      el('source').textContent = task.source;
      el('title').textContent = task.title;
      el('rule').textContent = task.rule;
      el('metric').textContent = task.metric;
      el('timenote').textContent = key === 'hockey' ? '刻度为距首帧的毫秒数。六张实拍取自同一次回击。' : '刻度为距首帧的秒数。三张实拍按顺序等间隔展示。';
      const series = el('series');
      series.replaceChildren();
      names.forEach((name, index) => {
        const line = document.createElement('div'), term = document.createElement('dt'), number = document.createElement('dd');
        term.textContent = name;
        number.textContent = task.values[index];
        line.style.setProperty('--ro-score', task.values[index]);
        line.append(term, number);
        series.append(line);
      });
      ticks.replaceChildren();
      task.times.forEach((_, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.frame = String(index);
        button.textContent = timeText(index);
        button.setAttribute('aria-label', '第 ' + (index + 1) + ' 张，距首帧 ' + timeText(index) + ' ' + task.units);
        ticks.append(button);
      });
      showFrame(0, false);
      if (announce) el('status').textContent = task.title + ' ' + task.source + '，共 ' + task.pictures.length + ' 张选帧。';
    }
    picks.forEach(button=>button.addEventListener('click', ()=>selectTask(button.dataset.task, true)));
    ticks.addEventListener('click',event=>{
      const button = event.target.closest('[data-frame]');
      if (button) { pause(); showFrame(Number(button.dataset.frame), true); }
    });
    root.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const group = event.target.closest('.ro-picks,.ro-ticks');
      if (!group || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const choices = Array.from(group.children);
      const current = choices.indexOf(event.target);
      if (current < 0) return;
      const last = choices.length - 1;
      let destination = current;
      if (event.key === 'Home') destination = 0;
      if (event.key === 'End') destination = last;
      if (event.key === 'ArrowLeft') destination = Math.max(0, current-1);
      if (event.key === 'ArrowRight') destination = Math.min(last, current+1);
      event.preventDefault();
      event.stopPropagation();
      choices[destination].focus();
      choices[destination].click();
    });
    prev.addEventListener('click',()=>{pause(); showFrame(Math.max(0,frame-1),true);});
    next.addEventListener('click',()=>{pause(); showFrame(Math.min(tasks[key].pictures.length-1,frame+1),true);});
    play.addEventListener('click',()=>{
      if (timer !== null) { pause(); return; }
      players.forEach(player => player.pause());
      if (frame === tasks[key].pictures.length - 1) showFrame(0,false);
      play.setAttribute('aria-pressed','true');
      el('play-symbol').textContent = 'Ⅱ';
      el('play-label').textContent = '暂停';
      advance();
    });
    if (slide) {
      slide.classList.add('ro-equipped');
      const heading = slide.querySelector('.slide-head h2');
      const comparisonTitle = heading?.textContent;
      slide.addEventListener('deckstep', event => {
        const comparison = event.detail.step > 0;
        root.classList.toggle('ro-comparison', comparison);
        if (heading) heading.textContent = comparison ? comparisonTitle : '四项动态操作，在真机上怎样计分？';
        if (comparison && key !== 'hockey') selectTask('hockey', false);
      });
      new MutationObserver(()=>{if(slide.hidden) pause();}).observe(slide,{attributes:true,attributeFilter:['hidden']});
    }
    selectTask('hockey', false);
    host.replaceChildren(root);
    players.push({pause});
  }

  const reading = document.querySelector('[data-robot-observatory]');
  if (!reading) return;
  mount(reading, null);
  // The original radio picker, full-resolution frame links, and original table
  // stay available to readers, including when opening a direct task link.
  function fold(node, title) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    details.className = 'ro-original';
    summary.textContent = title;
    node.before(details);
    details.append(summary, node);
    return details;
  }
  const originals = fold(atlas,'查看原始实拍组图与冰球逐帧链接');
  fold(document.querySelector('.field-data'),'查看四项任务的完整数据与推理时延');
  function revealLinkedTask() {
    const target = document.getElementById(location.hash.slice(1));
    if (target && originals.contains(target)) originals.open = true;
  }
  window.addEventListener('hashchange',revealLinkedTask);
  revealLinkedTask();
  const projected = document.querySelector('[data-robot-observatory-slide], .s-field .s-frames');
  if (projected) {
    projected.classList.remove('s-frames');
    projected.classList.add('ro-deck-host');
    mount(projected, projected.closest('.slide'));
  }
  const stopAll = ()=>players.forEach(player=>player.pause());
  document.addEventListener('visibilitychange',()=>{if(document.hidden) stopAll();});
  document.querySelectorAll('[data-start-talk]').forEach(button=>button.addEventListener('click',stopAll));
  document.querySelector('#deck')?.addEventListener('close',stopAll);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', stopAll);
})();
