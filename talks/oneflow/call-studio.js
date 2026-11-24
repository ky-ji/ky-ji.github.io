// The same pick-and-place path is executed after five deliveries. Its clock counts network calls.
(() => {
  const directory = new URL('.', document.currentScript.src);
  const end = 20, move = .84, finish = end + move;
  const stops = [4 + move, 5 + move, 6 + move, 8 + move, finish];
  const schedules = { native: [4, 8, 12, 16, 20], oneflow: [4, 5, 6, 7, 8] };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  let renderer;

  function loadScript(file) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(file, directory).href;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  function loadRenderer() {
    if (!renderer) renderer = (async () => {
      if (location.protocol === 'file:' || !window.WebGLRenderingContext || !window.DecompressionStream) return null;
      if (!window.THREE) await loadScript('arm-model/three.min.js');
      await loadScript('call-studio-scene.js');
      return window.OneFlowCallScene.load();
    })().catch(() => null);
    return renderer;
  }

  function element(tag, cls, text) {
    const node = document.createElement(tag);
    node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  // The miniature trajectories use the project page's deterministic noise-to-signal blend.
  function trace(level) {
    const z = 1 - level / 4;
    const points = Array.from({length: 25}, (_, q) => {
      const a = q / 4;
      const signal = .5 + .27 * Math.sin(a * .78 + .6) + .11 * Math.sin(a * 1.93 + 1.4);
      const hash = Math.sin(3 * 127.1 + q * 311.7 + 12.9898) * 43758.5453;
      const noise = .06 + .88 * (hash - Math.floor(hash));
      return (q * 2.5) + ',' + (2 + 13 * (1 - (signal * (1-z) + noise * z))).toFixed(2);
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox','0 0 60 17');
    svg.setAttribute('preserveAspectRatio','none');
    svg.setAttribute('aria-hidden','true');
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points',points.join(' '));
    svg.append(line);
    return svg;
  }

  function makeLane(container) {
    const times = schedules[container.dataset.sampler];
    const robot = container.querySelector('.cs-robot');
    const canvas = element('canvas','cs-live');
    canvas.setAttribute('aria-hidden','true');
    robot.append(canvas);
    const workspace = element('div','cs-workspace');
    const levels = element('div','cs-levels');
    const status = element('p','cs-phase','初始化');
    const list = element('div','cs-strips');
    const phases = Array.from({length:4}, (_, i) => {
      const row = element('div','cs-strip');
      const from = element('span','cs-index','t' + '₀₁₂₃'[i] + '→t' + '₁₂₃₄'[i]);
      const sample = element('i','cs-trace');
      sample.append(trace(i+1));
      row.append(from,sample);
      list.append(row);
      return row;
    });
    list.setAttribute('aria-hidden','true');
    levels.append(status,list);
    robot.before(workspace);
    workspace.append(levels,robot);
    const tape = container.querySelector('.cs-tape');
    const cursor = element('b','cs-tape-head');
    tape.append(cursor);
    const receipts = Array.from(tape.querySelectorAll('i'));
    receipts.forEach((mark,i) => mark.style.left = times[i] / end * 100 + '%');
    const ticks = element('div','cs-ticks');
    ticks.setAttribute('aria-hidden','true');
    [0,4,8,12,16,20].forEach(n=>ticks.append(element('span','',String(n))));
    tape.after(ticks);
    return {container, times, robot, canvas, status, phases, tape, cursor, receipts,
      chunks:container.querySelector('[data-chunks]'), count:-1, pass:-1, lastPose:-1, lastView:'', lastFrame:-1};
  }

  for (const studio of document.querySelectorAll('[data-call-studio]')) {
    const slide = studio.closest('.slide');
    const player = studio.querySelector('.cs-player');
    const range = player.querySelector('input');
    range.step = '.01';
    const toggle = player.querySelector('[data-cs-play]');
    const count = player.querySelector('[data-cs-count]');
    const lanes = Array.from(studio.querySelectorAll('[data-sampler]'), makeLane);
    const camera = element('div','cs-cameras');
    camera.setAttribute('role','group');
    camera.setAttribute('aria-label','两个机械臂的同步镜头');
    const buttons = ['全景','夹爪特写'].map((text,i) => {
      const button = element('button','',text);
      button.type = 'button';
      button.dataset.view = ['studio','detail'][i];
      camera.append(button);
      return button;
    });
    const sceneGrid = studio.querySelector('.cs-scenes');
    const bar = element('div','cs-scene-bar');
    bar.append(element('span','cs-scene-label','Panda · 方块取放'),camera);
    sceneGrid.before(bar);
    let tick = stops[0], playing = false, used = false, visible = false;
    let view = 'studio', renderModel = null, requested = false;
    let zoom = 0, lens = null, lensFrame = 0;
    let raf = 0, previous = null, transition = null, clockRead = -1, lastStep = -1;

    const hiddenFromAudience = () => document.hidden || !!studio.closest('[hidden]') ||
      (slide ? !slide.closest('dialog').open : document.documentElement.classList.contains('presenting'));
    function restCamera() {
      cancelAnimationFrame(lensFrame);
      if (lens) zoom=lens.to;
      lens=null;
    }
    function pose(lane, progress) {
      const frame = Math.round(progress / 11 * 99);
      if (frame !== lane.lastFrame) {
        lane.robot.style.setProperty('--sprite-x', (frame % 10) * 100 / 9 + '%');
        lane.robot.style.setProperty('--sprite-y', Math.floor(frame / 10) * 100 / 9 + '%');
        lane.lastFrame = frame;
      }
      if (!visible || hiddenFromAudience() || !renderModel || (lane.lastView === zoom && Math.abs(lane.lastPose-progress)<.0001)) return;
      const width=lane.robot.clientWidth, height=lane.robot.clientHeight;
      if (!width || !height) return;
      const scale = Math.min(2, devicePixelRatio || 1, 800/width, 560/height);
      const w=Math.max(2, Math.round(width*scale)), h=Math.max(2,Math.round(height*scale));
      if (lane.canvas.width!==w || lane.canvas.height!==h) {
        lane.canvas.width=w;lane.canvas.height=h;
      }
      try {
        if (!renderModel(lane.canvas, progress,zoom)) throw Error('Context lost');
        lane.robot.classList.add('cs-live-ready');
        lane.lastView=zoom;lane.lastPose=progress;
      } catch {
        renderModel=null;
        for(const item of lanes) item.robot.classList.remove('cs-live-ready');
      }
    }

    function paint(time) {
      tick = clamp(time,0,finish);
      if (lens) {
        const t=clamp((performance.now()-lens.start)/380);
        zoom=lens.from+(lens.to-lens.from)*t*t*(3-2*t);
        if (t===1) lens=null;
      }
      const logical = Math.min(end,tick), call = Math.floor(logical + .000001);
      range.value = String(logical);
      if (call !== clockRead) {
        clockRead=call;
        count.textContent = call+' / '+end;
        range.setAttribute('aria-valuetext','已完成 '+call+' 次网络调用');
      }
      for (const lane of lanes) {
        const n = lane.times.filter(t => t <= tick).length;
        const p = n ? n-1 + clamp((tick-lane.times[n-1])/move) : 0;
        pose(lane,p*11/5);
        const activeCall = Math.min(logical,lane.times[4]);
        const batch = lane.container.dataset.sampler==='oneflow' && tick>=4;
        const done = n===5;
        const phase = call % 4;
        if (n !== lane.count) {
          lane.chunks.textContent=String(n);
          lane.receipts.forEach((mark,i)=>mark.classList.toggle('is-ready',i<n));
          lane.count=n;
        }
        if (call !== lane.pass) {
          lane.status.textContent = done ? '五段已就绪' : batch ? '四阶段并行' : tick<4 && lane.container.dataset.sampler==='oneflow' ? '初始化 · '+(phase+1)+'/4' : '串行 · '+(phase+1)+'/4';
          lane.phases.forEach((row,i)=>{
            row.classList.toggle('is-active',!done && (batch || i===phase));
            row.classList.toggle('is-done',done || (!batch && i<phase));
          });
          lane.pass=call;
        }
        lane.container.style.setProperty('--cs-fraction', String(logical % 1));
        lane.tape.style.setProperty('--cs-used',activeCall/end*100+'%');
        lane.cursor.style.left=activeCall/end*100+'%';
      }
    }

    function stop() {
      cancelAnimationFrame(raf); raf=0; previous=null; transition=null; playing=false;
      toggle.textContent=tick>=finish?'重播':'播放';
      toggle.setAttribute('aria-pressed','false');
    }
    function advance(now) {
      if (!visible || hiddenFromAudience()) {stop();restCamera();return;}
      if (transition) {
        if (transition.start===null) transition.start=now;
        const u=clamp((now-transition.start)/transition.duration);
        paint(transition.from+(transition.to-transition.from)*u);
        if (u>=1) {stop();return;}
      } else if (playing) {
        if (previous!==null) paint(tick+Math.min(now-previous,120)/520);
        if (tick>=finish) {stop();return;}
      } else return;
      previous=now; raf=requestAnimationFrame(advance);
    }
    function play() {
      used=true; stop();
      if (tick>=finish) paint(0);
      playing=true; toggle.textContent='暂停'; toggle.setAttribute('aria-pressed','true');
      raf=requestAnimationFrame(advance);
    }
    function moveCamera() {
      if (!lens) return;
      if (!visible || hiddenFromAudience() || reduce.matches) {
        zoom=lens.to; lens=null;
        paint(tick);
        return;
      }
      // Playback already paints every frame. A paused clock still allows a camera move.
      if (!playing && !transition) paint(tick);
      if (lens) lensFrame=requestAnimationFrame(moveCamera);
    }
    function selectCamera(value) {
      const destination=Number(value==='detail');
      cancelAnimationFrame(lensFrame);
      if (renderModel && visible && !reduce.matches && zoom!==destination) {
        lens={from:zoom,to:destination,start:performance.now()};
      } else {lens=null; zoom=destination;}
      view=value;studio.dataset.csView=view;
      for (const button of buttons) button.setAttribute('aria-pressed',String(button.dataset.view===view));
      paint(tick);
      if (lens) lensFrame=requestAnimationFrame(moveCamera);
    }
    buttons.forEach(b=>b.addEventListener('click',()=>selectCamera(b.dataset.view)));
    toggle.addEventListener('click',()=>playing?stop():play());
    range.addEventListener('input',()=>{
      used=true; stop();
      const t=Number(range.value);
      paint(t===end?finish:t); stop();
    });
    // Keyboard users move by completed calls; the pointer can scrub their fractional progress.
    range.addEventListener('keydown',e=>{
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !['ArrowLeft','ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const next=e.key==='ArrowLeft'?Math.ceil(Number(range.value))-1:Math.floor(Number(range.value))+1;
      range.value=String(clamp(next,0,end));
      range.dispatchEvent(new Event('input',{bubbles:true}));
    });
    player.querySelector('[data-cs-reset]').addEventListener('click',()=>{used=true;stop();paint(0);stop();});
    slide?.addEventListener('deckstep',e=>{
      if (hiddenFromAudience()) {stop();restCamera();lastStep=-1;return;}
      const step=clamp(e.detail.step,0,stops.length-1),to=stops[step];
      stop();
      if (lastStep<0 || step===0 || !visible || reduce.matches) paint(to);
      else {
        transition={from:tick,to,start:null,duration:clamp(Math.abs(to-tick)*240,380,1850)};
        raf=requestAnimationFrame(advance);
      }
      lastStep=step;
    });
    function entering(on) {
      visible=on;
      if (!on){stop();restCamera();lastStep=-1;return;}
      if (!requested) {
        requested=true;
        loadRenderer().then(draw=>{renderModel=draw;paint(tick);});
      }
      paint(tick);
      if (!slide&&!used&&!reduce.matches&&!document.hidden&&!document.querySelector('#deck[open]')) {paint(0);play();}
    }
    const slot=studio.closest('[data-clone="call-studio"]');
    if (slot) new MutationObserver(()=>{
      if (slot.hidden) entering(false);
    }).observe(slot,{attributes:true,attributeFilter:['hidden']});
    if ('IntersectionObserver' in window) new IntersectionObserver(([entry])=>entering(entry.isIntersecting),{threshold:0}).observe(studio);
    else entering(true);
    if ('ResizeObserver' in window) new ResizeObserver(()=>{lanes.forEach(l=>{l.lastPose=-1;});paint(tick);}).observe(sceneGrid);
    window.addEventListener('oneflow:arm-context-lost',()=>{renderModel=null;lanes.forEach(l=>l.robot.classList.remove('cs-live-ready'));});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();restCamera();}});
    document.querySelector('#deck')?.addEventListener('close',stop);
    document.querySelectorAll('[data-start-talk]').forEach(b=>b.addEventListener('click',stop));
    reduce.addEventListener?.('change',()=>{if(reduce.matches)stop();});
    studio.classList.add('cs-enhanced'); selectCamera('studio'); stop(); player.hidden=false;
  }
})();
