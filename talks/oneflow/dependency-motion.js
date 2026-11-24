/* The node trajectories, moving input outline and closing trace follow the
   OneFlow project site's fig-dependency.js. This version compares call counts. */
(() => {
  const root = document.getElementById('cover-sched');
  const tools = window.OneFlowProjectMotion;
  if (!root || !tools) return;
  const {C, el, attr, text, defs, level, signal, blend, waveInk, passRing, march, flow} = tools;
  const N = 4, rounds = 5, end = N * rounds, duration = end + 2.5;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = t => Math.max(0, Math.min(1,t));
  const smooth = t => {const s=clamp(t); return s*s*(3-2*s);};
  const x = k => 56 + k * 64, y = i => 48 + i * 43;
  const plate = document.createElement('div');
  plate.className = 'dependency-motion';
  plate.innerHTML = `<div class="dp-pair"></div>
    <div class="dp-controls"><button type="button" data-dp-play>播放</button>
    <label><span>网络调用次序</span><input type="range" min="0" max="${duration}" step=".02" aria-label="拖动比较原生采样和 OneFlow 的调用顺序"></label>
    <button type="button" data-dp-trace>看依赖路径</button></div>`;
  const caption = root.querySelector('figcaption');

  function panel(batched) {
    const section = document.createElement('section');
    section.className = 'dp-panel';
    section.innerHTML = `<header><strong>${batched?'OneFlow':'原生采样'}</strong><span>${batched?'稳态每轮一次批量前向':'每轮四次串行前向'}</span></header>
      <div class="dp-counters"><span>已完成 <b data-passes>0</b> 次调用</span><span>已交付 <b data-outputs>0</b> / 5 段</span></div>`;
    plate.querySelector('.dp-pair').append(section);
    const passes = section.querySelector('[data-passes]'), outputs = section.querySelector('[data-outputs]');
    const canvas = el('svg',{viewBox:'0 0 348 248',role:'img','aria-label':batched?'初始化后多个阶段的输入来自上一轮；最后高亮跨轮的对角路径。':'原生采样在每一轮内依次经过四个阶段；最后高亮一列中的竖向路径。'});
    section.insertBefore(canvas,section.lastElementChild);
    const D = defs(canvas);
    const jobs=[], arrows=[], nodes=[];
    const edges=el('g',{},canvas), dots=el('g',{},canvas);
    for(let k=0;k<rounds;k++){
      text(canvas,x(k),17,'第'+(k+1)+'轮',{'text-anchor':'middle',class:'dp-col'});
      if(batched&&k) jobs.push({k, from:0,to:N,batch:true});
      else for(let i=0;i<N;i++) jobs.push({k,from:i,to:i+1,batch:false});
    }
    // One pip represents one network call. Wider gaps separate replanning rounds.
    const tape = document.createElement('div');
    tape.className = 'dp-tape';
    tape.setAttribute('aria-hidden', 'true');
    section.querySelector('.dp-counters').before(tape);
    const pips = jobs.map((job, index) => {
      const pip = document.createElement('i');
      if (index && job.k !== jobs[index - 1].k) pip.className = 'dp-new-round';
      tape.append(pip);
      return pip;
    });
    for(let i=0;i<=N;i++) text(canvas,25,y(i)+4,['噪声','t₁','t₂','t₃','动作'][i],{'text-anchor':'middle',class:'dp-axis'});
    function edge(k1,i1,k2,i2,j,kind,order=0){
      const dx=x(k2)-x(k1),dy=y(i2)-y(i1),len=Math.hypot(dx,dy);
      const a=x(k1)+dx*13/len,b=y(i1)+dy*13/len,c=x(k2)-dx*15/len,d=y(i2)-dy*15/len;
      const cross=kind==='cross', scan=kind==='scan';
      const line=el('line',{x1:a,y1:b,x2:c,y2:d,stroke:cross?C.blue:C.faint,'stroke-width':cross?1.9:1.5,'stroke-dasharray':scan?'3 3':null,'marker-end':cross?D.heads.blue:D.heads.gray},edges);
      arrows.push({line,j,scan,order,cross,run:scan?null:flow(dots,2,cross?C.blue:C.deep),a,b,c,d});
    }
    jobs.forEach((job,j)=>{
      if(!job.batch) {edge(job.k,job.from,job.k,job.to,j,'native');return;}
      edge(job.k-1,0,job.k,0,j,'cross');
      for(let i=0;i<N;i++){
        edge(job.k-1,i,job.k,i+1,j,'cross');
        edge(job.k,i,job.k,i+1,j,'scan',i);
      }
    });
    const path=el('path',{fill:'none',stroke:batched?C.blue:C.ink,'stroke-width':29,'stroke-linecap':'round','stroke-opacity':.23},canvas);
    for(let k=0;k<rounds;k++) for(let i=0;i<=N;i++){
      const z=1-i/N, group=el('g',{},canvas);
      const r=el('rect',{x:x(k)-10.8,y:y(i)-10.8,width:21.6,height:21.6,rx:3.3,fill:level(i,N)},group);
      el('rect',{x:x(k)-10.8,y:y(i)-10.8,width:21.6,height:21.6,rx:3.3,fill:D.noise,opacity:z*.8},group);
      const coordinates=Array.from({length:9},(_,n)=>{
        const a=k*2+n*7/8;
        return (x(k)-8+n*2).toFixed(1)+','+(y(i)+6-12*blend(signal(a),z,a,batched?0:k+1)).toFixed(1);
      });
      el('path',{d:'M'+coordinates.join(' L'),fill:'none',stroke:i===N?'white':waveInk(z),'stroke-width':1.45,'stroke-linejoin':'round'},group);
      const opening=jobs.findIndex(job=>job.k===k);
      const ready = batched && k > 0 ? opening + 1 : opening + i;
      nodes.push({group,r,i,k,ready});
    }
    const ring=passRing(canvas,D,{rx:5,'stroke-width':2.2});
    return time=>{
      const count=Math.min(Math.floor(time),jobs.length);
      const active=jobs[count];
      pips.forEach((pip, index) => {
        const fill = Math.round(clamp(time - index) * 100) + '%';
        if (pip.style.getPropertyValue('--done') !== fill) pip.style.setProperty('--done', fill);
      });
      passes.textContent=String(count);
      outputs.textContent=String(jobs.slice(0,count).filter(j=>j.to===N).length);
      const dim=smooth((time-end)/.65), trace=smooth((time-end-.15)/1.4);
      const sx=x(batched?0:2), sy=y(0), ex=x(batched?4:2), ey=y(N);
      attr(path,'d','M'+sx+' '+sy+' L'+(sx+(ex-sx)*trace)+' '+(sy+(ey-sy)*trace));
      attr(path,'opacity',trace);
      for(const n of nodes){
        const seen=smooth((time-n.ready+.04)/.24);
        const onPath=batched?n.i===n.k:n.k===2;
        attr(n.group,'opacity',((.17+.83*seen)*(onPath?1:1-.67*dim)).toFixed(2));
        if(n.i===N) attr(n.r,'fill',seen>.5?C.exec:level(n.i,N));
      }
      if(active){
        const k=active.k-(active.batch?1:0), i=active.batch?0:active.from;
        attr(ring,'x',x(k)-15);attr(ring,'y',y(i)-15);attr(ring,'width',30);
        attr(ring,'height',active.batch?30+(N-1)*43:30);
        attr(ring,'opacity',1);march(ring,time,16);
      }else attr(ring,'opacity',0);
      for(const e of arrows){
        const phase=time-e.j;
        const started = smooth((phase - (e.scan ? .55 + .09 * e.order : 0)) / .22);
        attr(e.line,'opacity',((.12+.78*started)*(1-.65*dim)).toFixed(2));
        if (e.run) {
          const stop = e.cross ? .65 : 1;
          const opacity = clamp(Math.min(phase / .15, (stop - phase) / .15));
          e.run(e.a, e.b, e.c, e.d, phase * 1.3, opacity);
        }
      }
    };
  }

  const paint=[panel(false),panel(true)];
  root.insertBefore(plate,caption);
  root.classList.add('dp-enhanced');
  caption.innerHTML='<strong id="sched-title">去噪的顺序依赖放在哪里？</strong>每列是一轮重规划，每行是一个去噪时刻。移动的边框标出一次调用的输入。OneFlow 的蓝色连线传递上轮对齐后的估计，虚线表示无需再次调用网络的重建。末帧跟踪一个动作段。原生采样的路径落在同一列，OneFlow 的路径斜跨五轮。示意依据论文图 1 与项目站的依赖图。';
  const play=plate.querySelector('[data-dp-play]'), range=plate.querySelector('input');
  let time=reduce.matches?duration:0, wanted=!reduce.matches, visible=false, raf=0, prev=0;
  function draw(){
    paint.forEach(p=>p(time));range.value=time;
    range.setAttribute('aria-valuetext',time>end?'查看完整依赖路径':'第 '+Math.floor(time)+' 次网络调用');
    play.textContent=wanted?'暂停':time>=duration?'重播':'播放';
  }
  function tick(now){
    raf=0;
    if(prev)time=Math.min(duration,time+Math.min(80,now-prev)/540);
    prev=now;
    if(time>=duration)wanted=false;
    draw();sync();
  }
  function sync(){
    const run=visible && wanted && !document.hidden && !document.querySelector('#deck[open]');
    if(run&&!raf)raf=requestAnimationFrame(tick);
    else if(!run){if(raf)cancelAnimationFrame(raf);raf=0;prev=0;}
  }
  play.addEventListener('click',()=>{if(time>=duration)time=0;wanted=!wanted;draw();sync();});
  range.addEventListener('input',()=>{wanted=false;time=Number(range.value);draw();sync();});
  plate.querySelector('[data-dp-trace]').addEventListener('click',()=>{wanted=false;time=duration;draw();sync();});
  new IntersectionObserver(([e])=>{visible=e.isIntersecting;sync();}).observe(plate);
  document.addEventListener('visibilitychange',sync);
  const deck=document.querySelector('#deck');if(deck)new MutationObserver(sync).observe(deck,{attributes:true,attributeFilter:['open']});
  reduce.addEventListener('change',()=>{if(reduce.matches){wanted=false;time=duration;draw();sync();}});
  draw();
})();
