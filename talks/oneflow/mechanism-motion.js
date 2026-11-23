/* One focus per step of a steady-state replanning round, with H=8, E=2, N=4. */
(() => {
  const NS='http://www.w3.org/2000/svg';
  const clamp=v=>Math.max(0,Math.min(1,v));
  const ease=v=>{const t=clamp(v);return t*t*(3-2*t);};
  const colors=['#c4d8eb','#9abce3','#5b91cd','#2e65ac'];
  const phases=[
    {tab:'流式对齐',heading:'旧窗口左移两格，尾部补入新位置',body:'动作 3、4 已执行。保留 5–10，各阶段在尾部 11、12 加入同一份新噪声，并按各自的噪声水平缩放。'},
    {tab:'一次批量调用',heading:'四个候选共享新观测，只调用一次网络',body:'网络一次给出四组速度 Vᵢ。每组速度与该阶段的剩余去噪时间一起，给出终点估计 Dᵢ。'},
    {tab:'并行重建',heading:'一次矩阵运算重建各阶段，执行输出的前两步',body:'权重由去噪网格预先确定。最终动作块的 5、6 交给机器人，源噪声与更新的中间状态留给下一轮。'}
  ];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const players=[];
  let seq=0;
  function el(name,cls,text) {
    const n=document.createElement(name);
    if(cls)n.className=cls;if(text)n.textContent=text;return n;
  }
  function svg(name,parent,attrs={}) {
    const n=document.createElementNS(NS,name);attr(n,attrs);if(parent)parent.append(n);return n;
  }
  function attr(node, attrs){for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));}
  function txt(g,x,y,s,opts={}){
    const n=svg('text',g,{x,y,fill:'#314e68','font-size':13,'dominant-baseline':'middle',...opts});n.textContent=s;return n;
  }
  function rect(g,x,y,w,h,fill,stroke='none',radius=3) {return svg('rect',g,{x,y,width:w,height:h,rx:radius,fill,stroke});}
  function link(g,d,color='#a9bfd3') {return svg('path',g,{d,fill:'none',stroke:color,'stroke-width':1.45,'stroke-linecap':'round'});}
  function token(g,color,r=3) {return svg('circle',g,{r,fill:color,stroke:'#fff','stroke-width':.8});}
  function onPath(dot,p,fraction,opacity=1){
    const t=clamp(fraction), xy=p.getPointAtLength(p.getTotalLength()*t);
    attr(dot,{cx:xy.x,cy:xy.y,opacity:opacity*ease(t*11)*ease((1-t)*11)});
  }
  const subs=['₀','₁','₂','₃','₄'];
  function alignScene(g,dim,id) {
    const {W,mobile:w}=dim, left=w?37:76,right=w?10:33,top=61,rh=28,cw=(W-left-right)/8;
    const clip=svg('clipPath',svg('defs',g),{id});rect(clip,left-1,top-22,8*cw+2,rh*4+24,'white');
    txt(g,left,15,'窗口内位置',{'font-size':w?11:14});
    for(let j=0;j<8;j++)txt(g,left+(j+.5)*cw,37,String(j+1),{'text-anchor':'middle','font-size':w?12:15,'font-weight':600});
    const moving=[];
    for(let r=0;r<4;r++){
      const yy=top+r*rh;
      txt(g,left-7,yy+9,'t'+subs[r],{'font-size':w?13:17,'font-style':'italic','text-anchor':'end'});
      const rail=svg('g',g,{'clip-path':'url(#'+id+')'}),strip=svg('g',rail),old=[],fresh=[];
      for(let j=0;j<10;j++){
        const px=left+j*cw+1, newTail=j>=8, executed=j<2, cell=svg('g',strip);
        rect(cell,px,yy-2,cw-3,23,newTail?'#eaf3ff':executed?'#e8ecee':colors[r],newTail?'#2164b0':'none');
        txt(cell,px+(cw-3)/2,yy+10,String(j+3),{'text-anchor':'middle','font-size':w?11:14,'font-weight':600,fill:r>1&&!newTail&&!executed?'#fff':'#1c3853'});
        if(executed)link(cell,'M'+(px+3)+' '+(yy+18)+' l'+(cw-9)+' -16','#8c9da9');
        if(executed)old.push(cell);if(newTail)fresh.push(cell);
      }
      moving.push({strip,old,fresh});
    }
    const endTxt=txt(g,W-right,184,'',{'text-anchor':'end','font-size':w?12:15,'font-weight':650,fill:'#1755a3'});
    return p=>{
      const moved=ease((p-.12)/.55), tail=ease((p-.52)/.34);
      for(const {strip,old,fresh} of moving){
        strip.setAttribute('transform','translate('+(-2*cw*moved)+' 0)');
        old.forEach(n=>n.setAttribute('opacity',1-.65*moved));fresh.forEach(n=>n.setAttribute('opacity',tail));
      }
      endTxt.textContent=moved>.97?'本轮窗口 5–12':'上一轮窗口 3–10';
    };
  }
  function batchScene(g,dim){
    const {W,mobile:m}=dim,cx=W/2, start=m?59:112,end=W-start,top=57,gap=34;
    txt(g,start,17,'候选 Cᵢ',{ 'text-anchor':'middle','font-weight':650,'font-size':m?12:15});
    txt(g,end,17,'速度 Vᵢ',{ 'text-anchor':'middle','font-weight':650,'font-size':m?12:15});
    const nw=m?65:111,nh=m?48:58,ny=103;
    const flows=[];
    for(let i=0;i<4;i++){
      const y=top+i*gap,portY=ny+(i-1.5)*6, ix=cx-nw/2, ox=cx+nw/2;
      const pathIn=link(g,'M'+(start+20)+' '+y+' C'+(ix-18)+' '+y+' '+(ix-26)+' '+portY+' '+ix+' '+portY);
      const pathOut=link(g,'M'+ox+' '+portY+' C'+(ox+26)+' '+portY+' '+(end-40)+' '+y+' '+(end-19)+' '+y);
      rect(g,start-20,y-10,40,21,colors[i]);txt(g,start,y+1,'C'+subs[i],{'text-anchor':'middle','font-size':m?12:15,'font-weight':650,fill:i>=2?'white':'#183651'});
      const out=svg('g',g);
      rect(out,end-20,y-10,40,21,'#e5effa','#78a0cc');
      txt(out,end,y+1,'V'+subs[i],{'text-anchor':'middle','font-size':m?12:15,'font-weight':650,fill:'#194e88'});
      flows.push({a:pathIn,b:pathOut,out,dotA:token(g,'#145bc4',m?3.3:4.2),dotB:token(g,'#145bc4',m?3.3:4.2)});
    }
    const net=rect(g,cx-nw/2,ny-nh/2,nw,nh,'#e2edf7','#4472a4',7);
    const symbol=txt(g,cx,ny,'v',{'text-anchor':'middle','font-size':m?21:28,'font-weight':650, 'font-style':'italic'});
    svg('tspan',symbol,{'baseline-shift':'sub','font-size':'65%'}).textContent='θ';
    txt(g,cx,26,'新观测 oₖ',{'text-anchor':'middle','font-size':m?12:15,'font-weight':650});
    link(g,'M'+cx+' 38 V'+(ny-nh/2-5),'#7c92a7');
    txt(g,cx,177,'1 次前向传播',{'text-anchor':'middle','font-size':m?12:16,'font-weight':650,fill:'#195392'});
    return p=>{
      const strength=ease((p-.36)/.10)*(1-ease((p-.69)/.14));
      net.setAttribute('fill',strength>.45?'#225b9c':'#e2edf7');symbol.setAttribute('fill',strength>.45?'#fff':'#164576');
      for(const f of flows){
        onPath(f.dotA,f.a,(p-.04)/.4);onPath(f.dotB,f.b,(p-.51)/.37);
        f.out.setAttribute('opacity',.32+.68*ease((p-.57)/.27));
      }
    };
  }
  function rebuildScene(g,dim){
    const {W,mobile:m}=dim, left=m?40:76, mid=m?103:184, right=m?161:320, gap=(W-right-(m?9:32))/8, top=56,rh=29;
    txt(g,left,15,'输入',{'text-anchor':'middle','font-size':m?12:15,'font-weight':650});
    txt(g,mid,15,'权重',{'text-anchor':'middle','font-size':m?12:15,'font-weight':650});
    txt(g,right,15,'重建后的窗口 5–12',{'font-size':m?12:15,'font-weight':650});
    const nodes=[],outgoing=[];
    for(let i=0;i<5;i++){
      const yy=43+i*29;rect(g,left-18,yy-9,36,20,i?'#dce9f8':'#e9e6dd','#afbfcc');
      txt(g,left,yy+1,i?'D'+subs[i-1]:'X′₀',{'text-anchor':'middle','font-size':m?12:15,'font-weight':620});
      const p=link(g,'M'+(left+18)+' '+yy+' Q'+(mid-22)+' '+yy+' '+(mid-15)+' '+(98+(i-2)*5));
      nodes.push({p,d:token(g,'#3166a0')});
    }
    rect(g,mid-15,77,30,42,'#e8eff6','#7295b5',3);
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)rect(g,mid-9+b*6,88+a*7,4,5,b<=a?'#486e9b':'#d2dee8','none',.6);
    const cells=[];
    for(let i=0;i<4;i++){
      const yy=top+i*rh;
      const path=link(g,'M'+(mid+16)+' '+(98+(i-1.5)*4)+' Q'+(right-34)+' '+yy+' '+(right-22)+' '+yy);
      outgoing.push({p:path,d:token(g,'#2a6fcb')});
      txt(g,right-2,yy,'X′'+subs[i+1],{'text-anchor':'end','font-size':m?10:14,fill:'#274764'});
      const row=[];
      for(let j=0;j<8;j++){
        const x=right+j*gap+2,cell=svg('g',g),exec=(i===3&&j<2);
        rect(cell,x,yy-10,gap-3,20,exec?'#1b58a7':colors[i],exec?'#164c95':'none');
        txt(cell,x+(gap-3)/2,yy+.3,String(j+5),{'text-anchor':'middle','font-size':m?10:13,fill:i>1?'#fff':'#1d3e5b','font-weight':600});
        row.push(cell);
      }
      cells.push(row);
    }
    const footer=txt(g,W-(m?10:32),185,'',{'text-anchor':'end','font-size':m?12:15,'font-weight':650,fill:'#1755a3'});
    return p=>{
      for(const v of nodes)onPath(v.d,v.p,(p-.01)/.3);
      for(const v of outgoing)onPath(v.d,v.p,(p-.27)/.29);
      for(const row of cells)row.forEach((n,j)=>n.setAttribute('opacity',.18+.82*ease((p-.46-j*.035)/.12)));
      footer.textContent=p>.77?'输出动作 5、6 · 中间状态留给下一轮':'四个状态同时由预先计算的权重重建';
    };
  }
  function mount(figure){
    const source=figure.querySelector(':scope > .mech-flow, :scope > .mech-grid');
    if(!source||figure.querySelector(':scope > .mx-lab'))return;
    const shell=el('div','mx-lab'),nav=el('div','mx-nav'),summary=el('div','mx-summary'),foot=el('div','mx-foot'),body=el('div','mx-explain'),controls=el('div','mx-controls');
    nav.setAttribute('role','group');nav.setAttribute('aria-label','本轮重规划的运算');
    const tabs=phases.map(({tab})=>{const b=el('button','',tab);b.type='button';nav.append(b);return b;});
    const svgRoot=svg('svg',null,{role:'img'}),play=el('button','', '播放'),replay=el('button','','重播本步');
    play.type='button';replay.type='button';controls.append(play,replay);foot.append(body,controls);
    const final=el('div','mx-final','如果只写回最终动作，下一轮还能从修正后的中间状态出发吗？');
    shell.append(nav,summary,svgRoot,foot,final);figure.insertBefore(shell,source);
    const slide=figure.closest('.slide'), id='of-mx-clip-'+ ++seq;
    let scene=-1,position=0,draw=()=>{}, mobile=false,visible=false,playWanted=!reduced.matches;
    let raf=0,previous=0,publishOwn=false;
    const duration=4.4,hold=.95;
    function visibleNow(){return visible&&!document.hidden&&(slide?!slide.hidden&&!!slide.closest('dialog[open]'):!document.documentElement.classList.contains('presenting'));}
    function updateControls(){
      tabs.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===scene)));
      play.textContent=playWanted?'暂停':position>=duration?'重播':'播放';
      play.setAttribute('aria-label',play.textContent+'推演');
    }
    function paint(){draw(clamp(position/duration));}
    function redraw(){
      mobile=(shell.clientWidth||700)<520;
      const W=mobile?358:690;
      svgRoot.replaceChildren();svgRoot.setAttribute('viewBox','0 0 '+W+' 200');
      draw=[alignScene,batchScene,rebuildScene][scene](svgRoot,{W,mobile},id);
      paint();
    }
    function open(index, animate, publish=false){
      index=Math.max(0,Math.min(index,2));
      const changed=index!==scene;scene=index;shell.dataset.mechanismStage=String(index);
      position=animate?0:duration;playWanted=animate;previous=0;
      if(changed){
        summary.textContent=phases[index].heading;body.textContent=phases[index].body;
        svgRoot.setAttribute('aria-label',phases[index].heading+'。'+phases[index].body);
        redraw();
      }else paint();
      updateControls();
      if(publish&&slide&&Number(slide.dataset.at)!==index){
        publishOwn=true;
        shell.dispatchEvent(new CustomEvent('stepselect',{bubbles:true,detail:{step:index}}));publishOwn=false;
      }
      sync();
    }
    function frame(ts){
      raf=0;
      if(!visibleNow() || !playWanted)return;
      const dt=previous?Math.min((ts-previous)/1000,.12):0;previous=ts;
      position+=dt;paint();
      if(position>=duration+hold){
        if(!slide&&scene<2){open(scene+1,true);return;}
        playWanted=false;updateControls();return;
      }
      raf=requestAnimationFrame(frame);
    }
    function sync(){
      const run=visibleNow()&&playWanted;
      if(run&&!raf){previous=0;raf=requestAnimationFrame(frame);}
      if(!run&&raf){cancelAnimationFrame(raf);raf=0;previous=0;}
    }
    tabs.forEach((b,i)=>b.addEventListener('click',()=>open(i,!reduced.matches,true)));
    play.addEventListener('click',()=>{
      if(playWanted){playWanted=false;updateControls();sync();}
      else if(position>=duration){open(!slide&&scene===2?0:scene,true,true);}
      else{playWanted=true;updateControls();sync();}
    });
    replay.addEventListener('click',()=>open(scene,true,true));
    if(slide)slide.addEventListener('deckstep',e=>{
      if(publishOwn)return;
      const next=e.detail.step;
      if(next>=3){playWanted=false;position=duration;paint();updateControls();sync();}
      else open(next,!reduced.matches);
    });
    // Space/Enter on a button invokes that button, instead of advancing the deck.
    shell.addEventListener('keydown',e=>{if(e.target.tagName==='BUTTON'&&(e.key===' '||e.key==='Enter'))e.stopPropagation();});
    new ResizeObserver(()=>{if(shell.clientWidth>0&&(shell.clientWidth<520)!==mobile)redraw();}).observe(shell);
    new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();}).observe(shell);
    players.push({sync,freeze:()=>open(scene,false)});
    open(0,!reduced.matches);
  }
  function findFigures(){
    document.querySelectorAll('#mechanics-fig, [data-clone="mechanics-fig"] .mech').forEach(mount);
  }
  findFigures();
  const modal=document.getElementById('deck');
  // Existing slides clone the reading figures when talk.js starts.
  if(modal)new MutationObserver(()=>players.forEach(p=>p.sync())).observe(modal,{attributes:true,subtree:true,attributeFilter:['open','hidden']});
  const resync=()=>players.forEach(p=>p.sync());
  new MutationObserver(resync).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',resync);
  reduced.addEventListener('change',e=>{if(e.matches)players.forEach(p=>p.freeze());});
})();
