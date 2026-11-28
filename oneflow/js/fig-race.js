// Act 01 figure: two samplers control the same 7-DoF Panda arm over an identical continuously
// moving conveyor belt on one shared clock (forward passes, N = 5 noise levels per chunk).
// OneFlow runs C1-continuously (MOVE = 1) after its 5-pass init and stacks both bowls in 21 passes.
// Native stalls 4 of every 5 passes (MOVE = 0.85 with min-jerk stop-start), misses both grasp
// windows, snaps shut on empty air at t ≈ 15.5, and both bowls roll off the far roller onto the floor.
(function () {
  const { el, scene, play, clamp } = PF;
  const root = document.getElementById('fig-race');
  if (!root) return;

  const STUDIO = window.PFRobotStudio || {};
  const M0 = STUDIO.meta || STUDIO.DEFAULTS || {
    chunks: 16, nativeSteps: 5, span: 25, still: 23.5,
    beltHalfLen: 0.30, beltSpeed: 0.036, graspTol: 0.032,
    bowl1StartZ: 0.08, bowl1StartT: 7.0,
    bowl2StartZ: -0.02, bowl2StartT: 14.0,
    latch1P: 2.62, latch2P: 9.62, release1P: 5.42, release2P: 12.42,
  };

  const CHUNKS = M0.chunks || 16;
  const NATIVE = M0.nativeSteps || 5;
  const SPAN = M0.span || 25;
  const STILL = M0.still || 23.5;
  const NATIVE_MOVE = 0.85;

  const minJerk = u => {
    u = clamp(u);
    return u * u * u * (10 - 15 * u + 6 * u * u);
  };
  // Inverse of minJerk(u) = target via 16-step bisection (exact to 1e-5) for latch timing.
  function invMinJerk(target) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) * 0.5;
      if (minJerk(mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  // Evaluate catch & exact latch times from single-source-of-truth trajectory kinematics.
  const LANES = [
    { title: 'OneFlow', sub: '1 pass / step', per: 1, init: NATIVE, ours: true },
    { title: 'Native', sub: '5 passes / step', per: NATIVE, init: 0, ours: false },
  ];

  const landTime = STUDIO.bowlLandTime || ((z0, t0, half, v) => t0 + (z0 + half) / v + 0.56);
  const BOWL1_LAND_T = landTime(M0.bowl1StartZ, M0.bowl1StartT, M0.beltHalfLen, M0.beltSpeed);
  const BOWL2_LAND_T = landTime(M0.bowl2StartZ, M0.bowl2StartT, M0.beltHalfLen, M0.beltSpeed);

  // Grasp tracking windows on the shared clock (1 pass wide, aligned to belt-tracking chunks 2 and 9).
  const WIN1 = [M0.bowl1StartT, M0.bowl1StartT + 1];
  const WIN2 = [M0.bowl2StartT, M0.bowl2StartT + 1];

  function evalLanePhysics(L, meta) {
    L.T = Array.from({ length: CHUNKS }, (_, k) => (L.init ? L.init + k * L.per : (k + 1) * L.per));
    L.total = L.T[CHUNKS - 1] + (L.ours ? 1 : 0);

    const frac1 = meta.latch1P - Math.floor(meta.latch1P);
    const frac2 = meta.latch2P - Math.floor(meta.latch2P);
    // Exact clock t when gripper finishes closing on chunk 2 (Bowl 1) and chunk 9 (Bowl 2).
    L.tLatch1 = L.ours ? L.T[2] + frac1 : L.T[2] + invMinJerk(frac1) * NATIVE_MOVE;
    L.tLatch2 = L.ours ? L.T[9] + frac2 : L.T[9] + invMinJerk(frac2) * NATIVE_MOVE;

    const tcp1 = STUDIO.sampleTcp?.(meta.latch1P);
    const tcp2 = STUDIO.sampleTcp?.(meta.latch2P);
    const tcp1Z = tcp1 ? tcp1.z : meta.bowl1StartZ - frac1 * meta.beltSpeed;
    const tcp2Z = tcp2 ? tcp2.z : meta.bowl2StartZ - frac2 * meta.beltSpeed;

    const z1AtLatch = meta.bowl1StartZ - (L.tLatch1 - meta.bowl1StartT) * meta.beltSpeed;
    const z2AtLatch = meta.bowl2StartZ - (L.tLatch2 - meta.bowl2StartT) * meta.beltSpeed;
    L.catch1 = Math.abs(z1AtLatch - tcp1Z) <= meta.graspTol;
    L.catch2 = Math.abs(z2AtLatch - tcp2Z) <= meta.graspTol;

    // Pass timeline cells (OneFlow 0..20 = 21 passes; Native 0..24 = 25 passes)
    const passCount = Math.min(L.total, SPAN);
    L.passes = Array.from({ length: passCount }, (_, s) => {
      const init = !!L.init && s < L.init;
      const delivers = L.ours ? s >= L.init && s < L.total : (s + 1) % NATIVE === 0;
      return { s, init, delivers };
    });
  }

  LANES.forEach(L => evalLanePhysics(L, M0));

  const ticksHtml = [0, 5, 10, 15, 20, 25]
    .map(v => `<span style="left:${(v / SPAN * 100).toFixed(2)}%">${v}</span>`)
    .join('');

  const winCaptionsHtml = [
    { win: WIN1, label: 'Bowl 1' },
    { win: WIN2, label: 'Bowl 2' },
  ].map(({ win, label }) => {
    const mid = ((win[0] + win[1]) * 0.5 / SPAN * 100).toFixed(2);
    return `<span style="left:${mid}%">${label}</span>`;
  }).join('');

  // Subtle 1px denoised waveform inside each of the 5 horizontal rail capsules (jagged -> smooth)
  function capsuleWave(i) {
    const z = 1 - (i + 0.5) / NATIVE;
    const pts = Array.from({ length: 21 }, (_, q) => {
      const x = (q * 3).toFixed(1);
      const y = (3 + 10 * (1 - PF.blend(PF.signal(q / 3.5), z, q / 3.5, 3))).toFixed(1);
      return `${x},${y}`;
    });
    return `<svg class="race-cap-wave" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  const chevronSvg = '<svg class="race-rail-chev" viewBox="0 0 6 10" aria-hidden="true"><path d="M1 1.5 L4.5 5 L1 8.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const canvasA = root.querySelector('.fig-canvas');
  canvasA.classList.add('race-studio');
  canvasA.innerHTML = `
    <div class="race-scenes"></div>
    <div class="race-timeline" role="img" aria-label="Over 25 shared forward passes on the same moving conveyor, OneFlow delivers all 16 action chunks in 21 passes and stacks both bowls, while Native delivers 5 chunks, misses both grasp windows, and drops both bowls off the belt.">
      <div class="race-timeline-head">
        <span class="race-timeline-title">Forward passes</span>
        <span class="race-timeline-legend">
          <span><i class="race-key-win"></i>Grasp window</span>
          <span><i class="race-key-dot"></i>Gripper closes</span>
        </span>
      </div>
      <div class="race-ticks">${ticksHtml}</div>
      <div class="race-tapes"></div>
      <div class="race-win-captions" aria-hidden="true">${winCaptionsHtml}</div>
    </div>
    <div class="race-player">
      <div class="race-player-btns">
        <button class="race-icon-btn race-play-btn" type="button" aria-label="Play or pause comparison">
          <svg class="i-play" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 1.8 L10.2 6 L3.2 10.2 Z" fill="currentColor"/></svg>
          <svg class="i-pause" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.2" y="1.8" width="2.4" height="8.4" rx="0.7" fill="currentColor"/><rect x="7.4" y="1.8" width="2.4" height="8.4" rx="0.7" fill="currentColor"/></svg>
        </button>
        <button class="race-icon-btn race-restart" type="button" aria-label="Replay comparison">
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.6 7a4.4 4.4 0 1 0 1.3-3.1" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/><path d="M2.6 1.8v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="race-scrubber">
        <div class="race-scrub-track">
          <span class="race-scrub-fill"></span>
          <input id="race-time" type="range" min="0" max="${SPAN}" step="0.02" value="0" aria-label="Comparison time in forward passes">
        </div>
        <output id="race-elapsed" class="race-elapsed">0 / ${SPAN}</output>
      </div>
      <div class="race-views race-speeds" role="group" aria-label="Playback speed">
        <button type="button" data-rate="0.5" aria-pressed="false">0.5×</button>
        <button type="button" data-rate="1" aria-pressed="true">1×</button>
        <button type="button" data-rate="2" aria-pressed="false">2×</button>
      </div>
    </div>
  `;

  const sceneGrid = canvasA.querySelector('.race-scenes');
  const tapesRoot = canvasA.querySelector('.race-tapes');

  // Shared vertical grasp-window bands crossing both OneFlow and Native timeline tracks
  const winBandHtml = [
    { win: WIN1, label: 'B1' },
    { win: WIN2, label: 'B2' },
  ].map(({ win }) => {
    const left = (win[0] / SPAN * 100).toFixed(3);
    const width = ((win[1] - win[0]) / SPAN * 100).toFixed(3);
    return `<span class="race-win-band" style="left:${left}%;width:${width}%" aria-hidden="true"></span>`;
  }).join('');

  LANES.forEach(L => {
    const card = document.createElement('article');
    card.className = `race-card${L.ours ? ' race-card-ours' : ''}`;
    const railCapsHtml = Array.from({ length: NATIVE }, (_, i) =>
      `<span class="race-cap" data-i="${i}"><i class="race-cap-fill"></i>${capsuleWave(i)}</span>`
    ).join(chevronSvg);

    card.innerHTML = `
      <header class="race-card-heading">
        <div class="race-card-id">
          <h4>${L.title}</h4>
          <span class="race-method">${L.sub}</span>
        </div>
        <div class="race-card-right">
          <span class="race-status" data-state="waiting">Computing</span>
          <span class="race-score" aria-label="Bowls stacked"><strong>0</strong><span>/2</span></span>
        </div>
      </header>
      <div class="race-stage">
        <div class="race-viewport robot-surface" role="img" aria-label="${L.title}: Franka Panda arm over a continuously moving conveyor carrying two ceramic bowls"></div>
      </div>
      <div class="race-rail" data-mode="${L.ours ? 'init' : 'serial'}" role="img" aria-label="${L.ours ? 'Five noise levels denoised together in one batched pass per step' : 'Five noise levels denoised sequentially, one pass per level'}">
        <span class="race-rail-edge">t<sub>0</sub></span>
        <div class="race-rail-caps">${railCapsHtml}</div>
        <span class="race-rail-edge">t<sub>5</sub></span>
      </div>
    `;
    sceneGrid.appendChild(card);

    L.rail = card.querySelector('.race-rail');
    L.caps = Array.from(card.querySelectorAll('.race-cap'));
    L.capFills = L.caps.map(c => c.querySelector('.race-cap-fill'));
    L.status = card.querySelector('.race-status');
    L.scoreNum = card.querySelector('.race-score strong');

    const viewport = card.querySelector('.race-viewport');
    const fallbackScene = () => {
      viewport.replaceChildren();
      const svg = el('svg', { viewBox: '0 0 100 66', 'aria-hidden': 'true' }, viewport);
      L.sc = scene(svg, 0, 0, 100, { plan: false });
    };
    L.sc = STUDIO.mount?.(viewport, { view: 'studio', plan: false, onFail: fallbackScene });
    if (!L.sc) fallbackScene();

    // Timeline tape track with grasp window bands + exact latch dots
    const tape = document.createElement('div');
    tape.className = `race-tape${L.ours ? ' race-tape-ours' : ''}`;
    const latchDots = L.ours
      ? [L.tLatch1, L.tLatch2]
      : [L.tLatch1];
    const dotsHtml = latchDots.map(tl =>
      `<span class="race-latch-dot${L.ours ? ' is-hit' : ' is-miss'}" style="left:${(tl / SPAN * 100).toFixed(3)}%" data-t="${tl.toFixed(3)}" aria-hidden="true"></span>`
    ).join('');

    tape.innerHTML = `
      <span class="race-tape-label">${L.title}</span>
      <div class="race-tape-track">
        <div class="race-win-layer">${winBandHtml}</div>
        <div class="race-tape-cells"></div>
        <div class="race-latch-layer">${dotsHtml}</div>
        <div class="race-tape-head"></div>
      </div>
      <strong class="race-tape-res">0/2</strong>
    `;
    tapesRoot.appendChild(tape);
    L.tapeTrack = tape.querySelector('.race-tape-track');
    L.tapeHead = tape.querySelector('.race-tape-head');
    L.tapeRes = tape.querySelector('.race-tape-res');
    L.latchDotEls = Array.from(tape.querySelectorAll('.race-latch-dot'));
    L.tapeCells = L.passes.map(pass => {
      const cell = document.createElement('span');
      cell.className = pass.init
        ? 'race-tape-cell is-init'
        : pass.delivers
          ? 'race-tape-cell is-deliver'
          : 'race-tape-cell';
      cell.style.left = `${(pass.s / SPAN * 100).toFixed(4)}%`;
      cell.style.width = `${(100 / SPAN).toFixed(4)}%`;
      tape.querySelector('.race-tape-cells').appendChild(cell);
      return cell;
    });
  });

  // Re-verify catch evaluation once motion.gz finishes loading
  Promise.all(LANES.map(L => L.sc?.ready).filter(Boolean)).then(() => {
    if (STUDIO.motion?.meta) LANES.forEach(L => evalLanePhysics(L, STUDIO.motion.meta));
  });

  // Custom Apple controls wiring
  const slider = canvasA.querySelector('#race-time');
  const scrubFill = canvasA.querySelector('.race-scrub-fill');
  const clockEl = canvasA.querySelector('#race-elapsed');
  const playBtn = canvasA.querySelector('.race-play-btn');
  const speedBtns = Array.from(canvasA.querySelectorAll('.race-speeds button'));

  slider.addEventListener('input', () => {
    root.dispatchEvent(new CustomEvent('pf:seek', { detail: Number(slider.value) }));
  });
  playBtn.addEventListener('click', () => {
    root.dispatchEvent(new CustomEvent('pf:toggle'));
  });
  canvasA.querySelector('.race-restart').addEventListener('click', () => {
    root.dispatchEvent(new CustomEvent('pf:replay'));
  });
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const rate = Number(btn.dataset.rate);
      speedBtns.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      root.dispatchEvent(new CustomEvent('pf:rate', { detail: rate }));
    });
  });

  // Cache track width for crisp device-pixel-aligned transform on the 2px playhead
  let trackWidth = 0;
  const updateTrackWidth = () => {
    const w = LANES[0]?.tapeTrack?.getBoundingClientRect().width || 0;
    if (w > 0) trackWidth = w;
  };
  if (typeof ResizeObserver === 'function' && LANES[0]?.tapeTrack) {
    new ResizeObserver(updateTrackWidth).observe(LANES[0].tapeTrack);
  }
  updateTrackWidth();

  play(root, {
    duration: SPAN,
    unitMs: 360,
    holdMs: 2400,
    still: STILL,
    progress: false,
    render(t) {
      const meta = STUDIO.motion?.meta || M0;
      const dpr = window.devicePixelRatio || 1;
      const passIdx = Math.floor(t);
      const frac = t - passIdx;

      for (const L of LANES) {
        let p = 0;
        let state = 'waiting';
        const done = L.ours && t >= L.total;
        const init = !!L.init && t < L.init;

        if (L.ours) {
          // OneFlow: 5-pass serial init, then C1 continuous execution (MOVE = 1, p = t - 5)
          if (t >= L.init) {
            p = clamp(t - L.init, 0, CHUNKS);
            state = t >= L.total ? 'done' : 'moving';
          } else {
            p = 0;
            state = 'initializing';
          }
        } else {
          // Native: delivers one chunk every 5 serial passes, stop-and-start with minJerk over 0.85 pass
          const n = L.T.filter(delivery => t >= delivery).length;
          if (n > 0) {
            const k = n - 1;
            const u = clamp((t - L.T[k]) / NATIVE_MOVE);
            p = k + minJerk(u);
            state = u < 1 ? 'moving' : 'waiting';
          }
        }

        // Update 3D studio scene on shared world clock `t`
        L.sc.set(p, null, {
          clock: t,
          catch1: L.catch1,
          catch2: L.catch2,
          missSnapT: L.ours ? null : L.tLatch1,
        });

        // Stacked count transitions strictly at release-open completion (zero premature jump)
        const stacked =
          (L.catch1 && p >= meta.release1P ? 1 : 0) +
          (L.catch2 && p >= meta.release2P ? 1 : 0);
        // Missed count updates only after the bowl actually hits the floor (or after empty snap for status)
        const landedMissed =
          (!L.catch1 && t >= BOWL1_LAND_T ? 1 : 0) +
          (!L.catch2 && t >= BOWL2_LAND_T ? 1 : 0);
        const snappedMiss = !L.ours && !L.catch1 && t >= L.tLatch1 + 0.35;

        // Native status never flashes back to Executing once it has snapped empty / dropped bowls
        let pillState = state;
        let pillText = {
          initializing: 'Warming up',
          waiting: 'Computing',
          moving: 'Executing',
          done: 'Complete',
        }[state];
        if (!L.ours && (snappedMiss || landedMissed > 0)) {
          pillState = 'missed';
          pillText = landedMissed >= 2 ? 'Missed both' : 'Missed';
        }

        if (L.lastPill !== `${pillState}:${pillText}`) {
          L.status.dataset.state = pillState;
          L.status.textContent = pillText;
          L.lastPill = `${pillState}:${pillText}`;
        }

        if (L.lastScore !== stacked) {
          L.scoreNum.textContent = stacked;
          L.tapeRes.textContent = `${stacked}/2`;
          L.lastScore = stacked;
        }

        // ---------- 36px Horizontal 5-stage denoising capsule rail (purely deterministic in t) ----------
        const mode = done ? 'done' : L.ours ? (init ? 'init' : 'batch') : 'serial';
        if (L.rail.dataset.mode !== mode) L.rail.dataset.mode = mode;

        const phase = passIdx % NATIVE;
        const justDelivered = L.ours
          ? (!init && !done && frac < 0.22)
          : (t >= NATIVE && phase === 0 && frac < 0.22);

        for (let i = 0; i < NATIVE; i++) {
          let fill = 0;
          let capState = 'idle';
          if (done) {
            fill = 1;
            capState = 'done';
          } else if (L.ours && init) {
            // Honest 5-pass warmup staircase: pass s fills capsule s while 0..s-1 remain filled
            if (i < passIdx) { fill = 1; capState = 'warm'; }
            else if (i === passIdx) { fill = frac; capState = 'active'; }
          } else if (L.ours) {
            // Steady-state parallel pipeline: all 5 levels sweep in unison; t5 ticks on chunk delivery
            fill = frac;
            capState = (i === NATIVE - 1 && justDelivered) ? 'emit' : 'active';
          } else {
            // Native serial denoising: single level advances left-to-right across 5 passes
            if (i < phase) { fill = 1; capState = 'reached'; }
            else if (i === phase) { fill = frac; capState = 'active'; }
            if (i === NATIVE - 1 && justDelivered) { fill = 1; capState = 'emit'; }
          }
          L.capFills[i].style.transform = `scaleX(${fill.toFixed(4)})`;
          if (L.caps[i].dataset.state !== capState) L.caps[i].dataset.state = capState;
        }

        // ---------- Shared-clock timeline cells, latch dots & crisp 2px playhead ----------
        for (let i = 0; i < L.tapeCells.length; i++) {
          L.tapeCells[i].style.setProperty('--fill', clamp(t - L.passes[i].s).toFixed(4));
        }
        L.latchDotEls.forEach(dot => {
          const dt = Number(dot.dataset.t);
          dot.classList.toggle('is-reached', t >= dt);
        });
        const ratio = Math.min(t, SPAN) / SPAN;
        if (trackWidth > 0) {
          const px = Math.round(ratio * trackWidth * dpr) / dpr;
          L.tapeHead.style.transform = `translateX(${px}px)`;
        } else {
          L.tapeHead.style.left = `${(ratio * 100).toFixed(3)}%`;
        }
      }

      // Scrubber + tabular pass counter
      slider.value = t;
      scrubFill.style.transform = `scaleX(${(Math.min(t, SPAN) / SPAN).toFixed(4)})`;
      const shownPass = Math.min(SPAN, Math.floor(t));
      clockEl.textContent = `${shownPass} / ${SPAN}`;
      slider.setAttribute('aria-valuetext', `${shownPass} of ${SPAN} forward passes`);
    },
  });
})();
