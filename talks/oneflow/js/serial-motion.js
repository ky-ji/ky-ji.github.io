/* A fixed observation conditions every step. Only a completed chain yields a new action chunk. */
(() => {
  const ns='http://www.w3.org/2000/svg';
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const handles=[];
  const sub=n=>String(n).replace(/[0-9]/g,d=>'₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
  const clamp=x=>Math.max(0,Math.min(1,x));
  function svg(name,parent,attrs={}){
    const n=document.createElementNS(ns,name);
    for(const [key,value] of Object.entries(attrs))n.setAttribute(key,String(value));
    if(parent)parent.append(n);return n;
  }
  function text(g,x,y,value,color,anchor='start',size=12){
    const n=svg('text',g,{x,y,fill:color,'font-size':size,'font-weight':600,'text-anchor':anchor,'dominant-baseline':'middle'});n.textContent=value;return n;
  }
  function button(value,label){const n=document.createElement('button');n.type='button';n.textContent=value;n.setAttribute('aria-label',label);return n;}
  function lane(host,n) {
    const onSlide=Boolean(host.closest('.slide'));
    const view=svg('svg',host,{class:'sm-lane',role:'img','aria-label':n+' 次前向传播沿同一轮依次更新动作估计。箭头传递上一计算的输出。'});
    let width=0,start=0,span=0,cells,stroke,tag,pulse,output,rail;
    function rebuild(w){
      width=w;view.replaceChildren();view.setAttribute('viewBox','0 0 '+w+' 80');
      const narrow=w<380, gain=onSlide&&!narrow?3:0;
      start=narrow?11:19; const end=w-start;
      const tenStep=Math.max(3,(end-start)/10);
      span=n*tenStep;
      text(view,start,10,'观测 · 源噪声','#486078','start',narrow?11:13+gain);
      output=text(view,end,10,'等待输出','#72899b','end',narrow?11:13+gain);
      const fromY=52, cellWidth=tenStep, tip=Math.min(5,cellWidth*.19);
      rail=svg('line',view,{x1:start,y1:fromY,x2:end,y2:fromY,stroke:'#d6dfe5','stroke-dasharray':'2 4'});
      cells=[];
      for(let i=0;i<n;i++){
        const a=start+i*cellWidth+1,b=start+(i+1)*cellWidth-1;
        const d='M'+a+' 43 H'+(b-tip)+' L'+b+' 52 L'+(b-tip)+' 61 H'+a+' L'+(a+tip)+' 52 Z';
        const body=svg('path',view,{d,fill:'#e2eaf1'});
        const value=text(view,(a+b)/2,52,String(i+1),'#72879b','middle',narrow?10:12+gain);
        cells.push({body,value});
      }
      if(n<10)text(view,start+cellWidth+9,70,'1 次调用完成','#516e84','start',narrow?10:12+gain);
      else text(view,end,70,'10 次调用完成','#516e84','end',narrow?10:12+gain);
      // The moving estimate is schematic and travels above each call in turn.
      pulse=svg('g',view,{});
      svg('rect',pulse,{x:-14,y:-8,width:28,height:16,rx:4,fill:'#fff',stroke:'#2869b3','stroke-width':1.2});
      stroke=svg('path',pulse,{fill:'none',stroke:'#195ba8','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round'});
      svg('path',pulse,{d:'M-3 8 L0 11 L3 8',fill:'#2869b3'});
      tag=text(view,start,29,'','#195ba8','start',narrow?10:12+gain);
    }
    function render(position){
      const w=Math.round(host.clientWidth);if(!w)return;
      if(w!==width)rebuild(w);
      const at=Math.min(n,position), done=at>=n, finished=Math.floor(at), progress=at/n;
      let marker=start+span*progress;
      if(n===1 && done){
        const delivery=clamp((position-1)/.48);
        marker+=(width-2*start-span)*delivery*delivery*(3-2*delivery);
      }
      // Inner SVG has its own padding so the packet also remains visible at the endpoints.
      marker=Math.max(15,Math.min(width-15,marker));pulse.setAttribute('transform','translate('+marker+' 31) scale('+(onSlide&&width>380?1.18:1)+')');
      for(let i=0;i<cells.length;i++){
        const completed=i<finished, running=i===finished&&!done;
        cells[i].body.setAttribute('fill',completed?'#2764a9':running?'#94b9e2':'#e4ebf1');
        cells[i].value.setAttribute('fill',completed?'#fff':running?'#143e69':'#718398');
      }
      const pts=[];
      const fuzz=1-progress;
      for(let j=0;j<12;j++){
        const t=j/11;
        const y=2*Math.sin(t*Math.PI*2-.5)+fuzz*(2.3*Math.sin(j*2.4+at*.36)+1.6*Math.sin(j*3.9-.3*at));
        pts.push((j?'L':'M')+(-11+22*t).toFixed(2)+' '+y.toFixed(2));
      }
      stroke.setAttribute('d',pts.join(' '));
      const labelRight=marker>width*.72, pad=onSlide&&width>380?22:18, tx=marker+(labelRight?-pad:pad);
      tag.setAttribute('x',tx);tag.setAttribute('text-anchor',labelRight?'end':'start');tag.textContent='X'+sub(finished);
      output.textContent=done?'动作已输出':'等待输出';
      output.setAttribute('fill',done?'#175a9e':'#667b8e');
      rail.setAttribute('stroke',done?'#91abc1':'#d6dfe5');view.dataset.completed=String(finished);
    }
    return render;
  }
  function enhance(root){
    if(root.classList.contains('sm-enhanced'))return;
    const tracks=Array.from(root.querySelectorAll('.loop-track'));
    if(tracks.length!==2)return;
    const lengths=tracks.map(t=>t.querySelectorAll('.flowchips i').length);
    if(!lengths.includes(10)||!lengths.includes(1))return;
    const renderers=tracks.map((track,i)=>lane(track,lengths[i]));
    const control=document.createElement('div'), state=document.createElement('span'), buttons=document.createElement('span');
    control.className='sm-control';state.className='sm-state';buttons.className='sm-buttons';
    const play=button('播放','播放原生采样推演'), replay=button('重播','从源噪声重新推演');
    buttons.append(play,replay);control.append(state,buttons);root.querySelector('.loop-rows').after(control);
    root.classList.add('sm-enhanced');
    let position=reduce.matches?10:0,playing=!reduce.matches,visible=false,raf=0,prev=0,lastFinished=-1;
    const slide=root.closest('.slide');
    function paint() {
      renderers.forEach(r=>r(position));const f=Math.floor(position);
      if(f!==lastFinished){
        lastFinished=f;
        state.textContent=f===10?'X₁₀ 已就绪，机器人可以执行本轮动作。':f===9?'第 10 次前向传播接收 X₉，生成本轮输出的动作块 X₁₀。':'第 '+(f+1)+' 次前向传播接收 X'+sub(f)+'，算出 X'+sub(f+1)+' 后再传给下一步。';
      }
      replay.hidden=position>=10;
      play.textContent=playing?'暂停':position>=10?'重播':'播放';
      play.setAttribute('aria-label',play.textContent+'原生采样推演');
    }
    function visibleNow(){return visible&&!document.hidden&&(slide? !slide.hidden&&!!slide.closest('dialog[open]'):!document.documentElement.classList.contains('presenting'));}
    function frame(ts){
      raf=0;if(!playing||!visibleNow())return;
      position=Math.min(10,position+(prev?Math.min((ts-prev)/1000,.1):0)/.76);prev=ts;
      if(position>=10)playing=false;
      paint();if(playing)raf=requestAnimationFrame(frame);
    }
    function sync(){
      if(playing&&visibleNow()&&!raf){prev=0;raf=requestAnimationFrame(frame);}
      if((!playing||!visibleNow())&&raf){cancelAnimationFrame(raf);raf=0;prev=0;}
    }
    function start(){position=0;playing=true;prev=0;paint();sync();}
    function finish(){position=10;playing=false;paint();sync();}
    play.addEventListener('click',()=>{if(position>=10){start();return;}playing=!playing;paint();sync();});
    replay.addEventListener('click',start);
    if(slide)slide.addEventListener('deckstep',ev=>{if(ev.detail.step>0||reduce.matches)finish();else start();});
    new ResizeObserver(paint).observe(root);
    new IntersectionObserver(([e])=>{visible=e.isIntersecting;sync();}).observe(root);
    handles.push({sync,finish});paint();
  }
  document.querySelectorAll('#serial-loop,[data-clone="serial-loop"] .loop').forEach(enhance);
  const syncAll=()=>handles.forEach(h=>h.sync());
  document.addEventListener('visibilitychange',syncAll);
  new MutationObserver(syncAll).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  const deck=document.getElementById('deck');
  if(deck)new MutationObserver(syncAll).observe(deck,{subtree:true,attributes:true,attributeFilter:['hidden','open']});
  reduce.addEventListener('change',e=>{if(e.matches)handles.forEach(h=>h.finish());});
})();
