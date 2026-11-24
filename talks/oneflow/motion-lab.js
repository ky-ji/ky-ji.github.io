/* The cover trajectories are schematic. The overlap diagram uses H=8, E=2, N=4. */
(() => {
  const ns = 'http://www.w3.org/2000/svg';
  const tau = Math.PI * 2;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min=0, max=1) => Math.max(min, Math.min(max, value));
  const smooth = value => { const t=clamp(value); return t*t*(3-2*t); };
  function html(tag, cls, text) {
    const e=document.createElement(tag);
    if (cls) e.className=cls;
    if (text) e.textContent=text;
    return e;
  }
  function svg(tag, parent, attrs={}) {
    const e=document.createElementNS(ns,tag);
    for (const [key,value] of Object.entries(attrs)) e.setAttribute(key,value);
    if (parent) parent.append(e);
    return e;
  }
  function label(parent,x,y,text,attrs) {
    const el=svg('text',parent,{x,y,...attrs});
    el.textContent=text;
    return el;
  }
  function button(text, name) {
    const b=html('button','',text);
    b.type='button';
    if (name) b.setAttribute('aria-label',name);
    return b;
  }
  const jobs=[];
  function scheduler(root, advance, status) {
    const slide=root.closest('.slide');
    let playing=!reduced.matches && !slide, intersecting=false, animation=0, previous=0;
    function eligible() {
      return playing && intersecting && !document.hidden && (slide ? !slide.hidden && !!slide.closest('dialog[open]') : !document.documentElement.classList.contains('presenting'));
    }
    function frame(now) {
      animation=0;
      if (!eligible()) return;
      const dt=previous ? Math.min((now-previous)/1000,.12) : 0;
      previous=now;
      if (advance(dt)===false) playing=false;
      if (!playing) status(false);
      else animation=requestAnimationFrame(frame);
    }
    function sync() {
      if (eligible() && !animation) { previous=0; animation=requestAnimationFrame(frame); }
      if (!eligible() && animation) { cancelAnimationFrame(animation); animation=0; previous=0; }
    }
    function set(value) { playing=value; status(value); sync(); }
    const io=new IntersectionObserver(entries=>{ intersecting=entries[0].isIntersecting; sync(); });
    io.observe(root);
    const control={set, sync, get playing(){return playing;}};
    jobs.push(control);
    status(playing);
    return control;
  }
  document.addEventListener('visibilitychange',()=>jobs.forEach(j=>j.sync()));
  function layoutChanges() { jobs.forEach(j=>j.sync()); }
  new MutationObserver(layoutChanges).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  const dialog=document.getElementById('deck');
  if (dialog) new MutationObserver(layoutChanges).observe(dialog,{attributes:true,subtree:true,attributeFilter:['open','hidden']});
  reduced.addEventListener('change',e=>{ if (e.matches) jobs.forEach(j=>j.set(false)); });

  function flow(root) {
    const canvas=html('canvas');
    const ctx=canvas.getContext('2d',{alpha:false});
    if (!ctx) return;
    root.classList.add('of-motion','om-flow');
    canvas.setAttribute('role','img');
    canvas.setAttribute('aria-label','示意流场。分散的源噪声沿流时间向右收束为平滑的动作轨迹。');
    const header=html('div','om-field-head');
    header.append(html('span','','源噪声'),html('span','','动作估计'));
    const footer=html('div','om-field-foot'), toggle=button('暂停动态');
    footer.append(html('span','','去噪过程示意 →'),toggle);
    root.append(canvas,header,footer);

    let seed=11723;
    function random() { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }
    const strands=Array.from({length:86},(_,i)=>{
      const group=i%5, rank=Math.floor(i/5);
      return {group,rank,source:random()*2-1,turn:random()*2-1,
        phase:random()*tau,phase2:random()*tau,breadth:random()*.54+.46,
        depth:random(),speed:.062+random()*.06,offset:random(),tint:random()};
    });
    let time=0, width=0, height=0;
    function ordinate(q,u) {
      const a=smooth((u-.035)/.81), fade=(1-a);
      const opening=.33*q.source + .068*Math.sin(9.2*u+q.phase+.15*time)
        + .048*Math.sin(26*u+q.phase2-.19*time) + .019*Math.sin(64*u+q.phase+.19*time);
      const fan=(q.group-2)*.064;
      const center=.118*Math.sin(tau*(u*1.03-.035*time)+.42)
        + .043*Math.sin(tau*(u*2.07+.025*time)+.3*q.group);
      const family=fan*(.64+.34*Math.sin(u*7+.22*time)) + .035*Math.sin(q.group*1.31 + u*5.1+.18*time);
      const detail=(q.rank-8)*.0028*(.74+.48*Math.sin(6*u+q.phase*.10)) + .012*Math.sin(7*u+q.phase2*.4-.25*time);
      const arc=.19*q.turn*Math.sin(Math.PI*u)*fade;
      return .50+opening*fade+(center+family+detail)*a+arc;
    }
    function draw() {
      if (!width || !height) return;
      ctx.fillStyle='#faf9f3';ctx.fillRect(0,0,width,height);
      const x=u=>width*(.018+.964*u), y=n=>height*(.135+.72*n);
      const gridSize=width>500 ? 28 : 21;
      ctx.fillStyle='rgba(87,113,136,.26)';
      for(let px=gridSize/2;px<width;px+=gridSize)
        for(let py=height*.19;py<height*.84;py+=gridSize)ctx.fillRect(px,py,.85,.85);
      const gx=ctx.createLinearGradient(0,0,width,0);
      gx.addColorStop(0,'rgba(51,67,84,.24)');gx.addColorStop(.34,'rgba(31,71,115,.46)');
      gx.addColorStop(.64,'rgba(15,80,190,.72)');gx.addColorStop(1,'rgba(28,96,207,.62)');
      ctx.lineJoin='round';ctx.lineCap='round';
      for(const q of strands) {
        ctx.strokeStyle=gx;
        ctx.globalAlpha=.32+q.depth*.60;
        ctx.lineWidth=(.45+.78*q.breadth)*clamp(width/660,.65,1.35);
        const points=width<420 ? 46 : 72;
        ctx.beginPath();
        for(let k=0;k<=points;k++){
          const u=k/points, px=x(u), py=y(ordinate(q,u));
          if(k)ctx.lineTo(px,py);else ctx.moveTo(px,py);
        }
        ctx.stroke();
      }
      ctx.globalAlpha=1;
      for(const q of strands) {
        const u=(q.offset+q.speed*time)%1;
        const tail=Math.max(0,u-(.015+q.depth*.024));
        const grad=ctx.createLinearGradient(x(tail),0,x(u)+.01,0);
        const col=u<.33?'28,58,89':q.group===1?'0,94,224':'22,75,146';
        grad.addColorStop(0,'rgba('+col+',0)');grad.addColorStop(1,'rgba('+col+',.83)');
        ctx.strokeStyle=grad;ctx.lineWidth=clamp(width/500,.7,1.7)*(1+q.depth*.65);
        ctx.beginPath();ctx.moveTo(x(tail),y(ordinate(q,tail)));
        for(let j=1;j<=5;j++){const v=tail+(u-tail)*j/5;ctx.lineTo(x(v),y(ordinate(q,v)));}
        ctx.stroke();
        ctx.fillStyle=u<.4?'#466481':'#1555ac';
        ctx.beginPath();ctx.arc(x(u),y(ordinate(q,u)),clamp(width/680,.7,1.3)*(.65+q.depth*.68),0,tau);ctx.fill();
      }
      // The bare ticks mark flow time, an ordering rather than a measured clock.
      ctx.strokeStyle='#9aabb9';ctx.lineWidth=1;
      ctx.beginPath();
      for(let i=0;i<=24;i++){const px=x(i/24);ctx.moveTo(px,height*.854);ctx.lineTo(px,height*.854+(i%6?3:6));}
      ctx.stroke();
    }
    function resize() {
      const w=canvas.clientWidth,h=canvas.clientHeight;
      if(!w||!h)return;
      width=w;height=h;const ratio=Math.min(devicePixelRatio||1,2);
      canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);draw();
    }
    new ResizeObserver(resize).observe(canvas);resize();
    const player=scheduler(root,dt=>{time+=dt;draw();},playing=>{
      const text=playing?'暂停动态':'播放动态';
      toggle.textContent=text;toggle.setAttribute('aria-label',text+'流场');
    });
    // The cover artwork also runs in the presentation; the speaker can freeze it.
    if(root.closest('.slide') && !reduced.matches)player.set(true);
    toggle.addEventListener('click',()=>player.set(!player.playing));
  }

  // A cell is one action vector. The curve represents one schematic coordinate.
  // Keep the project page's continuous signal, seeded source and per-cell sampling
  // so an action remains recognisable when it is shifted or copied into a batch.
  const trajectoryArt = (() => {
    const signal = a => .5 + .27 * Math.sin(.78 * a + .6) + .11 * Math.sin(1.93 * a + 1.4);
    const noise = (a, seed = 0) => {
      const hash = Math.sin(seed * 127.1 + Math.round(a * 4) * 311.7 + 12.9898) * 43758.5453;
      return .06 + .88 * (hash - Math.floor(hash));
    };
    let sequence = 0;
    function palette(root) {
      const id = 'of-trace-' + ++sequence;
      const defs = svg('defs', root);
      const grain = svg('pattern', defs, {id: id + '-grain', patternUnits:'userSpaceOnUse', width:13, height:13});
      for (const [cx, cy, r] of [[1.4,2.1,.8],[6.2,1.1,.6],[10.6,3.2,.9],[3.9,5.6,.65],[8.3,6.9,.8],[1.9,9.3,.9],[5.7,11.2,.7],[10.1,11.6,.6]])
        svg('circle', grain, {cx,cy,r,fill:'#8999a5'});
      const pass = svg('linearGradient', defs, {id:id+'-pass',x1:'0%',y1:'0%',x2:'100%',y2:'100%'});
      svg('stop',pass,{offset:'0%','stop-color':'#94afcb'});
      svg('stop',pass,{offset:'100%','stop-color':'#205291'});
      return {id,defs,grain:'url(#'+id+'-grain)',pass:'url(#'+id+'-pass)'};
    }
    function cell(parent,x,y,w,h,palette) {
      const group = svg('g', parent);
      const bg = svg('rect', group, {x,y,width:w,height:h,rx:Math.min(3,w*.12),'stroke-width':.8});
      const texture = svg('rect', group, {x,y,width:w,height:h,rx:Math.min(3,w*.12),fill:palette.grain,opacity:0});
      const trace = svg('path', group, {fill:'none','stroke-width':1.45,'stroke-linecap':'round','stroke-linejoin':'round'});
      return {group,bg,texture,trace,x,y,w,h};
    }
    function wave(cell,action,value) {
      const {x,y,w,h}=cell;
      let d='';
      for(let j=0;j<=8;j++){
        const u=j/8, v=clamp(value(action+(u-.5)*.94));
        d+=(j?'L':'M')+(x+.5+u*(w-1)).toFixed(2)+' '+(y+2+(1-v)*(h-4)).toFixed(2);
      }
      if(cell.trace.getAttribute('d')!==d)cell.trace.setAttribute('d',d);
    }
    function ink(cell,fill,line,edge='none',grain=0) {
      cell.bg.setAttribute('fill',fill);
      cell.bg.setAttribute('stroke',edge);
      cell.texture.setAttribute('opacity',grain);
      cell.trace.setAttribute('stroke',line);
    }
    return {signal,noise,palette,cell,wave,ink};
  })();
  window.OneFlowTrajectoryArt = trajectoryArt;

  function overlap(root) {
    root.classList.add('of-motion','om-overlap');
    const head=html('div','om-overlap-head');
    head.append(html('strong','','同一个动作，四次观测'),html('small','','预测 8 步 · 每次执行 2 步'));
    const diagram=svg('svg',null,{class:'om-overlap-svg',role:'img','aria-label':'动作 9 在四个八步窗口中，从第 7、5、3 格移到队首。横坐标始终是实际动作编号。'});
    const summary=html('div','om-readout'), reading=html('span','om-result'), key=html('span','om-caption-key');
    for(const word of ['本轮执行','随后执行']){
      const item=html('span');item.append(html('i'),document.createTextNode(word));key.append(item);
    }
    summary.append(reading,key);
    const controls=html('div','om-controls'), restart=button('重置','重置到第 1 轮'), prev=button('上一轮'), play=button('播放'), next=button('下一轮');
    play.className='om-play';
    const seek=html('input');seek.type='range';seek.min='1';seek.max='4';seek.step='.01';seek.value='1';seek.setAttribute('aria-label','拖动观察动作 9 跨轮更新');
    controls.append(restart,prev,play,next,seek);
    root.append(head,diagram,summary,controls);
    const slide=root.closest('.slide');
    const stageCells=Array.from(root.closest('.axes-body')?.querySelectorAll('.kxi td.on')||[]);
    let value=1, lastRound=0, published=0, selfChange=false, atEnd=0, tween=null;
    let rows=[], execution=[], locator, cursor, guide, transfers, brace, geom, player;
    // Consecutive plans differ slightly under each new observation. All rows use
    // physical action time, so retained estimates occupy the same horizontal coordinate.
    const estimate=(round,a)=>trajectoryArt.signal(a)+.13*Math.sin(.67*a+.85*round)*Math.cos(.29*a+.21*round);
    function build() {
      const narrow=(diagram.clientWidth || 720)<550, W=narrow?400:720, H=narrow?252:278;
      const left=narrow?39:64, step=(W-left-(narrow?7:14))/14, rowGap=narrow?36:39, firstY=51;
      const y=r=>firstY+r*rowGap,x=a=>left+(a-3+.5)*step, streamY=firstY+3*rowGap+58;
      const ch=narrow?22:25, cw=step-2.3;
      geom={x,y,step,narrow,ch,cw};
      diagram.replaceChildren();diagram.setAttribute('viewBox','0 0 '+W+' '+H);
      const defs=trajectoryArt.palette(diagram), font=narrow?12:15;
      label(diagram,left,14,'动作编号 →',{'font-size':font,fill:'#435d70','font-weight':640});
      label(diagram,W-7,14,'曲线为动作分量示意',{'text-anchor':'end','font-size':font-1,fill:'#506473'});
      for (let n=3;n<=16;n++){
        svg('line',diagram,{x1:x(n),x2:x(n),y1:37,y2:streamY+ch/2,stroke:'#d3dce2','stroke-dasharray':'2 4'});
        label(diagram,x(n),33,String(n),{'text-anchor':'middle','font-size':font,fill:n===9?'#893f12':'#475e71','font-weight':n===9?760:540});
      }
      svg('rect',diagram,{x:x(9)-step*.48,y:38,width:step*.96,height:streamY+ch*.5-38,rx:4,fill:'#f8eaca'});
      transfers=svg('g',diagram,{class:'om-transfer',opacity:0});
      for(let j=0;j<6;j++)svg('path',transfers,{fill:'#c2d5eb',opacity:j%2?.59:.4});
      rows=Array.from({length:4},(_,r)=>{
        const g=svg('g',diagram,{}), start=3+r*2;
        label(diagram,left-6,y(r)+1,'第'+(r+1)+'轮',{'text-anchor':'end','dominant-baseline':'middle','font-size':font-1,fill:'#29455b','font-weight':640});
        const cells=Array.from({length:8},(_,j)=>{
          const a=start+j;
          const c=trajectoryArt.cell(g,x(a)-cw/2,y(r)-ch/2,cw,ch,defs);
          const hot=a===9;
          trajectoryArt.ink(c,hot?'#f7d89c':j<2?'#285781':'#d7e5f2',hot?'#88400f':j<2?'#fafcff':'#3a6895',hot?'#a8591f':'none');
          trajectoryArt.wave(c,a,p=>estimate(r,p));
          return c;
        });
        return {g,cells};
      });
      // The retained part has six positions; this brace follows only that part.
      brace=svg('path',diagram,{fill:'none',stroke:'#34669b','stroke-width':1.2,opacity:0});
      cursor=svg('rect',diagram,{width:step*8,height:ch+7,rx:5,fill:'none',stroke:defs.pass,'stroke-width':1.65});
      guide=svg('path',diagram,{fill:'none',stroke:'#a05a20','stroke-width':1.8,'stroke-dasharray':'1 4','stroke-linecap':'round'});
      locator=svg('circle',diagram,{r:narrow?3.2:4,fill:'#b06825',stroke:'#fff','stroke-width':1.3});
      label(diagram,left-6,streamY+1,'执行',{'text-anchor':'end','dominant-baseline':'middle','font-size':font,fill:'#254969','font-weight':680});
      execution=Array.from({length:14},(_,j)=>{
        const a=j+3;
        svg('rect',diagram,{x:x(a)-cw/2,y:streamY-ch*.5,width:cw,height:ch,rx:3,fill:'none',stroke:'#b7c5d0','stroke-dasharray':'3 3'});
        if(j>=8)return null;
        const c=trajectoryArt.cell(diagram,x(a)-cw/2,streamY-ch*.5,cw,ch,defs);
        trajectoryArt.ink(c,'#254d73','#fff');
        trajectoryArt.wave(c,a,q=>estimate(Math.floor(j/2),q));return c.group;
      });
      paint(true);
    }
    function paint(force=false) {
      if(!geom)return;
      const {x,y,step,ch,cw}=geom, k=clamp(value-1,0,3), round=1+Math.floor(k+.00001);
      const s=Math.floor(k), t=smooth(k-s), moving=t>.001&&t<.999;
      root.dataset.motionRound=String(round);
      rows.forEach(({g,cells},r)=>{
        const incoming=r===s+1;
        const opacity=r<s?.67:r===s?1:incoming?.16+.84*t:.16;
        g.setAttribute('opacity',opacity.toFixed(2));
        cells.forEach((c,j)=>{
          const a=3+2*r+j;
          // During handover, bring the prior estimate into the overlapping six
          // positions. The two newly exposed positions extend from the old tail.
          if(incoming || force || lastRound!==round){
            trajectoryArt.wave(c,a,q=>{
              if(!incoming) return estimate(r,q);
              const oldEstimate=estimate(s,Math.min(q,3+2*s+7.47));
              return oldEstimate+(estimate(r,q)-oldEstimate)*t;
            });
          }
        });
      });
      const transferOpacity=moving?Math.sin(Math.PI*t)*.85:0;
      transfers.setAttribute('opacity',transferOpacity.toFixed(3));
      if(moving)Array.from(transfers.children).forEach((path,j)=>{
        const a=5+2*s+j, xx=x(a), top=y(s)+ch/2+1, bottom=y(s+1)-ch/2-1;
        path.setAttribute('d','M'+(xx-cw*.4)+' '+top+'h'+(cw*.8)+'L'+(xx+cw*.34)+' '+bottom+'h'+(-cw*.68)+'Z');
      });
      const moved=s+t, cx=x(3+2*moved)-step*.5, rowY=y(moved);
      cursor.setAttribute('x',cx);cursor.setAttribute('y',rowY-(ch+7)/2);
      const sourceY=y(0)+ch/2+3, cy=rowY+ch/2+3;
      guide.setAttribute('d','M'+x(9)+' '+sourceY+'V'+cy);
      locator.setAttribute('cx',x(9));locator.setAttribute('cy',cy);
      const br=Math.min(3,s+1);
      const by=y(br)+ch/2+3, bx=x(3+2*br)-cw/2, ex=x(3+2*br+5)+cw/2;
      brace.setAttribute('d','M'+bx+' '+by+'v3H'+ex+'v-3');
      brace.setAttribute('opacity',moving?transferOpacity:0);
      execution.forEach((node,j)=>{
        if(!node)return;
        const r=Math.floor(j/2);
        const done=r<=s?1:r===s+1?smooth((t-.67)/.33):0;
        node.setAttribute('opacity',done.toFixed(2));
      });
      seek.value=String(value);
      prev.disabled=value<=1.0001;next.disabled=value>=3.9999;restart.disabled=value<=1.0001;
      if(lastRound!==round||force){
        lastRound=round;
        stageCells.forEach((cell,i)=>{
          cell.classList.toggle('om-now',i===round-1);
          cell.classList.toggle('om-future',i>=round);
        });
        reading.replaceChildren(document.createTextNode('第 '+round+' 轮 · '),html('b','',round===4?'动作 9 到达队首，本轮执行':'动作 9 位于本轮第 '+(9-2*round)+' 格'));
        seek.setAttribute('aria-valuetext','第 '+round+' 轮，动作 9 位于第 '+(9-2*round)+' 格');
      }
    }
    function syncDeck(){
      const step=Math.min(3,Math.floor(value-1+.00001));
      if(!slide||published===step)return;
      published=step;selfChange=true;
      root.dispatchEvent(new CustomEvent('stepselect',{bubbles:true,detail:{step}}));selfChange=false;
    }
    function setValue(v,publish=true){value=clamp(v,1,4);paint();if(publish)syncDeck();}
    function manual(v){tween=null;atEnd=0;setValue(v);player.set(false);}
    function go(v,publish=true){
      const target=clamp(v,1,4);
      if(reduced.matches||Math.abs(target-value)<.005){tween=null;setValue(target,publish);player.set(false);return;}
      tween={from:value,to:target,age:0,publish};
      atEnd=0;player.set(true);
    }
    player=scheduler(root,dt=>{
      if(tween){
        tween.age+=dt;
        const p=clamp(tween.age/.68);
        setValue(tween.from+(tween.to-tween.from)*p,false);
        if(p>=1){const publish=tween.publish;tween=null;if(publish)syncDeck();return false;}
        return true;
      }
      if(value>=4){atEnd+=dt;return atEnd<.7;}
      setValue(value+dt/1.85);return true;
    },playing=>{
      play.textContent=playing?'暂停':value>=4?'重播':'播放';
      play.setAttribute('aria-label',playing?'暂停动作 9 推演':'播放动作 9 推演');
    });
    play.addEventListener('click',()=>{
      if(!player.playing && value>=4){atEnd=0;setValue(1);}
      tween=null;player.set(!player.playing);
    });
    restart.addEventListener('click',()=>manual(1));
    prev.addEventListener('click',()=>go(Math.ceil(value-.001)-1));
    next.addEventListener('click',()=>go(Math.floor(value+.001)+1));
    seek.addEventListener('input',()=>manual(Number(seek.value)));
    seek.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      if(event.key==='Home')manual(1);else if(event.key==='End')manual(4);
      else if(event.key==='ArrowLeft'||event.key==='ArrowDown')manual(Math.ceil(value-.001)-1);
      else manual(Math.floor(value+.001)+1);
    });
    controls.addEventListener('keydown',e=>{if(e.target.tagName==='BUTTON'&&(e.key===' '||e.key==='Enter'))e.stopPropagation();});
    if(slide)slide.addEventListener('deckstep',event=>{
      if(selfChange)return;
      published=Math.min(3,event.detail.step);
      go(published+1,false);
    });
    let builtWidth=0;
    new ResizeObserver(()=>{const width=root.clientWidth;if(width>0&&width!==builtWidth){builtWidth=width;build();}}).observe(root);
    build();
  }
  for(const root of document.querySelectorAll('[data-of-motion]')){
    if(root.dataset.ofMotion==='flow')flow(root);
    if(root.dataset.ofMotion==='overlap')overlap(root);
  }
})();
