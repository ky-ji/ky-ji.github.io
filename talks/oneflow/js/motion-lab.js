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
    root.classList.add('of-motion','om-flow','om-particle-field');
    canvas.setAttribute('role','img');
    canvas.setAttribute('aria-label','去噪过程示意。左侧高斯分布的源噪声粒子沿流时间向右，逐渐凝成七条弯曲的动作轨迹。');
    const header=html('div','om-field-head');
    header.append(html('span','','源噪声'),html('span','','动作估计'));
    const footer=html('div','om-field-foot'), toggle=button('暂停动态');
    footer.append(html('span','','去噪过程示意 →'),toggle);
    root.append(canvas,header,footer);

    // Schematic only; it carries no measured data. A deep obsidian-indigo plate sits between the two label bands,
    // transitioning from silver source noise to luminous OneFlow blue-teal action trajectories.
    const PAPER='#faf9f5', NIGHT='#091322';
    const GRAIN=[186,196,210], ACTION=[224,244,255], WAKE=[86,184,192];
    const STRANDS=7;              // one trajectory per action dimension
    const SPAN=1.1;               // flow time loops over -0.04 to 1.06, so entry and exit stay off the plate
    const FADE=[.94,.64,.36,.17];    // opacity of the four trail segments, newest first

    // A deterministic pool, built once per mount: the cover, the clone and every resize show the same field.
    let seed=20261111;
    const rand=()=>{
      seed=(seed+0x6D2B79F5)|0;
      let x=Math.imul(seed^(seed>>>15),1|seed);
      x=(x+Math.imul(x^(x>>>7),61|x))^x;
      return ((x^(x>>>14))>>>0)/4294967296;
    };
    const gauss=()=>Math.sqrt(-2*Math.log(1-rand()))*Math.cos(tau*rand());
    const parts=Array.from({length:860},(_,i)=>({
      o:rand()*SPAN, v:.035+.04*rand(), k:i%STRANDS,    // phase and speed along flow time, action dimension
      e:gauss(), jx:clamp(gauss(),-2.5,2.5),            // Gaussian source noise: height and sideways scatter
      f:.5+rand(), p:rand()*tau, w:.9+.9*rand()         // wobble rate and phase, grain size
    }));

    // time opens on a balanced phase, which is also the reduced-motion still.
    let time=5.7, layout='', width=0, height=0, y0=0, y1=0, cy=0, band=0, unit=1, count=0;
    let headInk, tailInk, guideInk, plateBg, px=0, py=0;

    // Share of the action at flow time u: noise until 4%, clean from 84%.
    const share=u=>smooth((u-.04)/.8);
    // Height of action trajectory k at flow time u and clock time t: a slow travelling wave per dimension.
    const target=(k,u,t)=>cy+(k-(STRANDS-1)/2)*band*.115
      +band*.2*(.62*Math.sin(tau*(1.1*u+.06*k)-.42*t)+.3*Math.sin(tau*(2.3*u+.17*k)+.27*t+k));
    // The straight path of flow matching, y = (1 - s) * noise + s * action, written to px and py. It is a pure
    // function of (u, t): nothing accumulates on the canvas, so pause, resize and the still frame keep the phase.
    function locate(q,u,t) {
      const s=share(u), wob=Math.sin(t*q.f+q.p);
      const noise=cy+q.e*band*.5*(1+.1*wob);
      px=(u+(1-s)*(q.jx*.012+wob*.004))*width;
      py=noise+(target(q.k,u,t)-noise)*s;
      return s;
    }
    // Colour and opacity depend on s(u) alone, so all particles share one horizontal gradient.
    function ramp(clean,from,to) {
      const ink=ctx.createLinearGradient(0,0,width,0);
      for (let i=0;i<=10;i++) {
        const s=smooth(i/10), rgb=GRAIN.map((c,n)=>Math.round(c+(clean[n]-c)*s));
        ink.addColorStop(.04+.08*i,`rgba(${rgb},${(from+(to-from)*s).toFixed(3)})`);
      }
      return ink;
    }

    function draw() {
      if (!width) return;
      ctx.globalAlpha=1;
      ctx.fillStyle=plateBg || NIGHT;
      ctx.fillRect(0,y0,width,y1-y0);
      // Subtle denoising-time vertical grid ticks
      ctx.strokeStyle='rgba(140,183,244,0.075)';
      ctx.lineWidth=1;
      ctx.beginPath();
      for (let g=1; g<4; g++) {
        const gx = Math.round(width * g / 4) + 0.5;
        ctx.moveTo(gx, y0);
        ctx.lineTo(gx, y1);
      }
      ctx.stroke();
      ctx.globalCompositeOperation='lighter';
      // The seven clean trajectories, fading in only where the particles have nearly settled on them.
      ctx.beginPath();
      for (let k=0;k<STRANDS;k++) for (let i=0;i<=22;i++) {
        const u=.56+.02*i, y=cy+(target(k,u,time)-cy)*share(u);
        if (i) ctx.lineTo(u*width,y); else ctx.moveTo(u*width,y);
      }
      ctx.strokeStyle=guideInk; ctx.lineWidth=1.1*unit; ctx.stroke();
      // A trail joins a particle's own earlier positions and lengthens as the particle nears its action.
      // Each age is stroked once and every frame is drawn from scratch, so nothing is left to ghost.
      const tails=FADE.map(()=>new Path2D()), heads=new Path2D();
      for (let i=0;i<count;i++) {
        const q=parts[i], u=(q.o+q.v*time)%SPAN-.04;
        const s=locate(q,u,time), r=unit*q.w*(.83+.20*s), lag=.055+.11*s;
        heads.moveTo(px+r,py); heads.arc(px,py,r,0,tau);
        for (let j=1;j<=FADE.length;j++) {
          tails[j-1].moveTo(px,py);
          locate(q,u-q.v*lag*j,time-lag*j);
          tails[j-1].lineTo(px,py);
        }
      }
      ctx.strokeStyle=tailInk;
      for (let j=FADE.length-1;j>=0;j--) {
        ctx.globalAlpha=FADE[j]; ctx.lineWidth=unit*(1.85-.30*j); ctx.stroke(tails[j]);
      }
      ctx.globalAlpha=1;
      ctx.fillStyle=headInk; ctx.fill(heads);
      ctx.globalCompositeOperation='source-over';
      ctx.fillStyle=PAPER;
      ctx.fillRect(0,0,width,y0); ctx.fillRect(0,y1,width,height-y1);
    }

    function resize() {
      const w=canvas.clientWidth, h=canvas.clientHeight;
      if (!w || !h) return;         // a hidden presentation clone has no size: nothing to lay out or warm up
      const ratio=Math.min(devicePixelRatio||1,2), edge=canvas.offsetTop;
      // The plate gives way to the measured label bands; fixed margins apply if they do not overlap the canvas.
      const headEnd=header.offsetTop+header.offsetHeight-edge, footStart=footer.offsetTop-edge;
      const gap=clamp(h*.013,4,9);
      const upper=Math.round(headEnd>0 && headEnd<h ? Math.min(headEnd+gap,h*.32) : h*.135);
      const lower=Math.round(footStart>0 && footStart<h ? Math.max(footStart-gap,h*.68) : h*.86);
      const next=[w,h,ratio,upper,lower].join();
      if (next===layout) return;
      layout=next; width=w; height=h; y0=upper; y1=lower;
      canvas.width=Math.round(w*ratio); canvas.height=Math.round(h*ratio);
      ctx.setTransform(ratio,0,0,ratio,0,0);
      cy=(y0+y1)/2; band=(y1-y0)/2;
      unit=clamp(w/720,.95,1.45);
      count=Math.round(clamp(w*(y1-y0)/415,300,parts.length));
      headInk=ramp(ACTION,.9,1); tailInk=ramp(WAKE,.66,.98);
      plateBg=ctx.createLinearGradient(0,y0,width,y1);
      plateBg.addColorStop(0,'#091322');
      plateBg.addColorStop(.55,'#0d1e36');
      plateBg.addColorStop(1,'#0c2732');
      guideInk=ctx.createLinearGradient(.56*w,0,w,0);
      [[0,0],[.64,.36],[1,.54]].forEach(([at,alpha])=>guideInk.addColorStop(at,`rgba(${WAKE},${alpha})`));
      draw();                       // redraws the same phase: time and the particle pool are untouched
    }
    let resizeRaf=0;
    const scheduleResize=()=>{ if (resizeRaf) return; resizeRaf=requestAnimationFrame(()=>{ resizeRaf=0; resize(); }); };
    const sizes=new ResizeObserver(scheduleResize);
    [canvas,header,footer].forEach(el=>sizes.observe(el));
    addEventListener('resize',scheduleResize);   // browser zoom or another screen changes the device pixel ratio
    resize();

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
