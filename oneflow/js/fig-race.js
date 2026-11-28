// Problem figure: one 11-chunk pick-and-place task driven by two samplers on one clock. Time counts
// denoising-network forward passes, using the warm NFE per replanning step reported for Xiaomi
// Robotics 0 (Sequential: 5; OneFlow: 1 after a native N = 5 initialization). The arm advances
// one keyframe per delivered action chunk and waits while the next chunk is being computed.
(function () {
  const { el, scene, TASK_END, play, clamp } = PF;
  const root = document.getElementById('fig-race');
  if (!root) return;

  const CHUNKS = TASK_END, NATIVE = 5, MOVE = 0.8;   // action chunks in the task; native steps; arm motion per chunk
  const LANES = [
    { title: 'OneFlow', sub: ['1 batched pass per step', 'after a native 5-step init'], per: 1, init: NATIVE, ours: true },
    { title: 'Native', sub: ['native sampler', '5 serial passes per step'], per: NATIVE },
  ];
  // Chunk k is delivered at T[k] passes; pass s belongs to the native initialization or to step `step`.
  for (const L of LANES) {
    L.T = Array.from({ length: CHUNKS }, (_, k) => (L.init ? L.init + k * L.per : (k + 1) * L.per));
    L.total = L.T[CHUNKS - 1];
    L.passes = Array.from({ length: L.total }, (_, s) => {
      const init = !!L.init && s < L.init;
      return { s, init, step: init ? -1 : L.init ? s - L.init : Math.floor(s / L.per) };
    });
  }
  const SPAN = Math.max(...LANES.map(L => L.total));

  // ---------- a: denoising in parallel, with a compact execution preview ----------
  const canvasA = root.querySelector('.fig-canvas');
  canvasA.classList.add('race-studio');
  canvasA.innerHTML = `
    <div class="race-heading"><p><span class="m">N</span> = 5 noise levels per action chunk</p>
      <div class="race-views" role="group" aria-label="Camera view"><button type="button" data-view="studio" aria-pressed="true">Full view</button><button type="button" data-view="detail" aria-pressed="false">Close-up</button></div>
    </div>
    <div class="race-scenes"></div>
    <div class="race-timeline" role="img" aria-label="Same task: OneFlow uses 15 forward passes including initialization; the native sampler uses 55.">
      <div class="race-timeline-heading"><span>Forward passes to finish the task</span></div>
      <div class="race-ticks"><span>0</span><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span><span>55</span></div>
      <div class="race-tapes"></div>
    </div>
    <div class="race-player">
      <button class="race-restart" type="button" aria-label="Replay comparison">Replay</button>
      <div class="race-scrubber"><label for="race-time">Elapsed passes <output id="race-elapsed">0 / 55</output></label><input id="race-time" type="range" min="0" max="56.2" step="0.05" value="0" aria-label="Comparison time in forward passes"></div>
      <label class="race-speed">Speed<select aria-label="Playback speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>
    </div>
`;
  const sceneGrid = canvasA.querySelector('.race-scenes');
  LANES.forEach(L => {
    const card = document.createElement('article');
    card.className = `race-card${L.ours ? ' race-card-ours' : ''}`;
    card.innerHTML = `<div class="race-card-heading"><div><h4>${L.title}</h4><span class="race-method">${L.ours ? 'All levels in one batch' : 'One level at a time'}</span></div><span class="race-status" data-state="waiting">Computing</span></div>
      <div class="race-workspace">
        <div class="race-compute"><div class="race-compute-title">${L.ours ? 'Retained chunks → next trajectory' : 'A fresh chunk → clean actions'}</div><div class="race-levels" role="img"></div><p class="race-batch-note"></p></div>
        <div class="race-execution"><div class="race-viewport robot-surface" role="img" aria-label="${L.title}: a Panda robot picks up and places a gold block"></div><div class="race-execution-count"><strong class="race-chunks">0<span> / 11</span></strong><span>chunks delivered</span></div></div>
      </div>
      <div class="race-card-footer"><span class="race-method-note">${L.ours ? 'Chunks carried across steps' : 'Restart from noise at every step'}</span><span class="race-pass-count"><strong>0</strong> / ${L.total} passes</span></div>`;
    sceneGrid.appendChild(card);
    const levelRoot = card.querySelector('.race-levels');
    // A chunk at level i, as in the other figures: six actions crossed by its trajectory, which is
    // source noise at t_0 and the smooth action at t_N.
    const trace = i => {
      const z = 1 - i / NATIVE, pts = Array.from({ length: 25 }, (_, q) => `${(q * 2.5).toFixed(1)},${(2 + 7 * (1 - PF.blend(PF.signal(q / 4), z, q / 4, 3))).toFixed(1)}`);
      return `<svg viewBox="0 0 60 11" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${PF.waveInk(z)}" stroke-width="1.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
    };
    const chunk = (i, output) => `<span class="race-mini-chunk${output ? ' race-mini-output' : ''}" style="--level:${PF.level(i,NATIVE)}">${'<i></i>'.repeat(6)}${trace(i)}</span>`;
    L.rows = Array.from({length:NATIVE}, (_,i) => {
      const row = document.createElement('div');
      row.className = 'race-level';
      row.innerHTML = `<span class="race-noise-label">t<sub>${i}</sub></span>${chunk(i,false)}<span class="race-level-arrow" aria-hidden="true">→</span>${chunk(i+1,true)}<span class="race-noise-label">t<sub>${i+1}</sub></span>`;
      levelRoot.appendChild(row);
      return row;
    });
    L.levelRoot = levelRoot;
    L.batchNote = card.querySelector('.race-batch-note');
    const viewport = card.querySelector('.race-viewport');
    const fallbackScene = () => {
      viewport.replaceChildren();
      const svg = el('svg',{viewBox:'0 0 100 66','aria-hidden':'true'},viewport);
      L.sc = scene(svg,0,0,100,{plan:false});
    };
    L.sc = window.PFRobotStudio?.mount(viewport,{width:600,height:396,plan:false,onFail:fallbackScene});
    if (!L.sc) fallbackScene();
    L.status = card.querySelector('.race-status');
    L.count = card.querySelector('.race-chunks');
    L.passCount = card.querySelector('.race-pass-count strong');
    const tape = document.createElement('div');
    tape.className = `race-tape${L.ours ? ' race-tape-ours' : ''}`;
    tape.innerHTML = `<span class="race-tape-label">${L.title}</span><div class="race-tape-track"><div class="race-tape-cells"></div><div class="race-tape-head"></div></div><strong>${L.total}</strong>`;
    canvasA.querySelector('.race-tapes').appendChild(tape);
    L.tapeHead = tape.querySelector('.race-tape-head');
    L.tapeCells = L.passes.map(pass => {
      const cell = document.createElement('span');
      cell.className = pass.init ? 'race-tape-cell is-init' : 'race-tape-cell';
      cell.style.left = `${pass.s/SPAN*100}%`;
      cell.style.width = `${100/SPAN}%`;
      tape.querySelector('.race-tape-cells').appendChild(cell);
      return cell;
    });
  });
  const slider = canvasA.querySelector('#race-time'), clock = canvasA.querySelector('#race-elapsed');
  slider.addEventListener('input',()=>root.dispatchEvent(new CustomEvent('pf:seek',{detail:Number(slider.value)})));
  canvasA.querySelector('.race-restart').addEventListener('click',()=>root.dispatchEvent(new CustomEvent('pf:replay')));
  canvasA.querySelector('select').addEventListener('change',event=>root.dispatchEvent(new CustomEvent('pf:rate',{detail:Number(event.target.value)})));
  canvasA.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{
    canvasA.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    LANES.forEach(L=>L.sc.setView?.(button.dataset.view));
  }));
  play(root, {
    duration:SPAN+1.2, unitMs:260, holdMs:2400, still:12.5, progress:false,
    render(t) {
      for (const L of LANES) {
        const n = L.T.filter(delivery=>t>=delivery).length;
        const done = t >= L.total, init = !!L.init && t < L.init;
        const simultaneous = L.ours && !init;
        let p = 0, state = init ? 'initializing' : 'waiting';
        if (n>0) { const k=n-1,f=clamp((t-L.T[k])/MOVE); p=k+f; state=f<1?'moving':n===CHUNKS?'done':'waiting'; }
        L.sc.set(p);
        L.status.dataset.state = state;
        L.status.textContent = {initializing:'Initializing',waiting:'Computing',moving:'Executing',done:'Complete'}[state];
        if (L.lastCount!==n) { L.count.innerHTML=`${n}<span> / ${CHUNKS}</span>`; L.lastCount=n; }
        L.passCount.textContent = Math.min(L.total,Math.floor(t+1e-9));
        const phase = Math.min(NATIVE-1,Math.floor(t)%NATIVE), fraction = t-Math.floor(t);
        L.levelRoot.dataset.mode = simultaneous ? 'batch' : 'serial';
        L.levelRoot.setAttribute('aria-label', simultaneous ? 'All noise levels are evaluated together in one batched forward pass.' : 'A single noise level is evaluated per forward pass, in sequence.');
        L.levelRoot.classList.toggle('is-complete',done);
        L.rows.forEach((row,i)=>{
          const active = !done && (simultaneous || i===phase);
          row.classList.toggle('is-active',active);
          row.classList.toggle('is-reached',done || (!simultaneous && i<phase));
          row.style.setProperty('--pass-progress',active ? fraction : done || (!simultaneous && i<phase) ? 1 : 0);
        });
        const note = done ? 'Task complete' : init ? 'Native initialization · 5 serial passes' : simultaneous ? 'All levels together · 1 batched pass / step' : '5 dependent passes → 1 clean chunk';
        if (L.batchNote.textContent!==note) L.batchNote.textContent = note;
        L.tapeCells.forEach((cell,i)=>cell.style.setProperty('--fill',clamp(t-L.passes[i].s)));
        L.tapeHead.style.left = `${Math.min(t,SPAN)/SPAN*100}%`;
      }
      slider.value=t;
      clock.textContent=`${Math.min(SPAN,Math.floor(t))} / ${SPAN}`;
      slider.setAttribute('aria-valuetext',`${Math.min(SPAN,Math.floor(t))} forward passes elapsed`);
    },
  });

})();
