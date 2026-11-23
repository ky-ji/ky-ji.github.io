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
    let value=1, lastRound=0, published=0, selfChange=false, atEnd=0;
    let rows=[], locator, line, band, geom, player;
    function build() {
      const narrow=(diagram.clientWidth || 720)<550, W=narrow?380:760, H=narrow?236:294;
      const left=narrow?45:77, step=(W-left-(narrow?9:18))/14, rowGap=narrow?39:51, firstY=narrow?70:78;
      const y=r=>firstY+r*rowGap, x=id=>left+(id-3+.5)*step;
      geom={W,H,x,y,step,rowGap,left,narrow};
      diagram.replaceChildren();diagram.setAttribute('viewBox','0 0 '+W+' '+H);
      const font=narrow?12:15;
      label(diagram,left,19,'动作编号 →',{'font-size':font,fill:'#455f75','font-weight':650});
      for (let num=3;num<=16;num++) {
        svg('line',diagram,{x1:x(num),x2:x(num),y1:37,y2:H-7,stroke:'#dbe4ea','stroke-dasharray':'2 4'});
        label(diagram,x(num),41,String(num),{'text-anchor':'middle','font-size':font+.3,fill:num===9?'#ae4b12':'#3e576f','font-weight':num===9?760:530});
      }
      svg('rect',diagram,{x:x(9)-step*.46,y:45,width:step*.92,height:H-50,rx:5,fill:'#fff2dc'});
      rows=[];
      for(let r=0;r<4;r++) {
        const g=svg('g',diagram,{}),start=3+2*r;
        label(g,left-5,y(r)+1,'第'+(r+1)+'轮',{'text-anchor':'end','dominant-baseline':'middle','font-size':font,fill:'#233e58','font-weight':620});
        for(let j=0;j<8;j++){
          const num=start+j,cellWidth=step-(narrow?1.5:3), cellHeight=narrow?23:29;
          const tracked=num===9, exec=j<2;
          svg('rect',g,{x:x(num)-cellWidth/2,y:y(r)-cellHeight/2,width:cellWidth,height:cellHeight,rx:narrow?2:3,
            fill:tracked?'#ffdfad':exec?'#2158a8':'#dbe8f7',stroke:tracked?'#ae5018':exec?'#174e9a':'#b6c9df','stroke-width':tracked?1.8:.7});
          if(tracked)label(g,x(num),y(r)+.2,'9',{'dominant-baseline':'middle','text-anchor':'middle','font-size':font+2,'font-weight':750,fill:'#823707'});
          else if(!narrow) {
            // Fine lines distinguish the two-step executed prefix even in grayscale.
            if(exec)svg('line',g,{x1:x(num)-step*.16,x2:x(num)+step*.16,y1:y(r),y2:y(r),stroke:'#f1f6fc','stroke-width':2.2,'stroke-linecap':'round'});
          }
        }
        rows.push(g);
      }
      band=svg('rect',diagram,{width:step*8-(narrow?.5:1),height:narrow?33:39,rx:4,fill:'none',stroke:'#1e5fab','stroke-width':1.6});
      line=svg('line',diagram,{x1:x(9),x2:x(9),y1:y(0),y2:y(0),stroke:'#bf5b15','stroke-width':2.5,'stroke-dasharray':'2 5','stroke-linecap':'round'});
      locator=svg('circle',diagram,{r:narrow?3.6:4.7,fill:'#c46112',stroke:'#fff','stroke-width':1.4});
      paint(true);
    }
    function paint(force=false) {
      if(!geom)return;
      const {x,y,step,narrow}=geom;
      const k=clamp(value-1,0,3), round=1+Math.min(3,Math.floor(k+.0001)), s=Math.floor(k), t=smooth(k-s), interp=s+t;
      root.dataset.motionRound=String(round);
      for(let r=0;r<4;r++){
        const opacity=r<round-1?.60:r===round-1?1:r===round?.18+.58*t:.18;
        rows[r].setAttribute('opacity',opacity.toFixed(3));
      }
      const centerX=x(3+2*interp)-step*.49;
      band.setAttribute('x',centerX);band.setAttribute('y',y(interp)-(narrow?16.5:19.5));
      line.setAttribute('y2',y(interp));
      // The dot advances in replanning time; its physical action index stays fixed.
      locator.setAttribute('cx',x(9));locator.setAttribute('cy',y(interp)+(narrow?13:18));
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
      const step=Math.min(3,Math.floor(value-1+.0001));
      if(!slide || published===step)return;
      published=step;selfChange=true;
      root.dispatchEvent(new CustomEvent('stepselect',{bubbles:true,detail:{step}}));selfChange=false;
    }
    function setValue(v,publish=true){
      value=clamp(v,1,4);paint();if(publish)syncDeck();
    }
    function manual(v){atEnd=0;setValue(v);player.set(false);}
    player=scheduler(root,dt=>{
      if(value>=4){atEnd+=dt;return atEnd<.7;}
      setValue(value+dt/1.75);return true;
    },playing=>{
      play.textContent=playing?'暂停':value>=4?'重播':'播放';
      play.setAttribute('aria-label',playing?'暂停动作 9 推演':'播放动作 9 推演');
    });
    play.addEventListener('click',()=>{
      if(!player.playing && value>=4){atEnd=0;setValue(1);}
      player.set(!player.playing);
    });
    restart.addEventListener('click',()=>manual(1));
    prev.addEventListener('click',()=>manual(Math.ceil(value-.001)-1));
    next.addEventListener('click',()=>manual(Math.floor(value+.001)+1));
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
      player.set(false);atEnd=0;published=Math.min(3,event.detail.step);setValue(published+1,false);
    });
    new ResizeObserver(build).observe(root);build();
  }
  for(const root of document.querySelectorAll('[data-of-motion]')){
    if(root.dataset.ofMotion==='flow')flow(root);
    if(root.dataset.ofMotion==='overlap')overlap(root);
  }
})();
