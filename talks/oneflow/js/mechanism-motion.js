// One steady-state replanning update. Its three views share a scene and a clock.
// Trajectory cells, source texture, batch outline, travelling rows and observation
// are adapted from the OneFlow project page's fig-mechanism.js and common.js.
(() => {
  const art=window.OneFlowTrajectoryArt;
  if(!art) return;
  const NS='http://www.w3.org/2000/svg';
  const observation=new URL('../assets/stream/obs-03.webp',document.currentScript.src).href;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const clamp=v=>Math.max(0,Math.min(1,v));
  const ease=v=>{const t=clamp(v);return t*t*(3-2*t);};
  const mix=(a,b,t)=>a+(b-a)*t;
  const subs=['₀','₁','₂','₃','₄'];
  const phases=[
    {tab:'流式对齐',heading:'窗口前移两步，保留六个位置的动作与源噪声',body:'每行是一段八步轨迹。5–10 连同各自的源噪声一起前移。11、12 延伸旧窗口的末端残差，并叠加同一份按阶段缩放的新噪声。'},
    {tab:'一次批量调用',heading:'四个候选沿同一批次进入冻结策略',body:'四条候选轨迹共用观测 oₖ。冻结策略一次给出全部速度 Vᵢ，各阶段据此得到终点估计 Dᵢ = Cᵢ + (1 − tᵢ)Vᵢ。'},
    {tab:'并行重建',heading:'同时重建四段轨迹，交付末段的前两步',body:'预计算的权重把源噪声和四个终点估计组合为新状态。中间状态写回左侧供下一轮使用，最终轨迹的动作 5、6 交付执行。'}
  ];
  const lengths=[3.3,3.8,4.2];
  const palette=['#e4e9ee','#c3d4e4','#91b0cd','#5e85af','#345f8b'];
  function element(tag,cls,value){
    const e=document.createElement(tag);if(cls)e.className=cls;if(value)e.textContent=value;return e;
  }
  function create(tag,parent,attrs={}){
    const e=document.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);
    parent.append(e);return e;
  }
  function set(node,k,v){
    const s=String(v);if(node.getAttribute(k)!==s)node.setAttribute(k,s);
  }
  function text(g,x,y,content,attrs={}){
    const n=create('text',g,{x,y,fill:'#314a60','font-size':14,'dominant-baseline':'middle',...attrs});n.textContent=content;return n;
  }
  function rename(el,content){if(el.textContent!==content)el.textContent=content;}
  function stroke(g,d,attrs={}){
    return create('path',g,{d,fill:'none',stroke:'#aabcca','stroke-width':1.35,'stroke-linecap':'round',...attrs});
  }
  function setPose(node,x,y,scale=1){set(node,'transform','translate('+x.toFixed(2)+' '+y.toFixed(2)+') scale('+scale.toFixed(3)+')');}
  function fade(node,opacity){set(node,'opacity',clamp(opacity).toFixed(3));}

  // For the schematic one-dimensional action coordinate, reuse the paper's
  // residual extension and unrolled affine update with a uniform denoising grid.
  const previousEstimate=a=>art.signal(a)+.1*Math.sin(.7*a+.3);
  const noiseAt=a=>art.noise(a,a<10.5?3:11);
  const oldState=(i,a)=>mix(previousEstimate(a),art.noise(a,3),1-i/4);
  const candidate=(i,a)=>mix(previousEstimate(Math.min(a,10.47)),noiseAt(a),1-i/4);
  const endpoint=(i,a)=>art.signal(a)+(.13-.023*i)*Math.sin(1.08*a+.66*i);
  const weights=Array.from({length:5},()=>Array(5).fill(0));
  weights[0][0]=1;
  for(let i=0;i<4;i++){
    const retained=(3-i)/(4-i);
    weights[i+1]=weights[i].map(weight=>retained*weight);
    weights[i+1][i+1]=1-retained;
  }
  function updated(i,a){
    return weights[i].reduce((sum,w,j)=>sum+(w?w*(j?endpoint(j-1,a):noiseAt(a)):0),0);
  }
  function createScene(root,narrow){
    root.replaceChildren();
    const d=art.palette(root);
    const W=narrow?360:860,H=narrow?320:235;
    const cellStep=narrow?24.4:31,cw=cellStep-2.5,ch=narrow?15.5:21.5,rh=narrow?20:28;
    const gx=narrow?37:48,gy=narrow?47:56,rx=narrow?91:565,ry=narrow?205:56;
    const groupW=cellStep*8-2.5, groupH=3*rh+ch;
    const cx=narrow?171:426,cy=narrow?149:110,bw=narrow?97:128,bh=narrow?38:62;
    const photo={x:narrow?271:cx-33,y:narrow?53:9,w:narrow?53:66,h:narrow?30:37};
    const f=narrow?11.5:14;
    set(root,'viewBox','0 0 '+W+' '+H);
    const titleAttrs={'font-size':narrow?13:17,'font-weight':690,fill:'#203f58'};
    const inputTitle=text(root,gx,narrow?15:16,'',titleAttrs);
    const outputTitle=text(root,rx,narrow?178:16,'',titleAttrs);
    const byAction=Array.from({length:8},(_,j)=>text(root,gx+(j+.5)*cellStep,narrow?36:39,'',{'text-anchor':'middle','font-size':f-1}));
    for(let j=0;j<8;j++)text(root,rx+(j+.5)*cellStep,narrow?194:39,String(j+5),{'text-anchor':'middle','font-size':f-1});
    const clip=create('clipPath',d.defs,{id:d.id+'-window'});
    create('rect',clip,{x:gx-1,y:gy-1,width:groupW+2,height:groupH+2,rx:2});
    const clipped=create('g',root,{'clip-path':'url(#'+d.id+'-window)'});
    const inputRows=[],outputRows=[],inLabels=[],outLabels=[],ghostRows=[];
    const pastColor=i=>i<3?'#405f7e':'#f7fbff';
    const slots=create('g',root,{'aria-hidden':'true',stroke:'#d4dfe6',fill:'none'});
    for(let i=0;i<4;i++){
      const y=ry+i*rh;
      create('rect',slots,{x:rx,y,width:groupW,height:ch,rx:3,fill:'#f5f7f7','stroke-width':.75});
      for(let j=1;j<8;j++)stroke(slots,'M'+(rx+j*cellStep-1)+' '+(y+3)+'v'+(ch-6),{stroke:'#dde5e9','stroke-width':.7});
    }
    for(let i=0;i<4;i++){
      const row=create('g',clipped,{class:'mx-state-row','data-noise-level':i});
      const cells=Array.from({length:10},(_,j)=>{
        const cell=art.cell(row,j*cellStep,0,cw,ch,d);
        art.ink(cell,palette[i],pastColor(i),j>=8?'#356ea6':'none',(1-i/4)*.60);
        if(j>=8)set(cell.bg,'stroke-dasharray','2 2');
        art.wave(cell,j+3,(a)=>j>=8?candidate(i,a):oldState(i,a));
        return cell;
      });
      inputRows.push({row,cells});
      inLabels.push(text(root,gx-5,gy+i*rh+ch/2,'',{'font-size':f,'text-anchor':'end','font-style':'italic'}));
      const out=create('g',root,{class:'mx-out-row'});
      const outCells=Array.from({length:8},(_,j)=>art.cell(out,j*cellStep,0,cw,ch,d));
      for(let j=0;j<8;j++) {
        const c=outCells[j];
        art.ink(c,'#4477a6','#fff');art.wave(c,j+5,a=>endpoint(i,a));
      }
      outputRows.push({row:out,cells:outCells});
      outLabels.push(text(root,rx-5,ry+i*rh+ch/2,'',{'font-size':f,'text-anchor':'end','font-style':'italic'}));
    }
    const tail=stroke(root,'',{'stroke-width':1.3,stroke:'#2869ac'});
    const tailLabel=text(root,gx+groupW,gy+groupH+13,'新增尾部 11、12',{'text-anchor':'end','font-size':f-1,fill:'#275d91'});
    const ring=create('rect',root,{x:gx-4,y:gy-4,width:groupW+8,height:groupH+8,rx:5,fill:'none',stroke:d.pass,'stroke-width':2,'stroke-dasharray':'8 5'});
    const cx0=cx-bw/2,cy0=cy-bh/2;
    const outBracket=stroke(root,'',{'stroke-width':1.4,stroke:'#32699f'});
    const outputNote=text(root,rx+groupW,ry+groupH+15,'',{'font-size':f,'text-anchor':'end',fill:'#255881','font-weight':650});
    const centerTrack=stroke(root,narrow?'M'+(gx+groupW/2)+' '+(gy+groupH+3)+' Q'+(gx+groupW/2)+' '+(cy-13)+' '+cx0+' '+cy
      :'M'+(gx+groupW+5)+' '+cy+' H'+(cx0-2),{'stroke-dasharray':'2 3'});
    const returnTrack=stroke(root,narrow?'M'+(cx+bw/2)+' '+cy+' Q'+(rx+groupW/2)+' '+cy+' '+(rx+groupW/2)+' '+(ry-5)
      :'M'+(cx+bw/2+2)+' '+cy+' H'+(rx-23),{'stroke-dasharray':'2 3'});
    const lines=[centerTrack,returnTrack];
    const picture=create('image',root,{href:observation,x:photo.x,y:photo.y,width:photo.w,height:photo.h,preserveAspectRatio:'xMidYMid slice'});
    create('rect',root,{x:photo.x,y:photo.y,width:photo.w,height:photo.h,fill:'none',stroke:'#708699','stroke-width':1,rx:1});
    text(root,narrow?photo.x+photo.w/2:cx+40,narrow?photo.y-10:photo.y+photo.h/2,'观测 oₖ',{'font-size':f,'text-anchor':narrow?'middle':'start','font-weight':650});
    const obsTrack=stroke(root,narrow?'M'+(photo.x+photo.w/2)+' '+(photo.y+photo.h+3)+' Q'+(photo.x+photo.w/2)+' '+(cy-12)+' '+(cx+bw/2-5)+' '+(cy0+2)
      :'M'+cx+' '+(photo.y+photo.h+1)+'V'+(cy0-3));
    const obsDot=create('circle',root,{r:3,fill:'#325c8b'});
    const ghostLayer=create('g',root,{'aria-hidden':'true'});
    for(let i=0;i<4;i++){
      const g=create('g',ghostLayer,{class:'mx-batch-copy'});
      for(let j=0;j<8;j++){
        const c=art.cell(g,j*cellStep,0,cw,ch,d);
        art.ink(c,palette[i],pastColor(i),'none',.6*(1-i/4));art.wave(c,j+5,a=>candidate(i,a));
      }
      ghostRows.push(g);
    }
    const policy=create('g',root,{class:'mx-policy'});
    const box=create('rect',policy,{x:cx0,y:cy0,width:bw,height:bh,rx:narrow?6:10,fill:'#eff3f6',stroke:'#748da4','stroke-width':1.5});
    const boxRing=create('rect',policy,{x:cx0-3,y:cy0-3,width:bw+6,height:bh+6,rx:narrow?8:12,fill:'none',stroke:d.pass,'stroke-width':2,'stroke-dasharray':'8 5'});
    const netLabel=text(policy,cx,cy-(narrow?6:9),'冻结策略',{ 'text-anchor':'middle','font-size':narrow?12:18,'font-weight':680});
    const model=text(policy,cx,cy+(narrow?9:13),'vθ(Cᵢ, tᵢ, oₖ)',{'text-anchor':'middle','font-size':narrow?10:14,'font-style':'italic'});
    const hintY=narrow?309:218;
    const stageHint=text(root,narrow?W/2:gx,hintY,'',{'text-anchor':narrow?'middle':'start','font-size':f,'font-weight':600,fill:'#315671'});
    let previousWrite=-1,previousReconstruct=-1,previousExecution=false;

    return (scene,p)=>{
      const shift=scene===0?ease((p-.12)/.53):1;
      const fly=scene===1?ease((p-.06)/.42):scene>1?1:0;
      const active=scene===1?ease((p-.20)/.15)*(1-ease((p-.78)/.16)):0;
      const out=scene===1?ease((p-.56)/.35):scene>1?1:0;
      const reconstruct=scene===2?ease((p-.13)/.30):0;
      const write=scene===2?ease((p-.55)/.33):0;
      const execute=scene===2?ease((p-.77)/.19):0;
      const newInput=write>.99;
      rename(inputTitle,newInput?'留给下一轮':shift>.94?'已对齐的候选':'上轮保留的轨迹');
      rename(outputTitle,scene===2&&reconstruct>.43?'本轮重建的轨迹':'本轮终点估计');
      byAction.forEach((n,j)=>{rename(n,String(j+(shift>.5?5:3)));fade(n,.45+.55*Math.abs(2*shift-1));});
      for(let i=0;i<4;i++){
        const iy=gy+i*rh,oy=ry+i*rh;
        setPose(inputRows[i].row,gx-2*cellStep*shift,iy);
        rename(inLabels[i],newInput?'X′'+subs[i]:shift>.98?'C'+subs[i]:'X'+subs[i]);
        for(let j=0;j<10;j++){
          const c=inputRows[i].cells[j];
          if(j<2)fade(c.group,1-.7*shift);
          if(j>=8)fade(c.group,ease((shift-.16)/.84));
          if(j>=2&&write!==previousWrite){
            art.wave(c,j+3,a=>mix(candidate(i,a),updated(i,a),write));
            if(j>=8)set(c.bg,'stroke-opacity',1-write);
          }
        }
        const gy0=gy+i*rh;
        const scale=mix(1,.16,fly);
        setPose(ghostRows[i],mix(gx,cx-.16*groupW/2,fly),mix(gy0,cy+(i-1.5)*3,fly),scale);
        fade(ghostRows[i],scene===1?ease(p/.09)*(1-ease((fly-.72)/.28)):0);
        const outScale=mix(.18,1,out);
        let ox=mix(cx-.18*groupW/2,rx,out),yy=mix(cy+(i-1.5)*3,oy,out);
        // Copy the three intermediate outputs back to the slots that the next
        // round will use. The final output stays on the right for the robot.
        if(i<3){ox=mix(ox,gx,write);yy=mix(yy,gy+(i+1)*rh,write);}
        setPose(outputRows[i].row,ox,yy,outScale);
        fade(outputRows[i].row,scene===0?0:out*(i<3?1-ease((write-.77)/.23):1));
        fade(outLabels[i],out*(i<3?1-ease(write*3):1));
        rename(outLabels[i],reconstruct>.5?'X′'+subs[i+1]:'D'+subs[i]);
        if(reconstruct!==previousReconstruct||(execute>.45)!==previousExecution){
          const cells=outputRows[i].cells;
          for(let j=0;j<8;j++){
            const c=cells[j],exec=i===3&&j<2&&execute>.45;
            art.ink(c,exec?'#1e4976':reconstruct>.48?palette[i+1]:'#4477a6',
              i<2&&reconstruct>.48?'#375578':'#fff','none',reconstruct*(1-(i+1)/4)*.58);
            art.wave(c,j+5,a=>mix(endpoint(i,a),updated(i+1,a),reconstruct));
          }
        }
      }
      previousWrite=write;previousReconstruct=reconstruct;previousExecution=execute>.45;
      const xt=gx+6*cellStep;
      set(tail,'d','M'+xt+' '+(gy+groupH+3)+'v3h'+(2*cellStep-2.5)+'v-3');
      const tails=shift*(1-write)*(scene===0?1:.25);fade(tail,tails);fade(tailLabel,tails);
      const xb=rx, yb=ry+groupH+3;
      set(outBracket,'d','M'+xb+' '+yb+'v4h'+(2*cellStep-2.5)+'v-4');
      fade(outBracket,execute);fade(outputNote,execute);
      rename(outputNote,'执行前两步 5、6');
      fade(ring,active);fade(boxRing,active);
      set(ring,'stroke-dashoffset',-p*52);set(boxRing,'stroke-dashoffset',-p*63);
      set(box,'fill',active>.4?'#284d73':'#eff3f6');
      set(netLabel,'fill',active>.4?'#fff':'#27445e');set(model,'fill',active>.4?'#d7e6f6':'#446079');
      fade(picture,.68+.32*(scene===1?1:0));
      fade(obsTrack,.38+.62*active);lines.forEach(line=>fade(line,.27+.65*active));
      const op=clamp((p-.11)/.39);
      if(scene===1&&op>0&&op<1){
        const pt=obsTrack.getPointAtLength(obsTrack.getTotalLength()*op);
        set(obsDot,'cx',pt.x);set(obsDot,'cy',pt.y);fade(obsDot,Math.sin(Math.PI*op));
      }else fade(obsDot,0);
      const note=scene===0?(shift<.02?'上轮已执行 3、4':shift<.98?'动作 5–10 与源噪声同步前移':'新窗口 5–12 · 六个位置沿用上轮的估计')
        :scene===1?(out<.9?'四段轨迹与同一观测送入一个批次':'一次前向给出四个速度，得到四条终点估计')
        :write<.35?'源噪声与终点按固定权重组合':'保留 X′₀–X′₃ · 执行 X′₄ 的前两步';
      rename(stageHint,note);
    };
  }
  function mount(figure){
    const source=figure.querySelector(':scope > .mech-flow, :scope > .mech-grid');
    if(!source||figure.querySelector(':scope > .mx-lab'))return;
    const shell=element('div','mx-lab'),nav=element('div','mx-nav'),summary=element('div','mx-summary');
    const canvas=element('div','mx-stage'),foot=element('div','mx-foot'),body=element('div','mx-explain'),controls=element('div','mx-controls');
    nav.setAttribute('role','group');nav.setAttribute('aria-label','本轮重规划的运算');
    const tabs=phases.map(({tab})=>{const b=element('button','',tab);b.type='button';nav.append(b);return b;});
    const svgRoot=create('svg',canvas,{role:'img'});
    const play=element('button','','播放'),replay=element('button','','重播本步');
    for(const b of [play,replay]){b.type='button';controls.append(b);}
    foot.append(body,controls);
    const final=element('div','mx-final','如果只写回最终动作，下一轮还能从修正后的中间状态出发吗？');
    shell.append(nav,summary,canvas,foot,final);figure.insertBefore(shell,source);
    const slide=figure.closest('.slide');
    let scene=0,position=0,draw,compact,visible=false,wanted=!reduced.matches,raf=0,previous=0,publishing=false;
    function active(){return visible&&!document.hidden&&(slide?!slide.hidden&&!!slide.closest('dialog[open]'):!document.documentElement.classList.contains('presenting'));}
    function controlsState(){
      tabs.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===scene)));
      play.textContent=wanted?'暂停':position>=lengths[scene]?'重播':'播放';
      play.setAttribute('aria-label',play.textContent+'推演');
    }
    function paint(){
      const p=clamp(position/lengths[scene]);
      draw?.(scene,p);
      tabs[scene].style.setProperty('--mx-progress',(p*100).toFixed(2)+'%');
    }
    function resize(){
      if(!shell.clientWidth)return;
      const narrow=shell.clientWidth<550;
      if(narrow===compact&&draw)return;
      compact=narrow;draw=createScene(svgRoot,narrow);paint();
    }
    function open(index,animate,publish=false){
      scene=Math.max(0,Math.min(index,2));shell.dataset.mechanismStage=String(scene);
      position=animate?0:lengths[scene];wanted=animate;previous=0;
      summary.textContent=phases[scene].heading;body.textContent=phases[scene].body;
      svgRoot.setAttribute('aria-label',phases[scene].heading+'。示意轨迹。'+phases[scene].body);
      resize();paint();controlsState();
      if(publish&&slide&&Number(slide.dataset.at)!==scene){
        publishing=true;
        shell.dispatchEvent(new CustomEvent('stepselect',{bubbles:true,detail:{step:scene}}));publishing=false;
      }
      sync();
    }
    function frame(now){
      raf=0;if(!active()||!wanted)return;
      if(previous)position+=Math.min((now-previous)/1000,.1);previous=now;
      paint();
      if(position>=lengths[scene]+.65){
        if(!slide&&scene<2){open(scene+1,true);return;}
        wanted=false;controlsState();return;
      }
      raf=requestAnimationFrame(frame);
    }
    function sync(){
      const run=active()&&wanted;
      if(run&&!raf){previous=0;raf=requestAnimationFrame(frame);}
      if(!run&&raf){cancelAnimationFrame(raf);raf=0;previous=0;}
    }
    tabs.forEach((button,i)=>button.addEventListener('click',()=>open(i,!reduced.matches,true)));
    play.addEventListener('click',()=>{
      if(wanted){wanted=false;controlsState();sync();}
      else if(position>=lengths[scene])open(!slide&&scene===2?0:scene,true,true);
      else{wanted=true;controlsState();sync();}
    });
    replay.addEventListener('click',()=>open(scene,true,true));
    slide?.addEventListener('deckstep',e=>{
      if(publishing)return;
      const step=e.detail.step;
      if(step>=3){wanted=false;position=lengths[scene];paint();controlsState();sync();}
      else open(step,!reduced.matches);
    });
    shell.addEventListener('keydown',e=>{if(e.target.tagName==='BUTTON'&&(e.key===' '||e.key==='Enter'))e.stopPropagation();});
    new ResizeObserver(resize).observe(shell);
    new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;resize();sync();}).observe(shell);
    const modal=document.getElementById('deck');
    if(modal)new MutationObserver(sync).observe(modal,{attributes:true,subtree:true,attributeFilter:['open','hidden']});
    new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange',sync);
    reduced.addEventListener('change',e=>{if(e.matches)open(scene,false);});
    open(0,!reduced.matches);
  }
  document.querySelectorAll('#mechanics-fig, [data-clone="mechanics-fig"] .mech').forEach(mount);
})();
