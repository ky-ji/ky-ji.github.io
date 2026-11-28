// Problem figure: two samplers control the same Panda arm over an identical continuously moving
// conveyor belt on one shared clock. Time counts denoising forward passes (N = 5 as in Xiaomi
// Robotics 0). The conveyor never pauses while a policy computes: OneFlow updates every pass and
// catches both moving bowls in 18 passes; Native stalls for 4 of every 5 passes, so both moving
// bowls glide past the frozen gripper and roll off the belt.
(function () {
  const { el, scene, TASK_END, play, clamp } = PF;
  const root = document.getElementById('fig-race');
  if (!root) return;

  const CHUNKS = TASK_END, NATIVE = 5, MOVE = 0.85, SPAN = 25;
  const STUDIO = window.PFRobotStudio || {};
  const BELT_SPEED = STUDIO.BELT_SPEED || 0.028;
  const BOWL1_PICK_Z = STUDIO.BOWL1_PICK_Z ?? 0.10;
  const BOWL1_PICK_T = STUDIO.BOWL1_PICK_T ?? 7.35;
  const BOWL2_PICK_Z = STUDIO.BOWL2_PICK_Z ?? 0.02;
  const BOWL2_PICK_T = STUDIO.BOWL2_PICK_T ?? 13.35;
  const GRASP_TOL = STUDIO.GRASP_TOL || 0.032;

  const LANES = [
    { title: 'OneFlow', per: 1, init: NATIVE, ours: true },
    { title: 'Native', per: NATIVE, init: 0, ours: false },
  ];

  // Delivery schedule T[k] (in passes) and physical catch verification against the shared moving belt.
  for (const L of LANES) {
    L.T = Array.from({ length: CHUNKS }, (_, k) => (L.init ? L.init + k * L.per : (k + 1) * L.per));
    L.total = L.T[CHUNKS - 1];
    // Time when the gripper finishes closing on pickup 1 (p = 2.45) and pickup 2 (p = 8.45).
    const tGrasp1 = L.T[2] + 0.45 * MOVE;
    const tGrasp2 = L.T[8] + 0.45 * MOVE;
    const z1AtGrasp = BOWL1_PICK_Z + (BOWL1_PICK_T - tGrasp1) * BELT_SPEED;
    const z2AtGrasp = BOWL2_PICK_Z + (BOWL2_PICK_T - tGrasp2) * BELT_SPEED;
    L.catch1 = Math.abs(z1AtGrasp - BOWL1_PICK_Z) <= GRASP_TOL;
    L.catch2 = Math.abs(z2AtGrasp - BOWL2_PICK_Z) <= GRASP_TOL;
    // Time each missed bowl clears the pickup zone cleanly.
    L.miss1T = BOWL1_PICK_T + (GRASP_TOL / BELT_SPEED) + 0.4;
    L.miss2T = BOWL2_PICK_T + (GRASP_TOL / BELT_SPEED) + 0.4;
    const passCount = Math.min(L.total, SPAN);
    L.passes = Array.from({ length: passCount }, (_, s) => {
      const init = !!L.init && s < L.init;
      const delivers = L.T.includes(s + 1);
      return { s, init, delivers };
    });
  }

  const ticksHtml = [0, 5, 10, 15, 20, 25]
    .map(v => `<span style="left:${(v / SPAN * 100).toFixed(2)}%">${v}</span>`)
    .join('');

  const canvasA = root.querySelector('.fig-canvas');
  canvasA.classList.add('race-studio');
  canvasA.innerHTML = `
    <div class="race-heading"><p><span class="m">N</span> = 5 noise levels per action chunk · live moving conveyor on one shared clock</p></div>
    <div class="race-scenes"></div>
    <div class="race-timeline" role="img" aria-label="Over 25 shared forward passes on the same moving conveyor, OneFlow delivers all 14 action chunks in 18 passes and stacks both bowls, while Native delivers only 5 chunks and misses both moving bowls.">
      <div class="race-timeline-heading"><span>Forward passes over one shared conveyor clock</span></div>
      <div class="race-ticks">${ticksHtml}</div>
      <div class="race-tapes"></div>
    </div>
    <div class="race-player">
      <button class="race-restart" type="button" aria-label="Replay comparison">Replay</button>
      <div class="race-scrubber"><label for="race-time">Elapsed passes <output id="race-elapsed">0 / ${SPAN}</output></label><input id="race-time" type="range" min="0" max="${SPAN}" step="0.05" value="0" aria-label="Comparison time in forward passes"></div>
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
        <div class="race-execution"><div class="race-viewport robot-surface" role="img" aria-label="${L.title}: Panda arm over a continuously moving conveyor belt carrying two bowls"></div><div class="race-execution-count"><strong class="race-chunks">0<span> / 2</span></strong><span class="race-count-label">bowls stacked</span></div></div>
      </div>
      <div class="race-card-footer"><span class="race-method-note">${L.ours ? '1 batched pass / step' : '5 serial passes / step'}</span><span class="race-pass-count"><strong>0</strong> / ${CHUNKS} chunks</span></div>`;
    sceneGrid.appendChild(card);
    const levelRoot = card.querySelector('.race-levels');
    const trace = i => {
      const z = 1 - i / NATIVE, pts = Array.from({ length: 25 }, (_, q) => `${(q * 2.5).toFixed(1)},${(2 + 7 * (1 - PF.blend(PF.signal(q / 4), z, q / 4, 3))).toFixed(1)}`);
      return `<svg viewBox="0 0 60 11" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${PF.waveInk(z)}" stroke-width="1.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
    };
    const chunk = (i, output) => `<span class="race-mini-chunk${output ? ' race-mini-output' : ''}" style="--level:${PF.level(i, NATIVE)}">${'<i></i>'.repeat(6)}${trace(i)}</span>`;
    L.rows = Array.from({ length: NATIVE }, (_, i) => {
      const row = document.createElement('div');
      row.className = 'race-level';
      row.innerHTML = `<span class="race-noise-label">t<sub>${i}</sub></span>${chunk(i, false)}<span class="race-level-arrow" aria-hidden="true">→</span>${chunk(i + 1, true)}<span class="race-noise-label">t<sub>${i + 1}</sub></span>`;
      levelRoot.appendChild(row);
      return row;
    });
    L.levelRoot = levelRoot;
    L.batchNote = card.querySelector('.race-batch-note');
    const viewport = card.querySelector('.race-viewport');
    const fallbackScene = () => {
      viewport.replaceChildren();
      const svg = el('svg', { viewBox: '0 0 100 66', 'aria-hidden': 'true' }, viewport);
      L.sc = scene(svg, 0, 0, 100, { plan: false });
    };
    L.sc = window.PFRobotStudio?.mount(viewport, { width: 600, height: 396, view: 'studio', plan: false, onFail: fallbackScene });
    if (!L.sc) fallbackScene();
    L.status = card.querySelector('.race-status');
    L.count = card.querySelector('.race-chunks');
    L.countLabel = card.querySelector('.race-count-label');
    L.passCount = card.querySelector('.race-pass-count strong');
    const tape = document.createElement('div');
    tape.className = `race-tape${L.ours ? ' race-tape-ours' : ''}`;
    tape.innerHTML = `<span class="race-tape-label">${L.title}</span><div class="race-tape-track"><div class="race-tape-cells"></div><div class="race-tape-head"></div></div><strong class="race-tape-res">0/2</strong>`;
    canvasA.querySelector('.race-tapes').appendChild(tape);
    L.tapeHead = tape.querySelector('.race-tape-head');
    L.tapeRes = tape.querySelector('.race-tape-res');
    L.tapeCells = L.passes.map(pass => {
      const cell = document.createElement('span');
      cell.className = pass.init ? 'race-tape-cell is-init' : pass.delivers ? 'race-tape-cell is-deliver' : 'race-tape-cell';
      cell.style.left = `${pass.s / SPAN * 100}%`;
      cell.style.width = `${100 / SPAN}%`;
      tape.querySelector('.race-tape-cells').appendChild(cell);
      return cell;
    });
  });

  const slider = canvasA.querySelector('#race-time'), clock = canvasA.querySelector('#race-elapsed');
  slider.addEventListener('input', () => root.dispatchEvent(new CustomEvent('pf:seek', { detail: Number(slider.value) })));
  canvasA.querySelector('.race-restart').addEventListener('click', () => root.dispatchEvent(new CustomEvent('pf:replay')));
  canvasA.querySelector('select').addEventListener('change', event => root.dispatchEvent(new CustomEvent('pf:rate', { detail: Number(event.target.value) })));

  play(root, {
    duration: SPAN, unitMs: 360, holdMs: 2200, still: 18.8, progress: false,
    render(t) {
      for (const L of LANES) {
        const n = L.T.filter(delivery => t >= delivery).length;
        const done = t >= L.total, init = !!L.init && t < L.init;
        const simultaneous = L.ours && !init;
        let p = 0, state = init ? 'initializing' : 'waiting';
        if (n > 0) {
          const k = n - 1, f = clamp((t - L.T[k]) / MOVE);
          p = k + f;
          state = f < 1 ? 'moving' : n === CHUNKS ? 'done' : 'waiting';
        }
        L.sc.set(p, null, { clock: t, catch1: L.catch1, catch2: L.catch2 });

        const stacked = (L.catch1 && p >= 5.15 ? 1 : 0) + (L.catch2 && p >= 11.15 ? 1 : 0);
        const missed = (!L.catch1 && t >= L.miss1T ? 1 : 0) + (!L.catch2 && t >= L.miss2T ? 1 : 0);
        if (missed > 0 && state !== 'moving') state = 'missed';

        L.status.dataset.state = state;
        L.status.textContent = {
          initializing: 'Initializing',
          waiting: 'Computing',
          moving: 'Executing',
          done: 'Complete',
          missed: missed > 1 ? 'Missed both' : 'Missed bowl',
        }[state];

        const countKey = `${stacked}:${missed}`;
        if (L.lastCount !== countKey) {
          if (missed > 0 && stacked === 0) {
            L.count.innerHTML = `${missed}<span> / 2</span>`;
            L.countLabel.textContent = 'bowls missed';
          } else {
            L.count.innerHTML = `${stacked}<span> / 2</span>`;
            L.countLabel.textContent = 'bowls stacked';
          }
          L.tapeRes.textContent = missed > 0 && stacked === 0 ? `0/2` : `${stacked}/2`;
          L.lastCount = countKey;
        }
        L.passCount.textContent = n;

        const phase = Math.min(NATIVE - 1, Math.floor(t) % NATIVE), fraction = t - Math.floor(t);
        L.levelRoot.dataset.mode = simultaneous ? 'batch' : 'serial';
        L.levelRoot.setAttribute('aria-label', simultaneous ? 'All noise levels are evaluated together in one batched forward pass.' : 'A single noise level is evaluated per forward pass, in sequence.');
        L.levelRoot.classList.toggle('is-complete', done);
        L.rows.forEach((row, i) => {
          const active = !done && (simultaneous || i === phase);
          row.classList.toggle('is-active', active);
          row.classList.toggle('is-reached', done || (!simultaneous && i < phase));
          row.style.setProperty('--pass-progress', active ? fraction : done || (!simultaneous && i < phase) ? 1 : 0);
        });
        const note = done
          ? 'Both moving bowls stacked · 18 passes'
          : missed > 0
            ? 'Belt keeps moving while policy stalls'
            : init
              ? 'Native initialization · 5 serial passes'
              : simultaneous
                ? 'All levels together · 1 batched pass / step'
                : '5 dependent passes → 1 clean chunk';
        if (L.batchNote.textContent !== note) L.batchNote.textContent = note;
        L.tapeCells.forEach((cell, i) => cell.style.setProperty('--fill', clamp(t - L.passes[i].s)));
        L.tapeHead.style.left = `${Math.min(t, SPAN) / SPAN * 100}%`;
      }
      slider.value = t;
      clock.textContent = `${Math.min(SPAN, Math.floor(t))} / ${SPAN}`;
      slider.setAttribute('aria-valuetext', `${Math.min(SPAN, Math.floor(t))} forward passes elapsed`);
    },
  });
})();
