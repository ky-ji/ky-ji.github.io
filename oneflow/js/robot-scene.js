// Shared, locally hosted 3D Franka Panda studio running a real-time conveyor-belt bowl-stacking duel.
// Single source of truth: loads gzipped `motion.gz` baked by scripts/project-page/solve_robot_motion.py
// containing exact joint angles, Three.js TCP coordinates, gripper closure, and shared physics constants.
// Both policies share one world clock `t` (in forward passes): the conveyor belt, rollers, and bowls
// advance continuously even when a policy stalls computing. Missed bowls roll off the far roller with
// closed-form reversible ballistic physics and settle inverted on the studio floor.
(function () {
  "use strict";
  let T = window.THREE;
  const SCRIPT = document.currentScript.src;
  const ASSETS = new URL("../assets/robot/", SCRIPT);
  const THREE_URL = new URL("vendor/three.min.js", SCRIPT);
  const POSTER_VER = "20261128p";
  const clients = new Set();
  let studio, studioLoad;

  // Fallback defaults mirroring motion.gz metadata until the gzipped trajectory resolves.
  const DEFAULTS = {
    chunks: 16,
    nativeSteps: 5,
    span: 25,
    still: 23.5,
    beltX: 0.53,
    beltTop: 0.042,
    beltHalfLen: 0.30,
    beltSpeed: 0.036,
    padX: 0.30,
    padZ: 0.20,
    padTop: 0.004,
    bowlGripY: 0.018,
    fingerOpen: 0.04,
    fingerClosed: 0.0288,
    graspTol: 0.032,
    bowl1StartZ: 0.08,
    bowl1StartT: 7.0,
    bowl2StartZ: -0.02,
    bowl2StartT: 14.0,
    latch1P: 2.62,
    latch2P: 9.62,
    release1P: 5.42,
    release2P: 12.42,
    graspSeg1: 2,
    graspSeg2: 9,
  };

  // Self-contained precision conveyor (z in [-0.30, +0.36]) so both machined end rollers
  // sit cleanly inside the studio frame; bowls gently fade in at full scale over z in [0.36, 0.31].
  const BELT_ENTRY_Z = 0.36;
  const ROLLER_R = 0.019;
  const BOWL_RIM_H = 0.036;
  const BOWL_RIM_R = 0.0322;
  const BOWL_BOT_R = 0.022;
  const GRAVITY = 1.27; // 9.81 m/s^2 * (0.36 s/pass)^2

  // Closed-form drop-off timing constants (reversible for arbitrary forward/backward scrubbing).
  const TIP_TAU = 0.34;
  const FALL_Y0 = 0.037;
  const FALL_VY0 = -0.03;
  const FALL_TAU =
    (-FALL_VY0 + Math.sqrt(FALL_VY0 * FALL_VY0 + 2 * GRAVITY * FALL_Y0)) / GRAVITY; // ~0.219 pass
  const BOUNCE_TAU = 0.22;

  const canWebGL = (() => {
    if (T) return true;
    try {
      const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      return !!(c.getContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      return false;
    }
  })();

  function loadThree() {
    if (T) return Promise.resolve(T);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = THREE_URL.href;
      s.async = true;
      s.onload = () => {
        T = window.THREE;
        T ? resolve(T) : reject(Error("THREE missing"));
      };
      s.onerror = () => reject(Error("three.min.js could not load"));
      document.head.appendChild(s);
    });
  }

  const clamp01 = (u) => Math.max(0, Math.min(1, u));
  const smoothstep = (u) => {
    u = clamp01(u);
    return u * u * (3 - 2 * u);
  };

  // Exact floor clearance height of the bowl origin at pitch angle `theta` in [0, pi]
  // so neither bottom nor rim ever dips beneath y = 0.
  function bowlFloorY(theta) {
    const s = Math.abs(Math.sin(theta));
    const c = Math.cos(theta);
    const low = Math.min(-BOWL_BOT_R * s, BOWL_RIM_H * c - BOWL_RIM_R * s);
    return -low;
  }

  // Compute closed-form world pose for a bowl riding on the conveyor or tumbling off the far roller.
  // Returns { visible, opacity, x, y, z, rx, ry, rz, surfaceY, landed }.
  function evalFreeBowl(zFree, beltX, beltTop, beltHalfLen, beltSpeed, bowlIndex) {
    if (zFree > BELT_ENTRY_Z + 0.01) {
      return { visible: false, opacity: 0, x: beltX, y: beltTop, z: zFree, rx: 0, ry: 0, rz: 0, surfaceY: beltTop, landed: false };
    }
    if (zFree >= -beltHalfLen) {
      const opacity = smoothstep((BELT_ENTRY_Z + 0.01 - zFree) / 0.055);
      return { visible: opacity > 0.01, opacity, x: beltX, y: beltTop, z: zFree, rx: 0, ry: 0, rz: 0, surfaceY: beltTop, landed: false };
    }

    const side = bowlIndex === 1 ? -1 : 1;
    const xRest = beltX + side * 0.039;
    const zRest = bowlIndex === 1 ? -0.376 : -0.382;
    const over = -beltHalfLen - zFree;
    const tau = over / beltSpeed;

    // Phase A: pivot forward over the far roller crest with subtle deterministic roll/yaw asymmetry.
    if (tau < TIP_TAU) {
      const u = tau / TIP_TAU;
      const u2 = u * u;
      const rx = -0.54 * u2;
      const rz = side * 0.16 * u2;
      const ry = side * 0.18 * u2;
      const x = beltX + side * 0.008 * u2;
      const z = -beltHalfLen - beltSpeed * tau;
      const y = beltTop - (beltTop - FALL_Y0) * u2;
      return { visible: true, opacity: 1, x, y, z, rx, ry, rz, surfaceY: 0, landed: false };
    }

    // Phase B: ballistic drop from roller edge to studio floor while completing flip to inverted rim.
    const tf = tau - TIP_TAU;
    const xTip = beltX + side * 0.008;
    const zTip = -beltHalfLen - beltSpeed * TIP_TAU;
    if (tf < FALL_TAU) {
      const u = tf / FALL_TAU;
      const us = smoothstep(u);
      const rx = -0.54 - (Math.PI - 0.54) * (0.25 * u + 0.75 * us);
      const rz = side * 0.16 * (1 - u);
      const ry = side * (0.18 + 0.07 * u);
      const x = xTip + (xRest - xTip) * (0.25 * u + 0.75 * us);
      const z = zTip + (zRest - zTip) * u;
      const yBallistic = FALL_Y0 + FALL_VY0 * tf - 0.5 * GRAVITY * tf * tf;
      const yMin = bowlFloorY(Math.abs(rx));
      const y = Math.max(yMin, yBallistic);
      return { visible: true, opacity: 1, x, y, z, rx, ry, rz, surfaceY: 0, landed: false };
    }

    // Phase C: single damped rim bounce, then motionless inverted rest on floor (y = 0.036).
    const ts = tf - FALL_TAU;
    if (ts < BOUNCE_TAU) {
      const u = ts / BOUNCE_TAU;
      const hop = 0.0065 * Math.sin(Math.PI * u) * (1 - 0.7 * u);
      const rock = 0.11 * Math.sin(Math.PI * 1.5 * u) * (1 - u);
      return {
        visible: true,
        opacity: 1,
        x: xRest,
        y: BOWL_RIM_H + hop,
        z: zRest,
        rx: -Math.PI + rock,
        ry: side * 0.25,
        rz: side * 0.04 * (1 - u),
        surfaceY: 0,
        landed: true,
      };
    }

    return {
      visible: true,
      opacity: 1,
      x: xRest,
      y: BOWL_RIM_H,
      z: zRest,
      rx: -Math.PI,
      ry: side * 0.25,
      rz: 0,
      surfaceY: 0,
      landed: true,
    };
  }

  // Exact time `t` when bowl i lands on the studio floor if missed.
  function bowlLandTime(startZ, startT, beltHalfLen, beltSpeed) {
    const tEdge = startT + (startZ - -beltHalfLen) / beltSpeed;
    return tEdge + TIP_TAU + FALL_TAU;
  }

  function createStudio() {
    if (!T) return null;
    const renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(1);
    renderer.setSize(960, 600, false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.AgXToneMapping || T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    const world = new T.Scene();
    const camera = new T.PerspectiveCamera(28, 16 / 10, 0.05, 20);

    // ---------- Product-photography PMREM environment with softboxes + black flags ----------
    const env = new T.Scene();
    env.background = new T.Color("#222226");
    function envCard(x, y, z, w, h, color) {
      const m = new T.Mesh(
        new T.PlaneGeometry(w, h),
        new T.MeshBasicMaterial({ color, side: T.DoubleSide }),
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    }
    // Overhead elongated key softbox (6.6), left side softbox (3.3), cool soft rear fill (1.4)
    envCard(0.0, 5.2, 0.4, 7.6, 2.6, new T.Color(6.6, 6.6, 6.6));
    envCard(-3.8, 3.0, 2.8, 4.6, 4.6, new T.Color(3.3, 3.35, 3.45));
    envCard(3.6, 1.8, -2.4, 3.6, 3.6, new T.Color(1.4, 1.48, 1.58));
    // Pure black flags (negative fill) carving Leica/Apple dark contour reflections on white surfaces
    envCard(-2.8, 0.6, -2.6, 3.4, 3.6, new T.Color(0, 0, 0));
    envCard(2.6, 0.4, 2.8, 3.0, 3.0, new T.Color(0, 0, 0));

    const pmrem = new T.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(env, 0.04);
    world.environment = envMap.texture;
    pmrem.dispose();
    env.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });

    // ---------- Studio lighting: key + subtle hemisphere + crisp white rim light ----------
    world.add(new T.HemisphereLight("#f8f8fa", "#46464a", 0.42));

    const key = new T.DirectionalLight("#fffcf7", 2.3);
    key.position.set(-0.6, 2.4, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {
      left: -0.68,
      right: 0.68,
      top: 0.68,
      bottom: -0.68,
      near: 0.5,
      far: 4.5,
    });
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.0008;
    key.target.position.set(0.32, 0.12, -0.04);
    world.add(key, key.target);

    const rim = new T.DirectionalLight("#ffffff", 1.2);
    rim.position.set(-0.35, 1.05, -1.85);
    rim.target.position.set(0.28, 0.24, 0.0);
    world.add(rim, rim.target);

    // ---------- Monochrome studio materials + signature Apple cobalt ----------
    const materials = {
      white: new T.MeshPhysicalMaterial({
        color: "#f4f4f5",
        metalness: 0.03,
        roughness: 0.30,
        clearcoat: 0.42,
        clearcoatRoughness: 0.22,
        envMapIntensity: 1.0,
      }),
      off_white: new T.MeshStandardMaterial({
        color: "#cdd1d6",
        metalness: 0.46,
        roughness: 0.28,
        envMapIntensity: 1.0,
      }),
      black: new T.MeshStandardMaterial({
        color: "#1d1d1f",
        metalness: 0.16,
        roughness: 0.44,
        envMapIntensity: 0.9,
      }),
      light_blue: new T.MeshStandardMaterial({
        color: "#0071e3",
        metalness: 0.24,
        roughness: 0.24,
        envMapIntensity: 1.0,
      }),
      green: new T.MeshStandardMaterial({
        color: "#7db8f5",
        emissive: "#0071e3",
        emissiveIntensity: 0.28,
      }),
    };

    function mesh(geo, mat, parent = world) {
      const m = new T.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    }

    // Shadow-catching studio floor (whisper-soft Apple studio shadow)
    const floor = mesh(
      new T.PlaneGeometry(40, 40),
      new T.ShadowMaterial({ color: "#1d1d1f", opacity: 0.105 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.castShadow = false;

    // Robot pedestal ring
    const base = mesh(
      new T.CylinderGeometry(0.114, 0.119, 0.011, 72),
      materials.off_white,
    );
    base.position.y = 0.0055;

    // Soft radial shadow texture reused for pedestal, conveyor, pad, and dynamic bowl contact shadows
    function makeRadialShadowTex(innerAlpha, midAlpha) {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 128;
      const g = c.getContext("2d");
      const r = g.createRadialGradient(64, 64, 6, 64, 64, 62);
      r.addColorStop(0, `rgba(18, 20, 24, ${innerAlpha})`);
      r.addColorStop(0.45, `rgba(18, 20, 24, ${midAlpha})`);
      r.addColorStop(1, "rgba(18, 20, 24, 0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
      return new T.CanvasTexture(c);
    }

    const contactTex = makeRadialShadowTex(0.24, 0.10);
    const bowlShadowTex = makeRadialShadowTex(0.32, 0.13);

    const baseContact = mesh(
      new T.PlaneGeometry(0.33, 0.33),
      new T.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false }),
    );
    baseContact.rotation.x = -Math.PI / 2;
    baseContact.position.y = 0.0003;
    baseContact.castShadow = false;
    baseContact.receiveShadow = false;

    // ---------- Precision dark-graphite conveyor assembly ----------
    const beltGroup = new T.Group();
    beltGroup.position.set(DEFAULTS.beltX, 0, 0);
    world.add(beltGroup);

    const railMat = new T.MeshStandardMaterial({
      color: "#c8cdd2",
      metalness: 0.60,
      roughness: 0.26,
      envMapIntensity: 1.0,
    });
    const endCapMat = new T.MeshStandardMaterial({
      color: "#2c2c2e",
      metalness: 0.25,
      roughness: 0.45,
      envMapIntensity: 0.9,
    });
    const rollerMat = new T.MeshStandardMaterial({
      color: "#323438",
      metalness: 0.45,
      roughness: 0.34,
      envMapIntensity: 0.95,
    });
    const rollerStripeMat = new T.MeshStandardMaterial({
      color: "#5c5c62",
      metalness: 0.50,
      roughness: 0.30,
      envMapIntensity: 1.0,
    });
    const beltSurfaceMat = new T.MeshStandardMaterial({
      color: "#2c2c2e",
      metalness: 0.0,
      roughness: 0.90,
      envMapIntensity: 0.55,
    });
    const slatMat = new T.MeshStandardMaterial({
      color: "#3a3a3c",
      metalness: 0.04,
      roughness: 0.70,
      envMapIntensity: 0.65,
    });

    const BELT_Z_MIN = -DEFAULTS.beltHalfLen;
    const BELT_Z_MAX = BELT_ENTRY_Z;
    const BELT_LEN = BELT_Z_MAX - BELT_Z_MIN;
    const BELT_Z_MID = (BELT_Z_MIN + BELT_Z_MAX) / 2;

    const beltBody = mesh(
      new T.BoxGeometry(0.126, DEFAULTS.beltTop - 0.004, BELT_LEN),
      beltSurfaceMat,
      beltGroup,
    );
    beltBody.position.set(0, (DEFAULTS.beltTop + 0.004) / 2, BELT_Z_MID);

    // Side rails & dark anodized end caps on both machined ends
    [-0.071, 0.071].forEach((rx) => {
      const rail = mesh(
        new T.BoxGeometry(0.014, DEFAULTS.beltTop + 0.003, BELT_LEN + 0.022),
        railMat,
        beltGroup,
      );
      rail.position.set(rx, (DEFAULTS.beltTop + 0.003) / 2, BELT_Z_MID);
      [BELT_Z_MIN - 0.012, BELT_Z_MAX + 0.012].forEach((cz) => {
        const cap = mesh(
          new T.BoxGeometry(0.0145, DEFAULTS.beltTop + 0.0035, 0.006),
          endCapMat,
          beltGroup,
        );
        cap.position.set(rx, (DEFAULTS.beltTop + 0.003) / 2, cz);
      });
    });

    // Subtle hairline pickup zone calibration marks on rail top faces
    const tickMat = new T.MeshStandardMaterial({ color: "#8e8e93", roughness: 0.4, metalness: 0.3 });
    [-0.071, 0.071].forEach((rx) => {
      [0.08, -0.056].forEach((tz) => {
        const tick = mesh(new T.BoxGeometry(0.011, 0.0008, 0.002), tickMat, beltGroup);
        tick.position.set(rx, DEFAULTS.beltTop + 0.0036, tz);
        tick.castShadow = false;
      });
    });

    // Rotating conveyor end rollers with visible machined groove/stripe
    const rollers = [BELT_Z_MIN, BELT_Z_MAX].map((rz) => {
      const grp = new T.Group();
      grp.position.set(0, DEFAULTS.beltTop - ROLLER_R, rz);
      const cyl = mesh(new T.CylinderGeometry(ROLLER_R, ROLLER_R, 0.130, 32), rollerMat, grp);
      cyl.rotation.z = Math.PI / 2;
      // 3 symmetric longitudinal witness grooves around the roller circumference
      for (let g = 0; g < 3; g++) {
        const ang = (g / 3) * Math.PI * 2;
        const bar = mesh(new T.BoxGeometry(0.128, 0.0022, 0.0032), rollerStripeMat, grp);
        bar.position.set(0, Math.cos(ang) * (ROLLER_R - 0.0004), Math.sin(ang) * (ROLLER_R - 0.0004));
        bar.rotation.x = ang;
        bar.castShadow = false;
      }
      beltGroup.add(grp);
      return grp;
    });

    // Belt cleats smoothly tapering to scale.z = 0 within 3 cm of either roller (zero jump!)
    const SLAT_COUNT = 16;
    const SLAT_PITCH = BELT_LEN / SLAT_COUNT;
    const slats = Array.from({ length: SLAT_COUNT }, () => {
      const s = mesh(new T.BoxGeometry(0.118, 0.0014, 0.006), slatMat, beltGroup);
      s.position.y = DEFAULTS.beltTop + 0.0005;
      s.castShadow = false;
      return s;
    });

    // Grounded soft shadow strip directly beneath the conveyor body
    const beltUnderShadow = mesh(
      new T.PlaneGeometry(0.22, BELT_LEN + 0.08),
      new T.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: 0.75, depthWrite: false }),
      beltGroup,
    );
    beltUnderShadow.rotation.x = -Math.PI / 2;
    beltUnderShadow.position.set(0, 0.0003, BELT_Z_MID);
    beltUnderShadow.castShadow = false;
    beltUnderShadow.receiveShadow = false;

    // ---------- Left-midground staging pad for the 3-tier ceramic bowl tower ----------
    const pad = mesh(new T.CylinderGeometry(0.056, 0.059, DEFAULTS.padTop, 64), railMat);
    pad.position.set(DEFAULTS.padX, DEFAULTS.padTop / 2, DEFAULTS.padZ);
    const padRing = mesh(
      new T.TorusGeometry(0.044, 0.0007, 8, 80),
      new T.MeshStandardMaterial({ color: "#f5f5f7", roughness: 0.42, metalness: 0.15 }),
    );
    padRing.rotation.x = Math.PI / 2;
    padRing.position.set(DEFAULTS.padX, DEFAULTS.padTop + 0.0004, DEFAULTS.padZ);
    padRing.castShadow = false;
    const padContact = mesh(
      new T.PlaneGeometry(0.17, 0.17),
      new T.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    padContact.rotation.x = -Math.PI / 2;
    padContact.position.set(DEFAULTS.padX, 0.0003, DEFAULTS.padZ);
    padContact.castShadow = false;
    padContact.receiveShadow = false;

    // ---------- Hollow glazed ceramic studio nesting bowls ----------
    const bowlProfile = [
      new T.Vector2(0.0001, 0.0),
      new T.Vector2(0.022, 0.0),
      new T.Vector2(0.024, 0.0025),
      new T.Vector2(0.0318, 0.0315),
      new T.Vector2(0.0322, 0.035),
      new T.Vector2(0.0304, 0.036),
      new T.Vector2(0.0288, 0.0345),
      new T.Vector2(0.0205, 0.0045),
      new T.Vector2(0.0001, 0.0045),
    ];
    const bowlGeo = new T.LatheGeometry(bowlProfile, 56);
    bowlGeo.computeVertexNormals();

    function makeCeramicBowl(color) {
      const mat = new T.MeshPhysicalMaterial({
        color,
        metalness: 0.02,
        roughness: 0.18,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.0,
      });
      return mesh(bowlGeo, mat);
    }

    const bowl0 = makeCeramicBowl("#f8f8fa"); // Pure ceramic white base bowl
    bowl0.position.set(DEFAULTS.padX, DEFAULTS.padTop, DEFAULTS.padZ);
    const bowl1 = makeCeramicBowl("#0071e3"); // Signature Apple cobalt Bowl 1 (visual anchor)
    const bowl2 = makeCeramicBowl("#d2d2d7"); // Satin silver-gray Bowl 2

    function makeBowlShadow() {
      const mat = new T.MeshBasicMaterial({
        map: bowlShadowTex,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      });
      const m = new T.Mesh(new T.PlaneGeometry(0.092, 0.092), mat);
      m.rotation.x = -Math.PI / 2;
      m.castShadow = false;
      m.receiveShadow = false;
      world.add(m);
      return m;
    }
    const shadow1 = makeBowlShadow();
    const shadow2 = makeBowlShadow();

    // ---------- Single restrained hairline missed-grasp gap annotation (Native empty snap) ----------
    // Built as a flat 2.2 mm quad strip rather than gl.LINES so it stays crisp 1 CSS px on 2x Retina.
    const missGroup = new T.Group();
    missGroup.visible = false;
    world.add(missGroup);
    const missLineMat = new T.MeshBasicMaterial({ color: "#b8b8be", transparent: true, opacity: 0, depthWrite: false });
    const missLine = new T.Mesh(new T.PlaneGeometry(0.0022, 1), missLineMat);
    missLine.rotation.x = -Math.PI / 2;
    missGroup.add(missLine);
    const missRingMat = new T.MeshBasicMaterial({ color: "#d1d1d6", transparent: true, opacity: 0, depthWrite: false });
    const missRing = new T.Mesh(new T.RingGeometry(0.0048, 0.0074, 28), missRingMat);
    missRing.rotation.x = -Math.PI / 2;
    missGroup.add(missRing);

    // ---------- Panda robot hierarchy ----------
    const robot = new T.Group();
    robot.rotation.x = -Math.PI / 2;
    world.add(robot);
    const joints = [];
    const fingers = [];
    let motion = null;
    let ready = false;
    let failed = false;

    const fetchGzipJson = async (name) => {
      const res = await fetch(new URL(name, ASSETS));
      if (!res.ok) throw Error(`Robot asset ${name}: ${res.status}`);
      const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(buf));
    };

    const fetchAsset = async (name) => {
      const res = await fetch(new URL(name, ASSETS));
      if (!res.ok) throw Error(`Robot asset ${name}: ${res.status}`);
      if (name.endsWith(".json")) return res.json();
      return new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    };

    const load = Promise.all([
      fetchAsset("panda-q.json"),
      fetchAsset("panda-q.gz"),
      fetchGzipJson(`motion.gz?v=${POSTER_VER}`),
    ])
      .then(([model, buffer, trajectory]) => {
        if (failed) return;
        const geometries = {};
        for (const [name, entry] of Object.entries(model.meshes)) {
          const geometry = new T.BufferGeometry();
          const q = new Uint16Array(buffer, ...entry.position);
          const position = new Float32Array(q.length);
          const [ox, oy, oz] = entry.offset;
          const [sx, sy, sz] = entry.scale;
          for (let i = 0; i < q.length; i += 3) {
            position[i] = q[i] * sx + ox;
            position[i + 1] = q[i + 1] * sy + oy;
            position[i + 2] = q[i + 2] * sz + oz;
          }
          geometry.setAttribute("position", new T.BufferAttribute(position, 3));
          geometry.setAttribute("normal", new T.BufferAttribute(new Int8Array(buffer, ...entry.normal), 3, true));
          geometry.setIndex(
            new T.BufferAttribute(
              new (entry.index32 ? Uint32Array : Uint16Array)(buffer, ...entry.index),
              1,
            ),
          );
          geometry.computeBoundingSphere();
          geometries[name] = geometry;
        }

        function build(node, parent) {
          const origin = new T.Group();
          origin.position.fromArray(node.pos);
          const [w, x, y, z] = node.quat;
          origin.quaternion.set(x, y, z, w).normalize();
          parent.add(origin);
          const body = new T.Group();
          origin.add(body);
          if (node.joint) {
            if (node.joint.name.startsWith("finger")) fingers.push(body);
            else joints.push(body);
          }
          for (const piece of node.meshes) {
            mesh(geometries[piece.name], materials[piece.material] || materials.white, body);
          }
          node.children.forEach((child) => build(child, body));
        }
        build(model.body, robot);
        motion = trajectory;
        ready = true;
        // Publish loaded single-source-of-truth trajectory metadata for fig-race.js
        Object.assign(window.PFRobotStudio, {
          motion,
          meta: motion.meta,
          sampleTcp,
        });
        clients.forEach((c) => c.refresh());
      })
      .catch((error) => {
        failed = true;
        console.warn("Robot model could not load.", error);
        clients.forEach((c) => c.fail());
      });

    function sampleTrajectory(p) {
      const chunks = motion ? motion.chunks : DEFAULTS.chunks;
      p = Math.max(0, Math.min(chunks, p));
      const at = p / motion.step;
      const k = Math.min(motion.q.length - 2, Math.floor(at));
      const u = at - k;
      const qa = motion.q[k];
      const qb = motion.q[k + 1];
      const ta = motion.tcp[k];
      const tb = motion.tcp[k + 1];
      const grip = motion.grip[k] + (motion.grip[k + 1] - motion.grip[k]) * u;
      return {
        p,
        k,
        u,
        qa,
        qb,
        x: ta[0] + (tb[0] - ta[0]) * u,
        y: ta[1] + (tb[1] - ta[1]) * u,
        z: ta[2] + (tb[2] - ta[2]) * u,
        grip,
      };
    }

    function sampleTcp(p) {
      if (!motion) return null;
      const s = sampleTrajectory(p);
      return { x: s.x, y: s.y, z: s.z, grip: s.grip };
    }

    function updateBowlShadow(shadowMesh, visible, x, surfaceY, z, heightAbove) {
      if (!visible) {
        shadowMesh.visible = false;
        return;
      }
      const fade = clamp01(1 - Math.max(0, heightAbove) / 0.09);
      shadowMesh.visible = fade > 0.01;
      if (!shadowMesh.visible) return;
      shadowMesh.position.set(x, surfaceY + 0.0005, z);
      const spread = 1 + Math.max(0, heightAbove) * 3.2;
      shadowMesh.scale.setScalar(spread);
      shadowMesh.material.opacity = 0.24 * fade;
    }

    function render(p, width, height, worldState) {
      if (!ready || !motion) return false;
      const M = motion.meta;
      const s = sampleTrajectory(p);

      // Joint angles & finger opening directly from single-source-of-truth motion.gz
      for (let i = 0; i < joints.length; i++) {
        joints[i].rotation.z = s.qa[i] + (s.qb[i] - s.qa[i]) * s.u;
      }
      const fPos = M.fingerOpen - (M.fingerOpen - M.fingerClosed) * s.grip;
      for (let i = 0; i < fingers.length; i++) {
        fingers[i].position.y = fPos;
      }

      // Shared world clock drives belt cleats, rotating end rollers, and incoming bowls continuously.
      const wt = worldState && Number.isFinite(worldState.clock) ? worldState.clock : s.p;
      const beltShift = ((wt * M.beltSpeed) % SLAT_PITCH + SLAT_PITCH) % SLAT_PITCH;
      for (let i = 0; i < SLAT_COUNT; i++) {
        let z = BELT_Z_MIN + i * SLAT_PITCH - beltShift;
        if (z < BELT_Z_MIN) z += BELT_LEN;
        slats[i].position.z = z;
        // Smoothly taper cleats near either end roller so they never pop
        const edgeDist = Math.min(z - BELT_Z_MIN, BELT_Z_MAX - z);
        const taper = smoothstep(edgeDist / 0.028);
        slats[i].scale.set(1, 1, Math.max(0.001, taper));
        slats[i].visible = taper > 0.01;
      }
      const rollerAngle = -(wt * M.beltSpeed) / ROLLER_R;
      rollers[0].rotation.x = rollerAngle;
      rollers[1].rotation.x = rollerAngle;

      // Bowl free-riding trajectories on the shared moving belt
      const z1Free = M.bowl1StartZ - (wt - M.bowl1StartT) * M.beltSpeed;
      const z2Free = M.bowl2StartZ - (wt - M.bowl2StartT) * M.beltSpeed;
      const canCatch1 = worldState ? !!worldState.catch1 : true;
      const canCatch2 = worldState ? !!worldState.catch2 : true;

      // Base Bowl 0 always sits squarely on the left-midground staging pad
      bowl0.visible = true;
      bowl0.position.set(M.padX, M.padTop, M.padZ);
      bowl0.rotation.set(0, 0, 0);

      // Bowl 1 (Cobalt): zero-slip handoff at latch1P (grip >= 0.9), stationary release at release1P (grip <= 0.1)
      if (canCatch1 && s.p >= M.latch1P) {
        bowl1.visible = true;
        bowl1.material.transparent = false;
        bowl1.material.opacity = 1;
        bowl1.rotation.set(0, 0, 0);
        if (s.p < M.release1P) {
          const by = Math.max(0.020, s.y - M.bowlGripY);
          bowl1.position.set(s.x, by, s.z);
          const overBelt = Math.abs(s.x - M.beltX) < 0.08 && s.z >= BELT_Z_MIN && s.z <= BELT_Z_MAX;
          const surfY = overBelt ? M.beltTop : 0;
          updateBowlShadow(shadow1, true, s.x, surfY, s.z, by - surfY);
        } else {
          bowl1.position.set(M.padX, 0.020, M.padZ);
          updateBowlShadow(shadow1, false, M.padX, M.padTop, M.padZ, 0);
        }
      } else {
        const b1 = evalFreeBowl(z1Free, M.beltX, M.beltTop, M.beltHalfLen, M.beltSpeed, 1);
        bowl1.visible = b1.visible;
        const fade1 = b1.opacity < 0.995;
        bowl1.material.transparent = fade1;
        bowl1.material.opacity = b1.opacity;
        bowl1.position.set(b1.x, b1.y, b1.z);
        bowl1.rotation.set(b1.rx, b1.ry, b1.rz);
        const h1 = b1.rx < -1.5 ? Math.max(0, b1.y - BOWL_RIM_H) : Math.max(0, b1.y - b1.surfaceY);
        updateBowlShadow(shadow1, b1.visible && b1.opacity > 0.25, b1.x, b1.surfaceY, b1.z, h1);
      }

      // Bowl 2 (Silver): zero-slip handoff at latch2P, stationary release at release2P (nested at y = 0.036)
      if (canCatch2 && s.p >= M.latch2P) {
        bowl2.visible = true;
        bowl2.material.transparent = false;
        bowl2.material.opacity = 1;
        bowl2.rotation.set(0, 0, 0);
        if (s.p < M.release2P) {
          const by = Math.max(0.036, s.y - M.bowlGripY);
          bowl2.position.set(s.x, by, s.z);
          const overBelt = Math.abs(s.x - M.beltX) < 0.08 && s.z >= BELT_Z_MIN && s.z <= BELT_Z_MAX;
          const surfY = overBelt ? M.beltTop : 0;
          updateBowlShadow(shadow2, true, s.x, surfY, s.z, by - surfY);
        } else {
          bowl2.position.set(M.padX, 0.036, M.padZ);
          updateBowlShadow(shadow2, false, M.padX, M.padTop, M.padZ, 0);
        }
      } else {
        const b2 = evalFreeBowl(z2Free, M.beltX, M.beltTop, M.beltHalfLen, M.beltSpeed, 2);
        bowl2.visible = b2.visible;
        const fade2 = b2.opacity < 0.995;
        bowl2.material.transparent = fade2;
        bowl2.material.opacity = b2.opacity;
        bowl2.position.set(b2.x, b2.y, b2.z);
        bowl2.rotation.set(b2.rx, b2.ry, b2.rz);
        const h2 = b2.rx < -1.5 ? Math.max(0, b2.y - BOWL_RIM_H) : Math.max(0, b2.y - b2.surfaceY);
        updateBowlShadow(shadow2, b2.visible && b2.opacity > 0.25, b2.x, b2.surfaceY, b2.z, h2);
      }

      // Single restrained hairline cue on the belt surface at the exact moment Native snaps on empty air
      const missSnapT = worldState?.missSnapT;
      if (!canCatch1 && Number.isFinite(missSnapT) && wt >= missSnapT && wt <= missSnapT + 0.72) {
        const elapsed = wt - missSnapT;
        const alpha = smoothstep(elapsed / 0.10) * (1 - smoothstep((elapsed - 0.42) / 0.30));
        const yLine = M.beltTop + 0.0024;
        const zStart = s.z - 0.008;
        const zTarget = Math.max(BELT_Z_MIN + 0.01, z1Free + BOWL_RIM_R + 0.004);
        const segLen = Math.max(0.005, zStart - zTarget);
        missLine.position.set(M.beltX, yLine, (zStart + zTarget) * 0.5);
        missLine.scale.set(1, segLen, 1);
        missRing.position.set(M.beltX, yLine, s.z);
        missLineMat.opacity = 0.82 * alpha;
        missRingMat.opacity = 0.90 * alpha;
        missGroup.visible = alpha > 0.01;
      } else {
        missGroup.visible = false;
      }

      // Telephoto studio framing: full Panda arm unclipped from base to top elbow across all 16 chunks,
      // self-contained conveyor across foreground, 3-bowl tower left midground, tumbled bowls right foreground.
      camera.aspect = width / height;
      camera.position.set(2.08, 1.09, 0.42);
      camera.lookAt(0.27, 0.32, -0.04);
      camera.fov = 29.8;
      camera.updateProjectionMatrix();

      if (renderer.domElement.width !== width || renderer.domElement.height !== height) {
        renderer.setSize(width, height, false);
      }
      renderer.render(world, camera);
      return true;
    }

    renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      ready = false;
      failed = true;
      clients.forEach((c) => c.fail());
    });

    return {
      renderer,
      render,
      load,
      get ready() {
        return ready;
      },
      get failed() {
        return failed;
      },
    };
  }

  function loadStudio() {
    if (!studioLoad) {
      studioLoad = new Promise((resolve) => {
        requestAnimationFrame(() =>
          setTimeout(() => {
            loadThree()
              .then(() => {
                studio = createStudio();
              })
              .catch((error) => {
                studio = null;
                console.warn("WebGL unavailable; SVG fallback remains active.", error);
              })
              .finally(() => resolve(studio));
          }, 0),
        );
      });
    }
    return studioLoad;
  }

  function mount(container, options = {}) {
    if (!canWebGL || studio === null || studio?.failed) return null;
    const poster = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
    poster.setAttribute("aria-hidden", "true");
    poster.className = "robot-poster";
    poster.alt = "";
    poster.src = new URL(`preview-0.webp?v=${POSTER_VER}`, ASSETS).href;
    container.appendChild(poster);

    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.className = "robot-live";
    canvas.style.cssText = "display:block;width:100%;height:100%;";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    let p = 0;
    let worldState = null;
    let previous = "";
    let width = options.width || 960;
    let height = options.height || 600;
    let visible = false;
    let rendered = false;
    let posterFrame = 0;
    canvas.width = width;
    canvas.height = height;

    // Dynamically match CSS layout dimensions * min(devicePixelRatio, 2) for crisp Retina rendering.
    if (!options.fixedSize && typeof ResizeObserver === "function") {
      const ro = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect || rect.width < 16 || rect.height < 16) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const nextW = Math.round(rect.width * dpr);
        const nextH = Math.round(rect.height * dpr);
        if (nextW !== width || nextH !== height) {
          width = nextW;
          height = nextH;
          canvas.width = width;
          canvas.height = height;
          previous = "";
          draw();
        }
      });
      ro.observe(container);
    }

    function draw() {
      const maxP = window.PFRobotStudio?.motion?.chunks || DEFAULTS.chunks;
      if (!rendered) {
        const next = Math.max(0, Math.min(maxP, Math.round(p)));
        if (next !== posterFrame) {
          posterFrame = next;
          poster.src = new URL(`preview-${next}.webp?v=${POSTER_VER}`, ASSETS).href;
        }
      }
      const shared = studio;
      if (!visible || !shared?.ready || shared.failed) return;
      const ck = worldState ? Math.round(worldState.clock * 1000) : Math.round(p * 1000);
      const key = `${Math.round(p * 10000)}:${ck}:${worldState ? `${+!!worldState.catch1}${+!!worldState.catch2}:${worldState.missSnapT ?? ""}` : ""}:${width}x${height}`;
      if (previous === key) return;
      if (shared.render(p, width, height, worldState)) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(shared.renderer.domElement, 0, 0, width, height);
        previous = key;
        rendered = true;
        container.classList?.add("robot-ready");
        poster.remove();
      }
    }

    const client = {
      set(progress, _highlight, world) {
        p = progress;
        worldState = world || null;
        draw();
      },
      refresh() {
        previous = "";
        draw();
      },
      fail() {
        options.onFail?.();
      },
    };
    let resolveReady;
    client.ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const start = () => {
      if (start.done) return;
      start.done = true;
      loadStudio()
        .then(async (shared) => {
          if (!shared) {
            client.fail();
            return;
          }
          await shared.load;
          draw();
        })
        .finally(resolveReady);
    };
    clients.add(client);
    if (typeof IntersectionObserver === "function") {
      new IntersectionObserver(
        (entries, io) => {
          if (entries[0].isIntersecting) {
            start();
            io.disconnect();
          }
        },
        { rootMargin: "50% 0px" },
      ).observe(container);
      new IntersectionObserver(
        (entries) => {
          visible = entries[0].isIntersecting;
          if (visible) draw();
        },
        { rootMargin: "160px" },
      ).observe(container);
    } else {
      visible = true;
      start();
    }
    draw();
    return client;
  }

  window.PFRobotStudio = {
    mount,
    DEFAULTS,
    bowlLandTime,
    motion: null,
    meta: DEFAULTS,
    sampleTcp: null,
  };

  window.PFRobotScene = function (PF, parent, x, y, w, options = {}) {
    if (!canWebGL || studio === null || studio?.failed) return null;
    const g = PF.el("g", { transform: `translate(${x} ${y})` }, parent);
    const h = w * 0.625;
    const foreign = PF.el("foreignObject", { width: w, height: h }, g);
    const surface = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    surface.className = "robot-surface";
    foreign.appendChild(surface);
    let fallback;
    const client = mount(surface, {
      ...options,
      onFail() {
        foreign.remove();
        fallback = PF.scene(g, 0, 0, w, options);
      },
    });
    return {
      g,
      h,
      set(p, hl, world) {
        if (fallback) fallback.set(p, hl);
        else client.set(p, hl, world);
      },
    };
  };
})();
