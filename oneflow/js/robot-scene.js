// A shared, locally hosted 3D Panda studio running a real-time conveyor-belt bowl-stacking duel.
// The conveyor belt and incoming bowls advance continuously on the shared world clock `t` — they
// never pause when a policy stalls computing. A bowl is only caught if the closing gripper arrives
// while the bowl is physically within the grasp window; otherwise it glides past and drops off the belt.
(function () {
  "use strict";
  let T = window.THREE;
  const SCRIPT = document.currentScript.src;
  const ASSETS = new URL("../assets/robot/", SCRIPT);
  const THREE_URL = new URL("vendor/three.min.js", SCRIPT);
  const clients = new Set();
  let studio, studioLoad;
  const canWebGL = (() => {
    if (T) return true;
    try {
      const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      return !!(c.getContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch { return false; }
  })();
  function loadThree() {
    if (T) return Promise.resolve(T);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = THREE_URL.href;
      s.async = true;
      s.onload = () => { T = window.THREE; T ? resolve(T) : reject(Error("THREE missing")); };
      s.onerror = () => reject(Error("three.min.js could not load"));
      document.head.appendChild(s);
    });
  }

  // 15 keyframes (14 chunks) matching scripts/project-page/solve_robot_motion.py exactly.
  // Panda [px, py, pz, grip] maps to Three.js (px, pz, -py).
  const frames = [
    [0.42, -0.02, 0.34, 0.0],
    [0.53, -0.14, 0.17, 0.0],
    [0.53, -0.10, 0.060, 0.0],
    [0.53, -0.10, 0.060, 1.0],
    [0.43, 0.04, 0.27, 1.0],
    [0.32, 0.20, 0.038, 1.0],
    [0.32, 0.20, 0.19, 0.0],
    [0.53, -0.06, 0.17, 0.0],
    [0.53, -0.02, 0.060, 0.0],
    [0.53, -0.02, 0.060, 1.0],
    [0.43, 0.09, 0.28, 1.0],
    [0.32, 0.20, 0.056, 1.0],
    [0.32, 0.20, 0.22, 0.0],
    [0.38, 0.08, 0.31, 0.0],
    [0.42, -0.02, 0.34, 0.0],
  ];
  const MAX_P = frames.length - 1;
  const BELT_X = 0.53;
  const BELT_TOP = 0.042;
  const BELT_HALF_LEN = 0.30;
  const BELT_SPEED = 0.028;       // constant conveyor speed in metres per forward pass (never pauses!)
  const PAD_X = 0.32;
  const PAD_Z = -0.20;
  const BOWL_GRIP_Y = 0.018;

  // Shared-clock bowl arrival trajectories along the conveyor (identical on both lanes).
  const BOWL1_PICK_Z = 0.10, BOWL1_PICK_T = 7.35;
  const BOWL2_PICK_Z = 0.02, BOWL2_PICK_T = 13.35;
  const GRASP_TOL = 0.032;        // 3.2 cm physical capture half-window

  const smoothstep = (u) => {
    u = Math.max(0, Math.min(1, u));
    return u * u * (3 - 2 * u);
  };
  const minJerk = (u) => u * u * u * (10 - 15 * u + 6 * u * u);

  function task(p) {
    p = Math.max(0, Math.min(MAX_P, p));
    const k = Math.min(MAX_P - 1, Math.floor(p)),
      u = p - k,
      f = minJerk(u);
    const a = frames[k],
      b = frames[k + 1];
    const px = a[0] + (b[0] - a[0]) * f,
      py = a[1] + (b[1] - a[1]) * f,
      pz = a[2] + (b[2] - a[2]) * f;
    return {
      p,
      position: new T.Vector3(px, pz, -py),
      grip: a[3] + (b[3] - a[3]) * f,
    };
  }

  // Place a bowl riding freely on the moving conveyor at Three.js z, including smooth entry at +0.30
  // and gravity tip-off over the far roller past -0.30.
  function placeOnBelt(bowl, z) {
    if (z > BELT_HALF_LEN + 0.01 || z < -BELT_HALF_LEN - 0.11) {
      bowl.visible = false;
      return;
    }
    bowl.visible = true;
    const enter = smoothstep((BELT_HALF_LEN + 0.01 - z) / 0.055);
    if (z >= -BELT_HALF_LEN) {
      bowl.scale.setScalar(0.01 + 0.99 * enter);
      bowl.rotation.set(0, 0, 0);
      bowl.position.set(BELT_X, BELT_TOP, z);
    } else {
      const over = -BELT_HALF_LEN - z; // 0 .. 0.11 m past far roller
      const drop = Math.min(1, over / 0.10);
      bowl.scale.setScalar(Math.max(0.01, 1 - Math.max(0, (drop - 0.65) / 0.35)));
      bowl.rotation.set(-drop * 1.35, 0, 0);
      bowl.position.set(
        BELT_X,
        BELT_TOP - 0.085 * drop * drop,
        -BELT_HALF_LEN - over * 0.72,
      );
    }
  }

  function createStudio() {
    if (!T) return null;
    const renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(1);
    renderer.setSize(1000, 700);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.VSMShadowMap;
    const world = new T.Scene();
    renderer.setClearColor(0x000000, 0);
    const camera = new T.PerspectiveCamera(33, 10 / 7, 0.01, 30);
    const materials = {
      white: new T.MeshPhysicalMaterial({
        color: "#d8d9d4",
        metalness: 0.08,
        roughness: 0.36,
        clearcoat: 0.18,
        clearcoatRoughness: 0.32,
      }),
      off_white: new T.MeshStandardMaterial({
        color: "#c1c5c9",
        metalness: 0.42,
        roughness: 0.31,
      }),
      black: new T.MeshStandardMaterial({
        color: "#252c2e",
        metalness: 0.15,
        roughness: 0.48,
      }),
      light_blue: new T.MeshStandardMaterial({
        color: "#0a5fc0",
        metalness: 0.3,
        roughness: 0.27,
      }),
      green: new T.MeshStandardMaterial({
        color: "#7db8f5",
        emissive: "#003a7a",
        emissiveIntensity: 0.3,
      }),
    };

    const env = new T.Scene();
    env.background = new T.Color("#a3a8ae");
    function card(x, y, z, w, h, power) {
      const m = new T.Mesh(
        new T.PlaneGeometry(w, h),
        new T.MeshBasicMaterial({
          color: new T.Color(power, power, power),
          side: T.DoubleSide,
        }),
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    }
    card(-3, 4, 3, 4, 6, 5);
    card(4, 2, -2, 2, 5, 3);
    card(0, 5, 0, 5, 3, 2);
    const pmrem = new T.PMREMGenerator(renderer),
      envMap = pmrem.fromScene(env, 0.04);
    world.environment = envMap.texture;
    Object.values(materials).forEach((material) => {
      material.envMapIntensity = 0.65;
    });
    pmrem.dispose();
    env.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });

    world.add(new T.HemisphereLight("#eef1f4", "#74797f", 0.68));
    const key = new T.DirectionalLight("#fff7e9", 2.45);
    key.position.set(-1.5, 3, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {
      left: -1.3,
      right: 1.3,
      top: 1.3,
      bottom: -1.3,
      near: 0.1,
      far: 7,
    });
    key.shadow.bias = -0.00008;
    key.shadow.normalBias = 0.001;
    key.shadow.radius = 16;
    key.shadow.blurSamples = 16;
    key.target.position.set(0.25, 0.25, 0);
    world.add(key, key.target);
    const fill = new T.DirectionalLight("#d5e5ed", 0.68);
    fill.position.set(2, 1, -2);
    world.add(fill);

    function mesh(geo, mat, parent = world) {
      const m = new T.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    }

    const floor = mesh(
      new T.PlaneGeometry(200, 200),
      new T.ShadowMaterial({ color: "#3a3a3c", opacity: 0.14 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.castShadow = false;

    const base = mesh(
      new T.CylinderGeometry(0.115, 0.12, 0.012, 80),
      materials.off_white,
    );
    base.position.y = -0.002;

    // ---------- Conveyor belt assembly ----------
    const beltGroup = new T.Group();
    beltGroup.position.set(BELT_X, 0, 0);
    world.add(beltGroup);

    const railMat = new T.MeshStandardMaterial({
      color: "#c8cdd2",
      metalness: 0.56,
      roughness: 0.28,
    });
    railMat.envMapIntensity = 0.7;
    const rollerMat = new T.MeshStandardMaterial({
      color: "#383c42",
      metalness: 0.35,
      roughness: 0.42,
    });
    const beltSurfaceMat = new T.MeshStandardMaterial({
      color: "#235347",
      metalness: 0.05,
      roughness: 0.68,
    });
    const slatMat = new T.MeshStandardMaterial({
      color: "#357867",
      metalness: 0.08,
      roughness: 0.52,
    });

    const beltBody = mesh(
      new T.BoxGeometry(0.126, BELT_TOP - 0.004, BELT_HALF_LEN * 2),
      beltSurfaceMat,
      beltGroup,
    );
    beltBody.position.y = (BELT_TOP + 0.004) / 2;

    [-0.071, 0.071].forEach((rx) => {
      const rail = mesh(
        new T.BoxGeometry(0.014, BELT_TOP + 0.003, BELT_HALF_LEN * 2 + 0.022),
        railMat,
        beltGroup,
      );
      rail.position.set(rx, (BELT_TOP + 0.003) / 2, 0);
    });

    [-BELT_HALF_LEN, BELT_HALF_LEN].forEach((rz) => {
      const roller = mesh(
        new T.CylinderGeometry(0.019, 0.019, 0.132, 28),
        rollerMat,
        beltGroup,
      );
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0, BELT_TOP - 0.019, rz);
    });

    const SLAT_COUNT = 12;
    const SLAT_SPAN = BELT_HALF_LEN * 2 - 0.02;
    const slats = Array.from({ length: SLAT_COUNT }, () => {
      const s = mesh(new T.BoxGeometry(0.118, 0.0016, 0.0065), slatMat, beltGroup);
      s.position.y = BELT_TOP + 0.0006;
      s.castShadow = false;
      return s;
    });

    // ---------- Staging pad for the 3-tier nested bowl stack ----------
    const pad = mesh(
      new T.CylinderGeometry(0.056, 0.059, 0.004, 64),
      railMat,
    );
    pad.position.set(PAD_X, 0.002, PAD_Z);
    const padRing = mesh(
      new T.TorusGeometry(0.044, 0.0008, 6, 80),
      new T.MeshStandardMaterial({ color: "#e8ecf0", roughness: 0.55 }),
    );
    padRing.rotation.x = Math.PI / 2;
    padRing.position.set(PAD_X, 0.0044, PAD_Z);
    padRing.castShadow = false;

    // ---------- Hollow tapered studio nesting bowls ----------
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
    const bowlGeo = new T.LatheGeometry(bowlProfile, 48);
    bowlGeo.computeVertexNormals();

    function makeBowl(color, accentClearcoat = 0.28) {
      const mat = new T.MeshPhysicalMaterial({
        color,
        metalness: 0.08,
        roughness: 0.28,
        clearcoat: accentClearcoat,
        clearcoatRoughness: 0.25,
      });
      mat.envMapIntensity = 0.72;
      return mesh(bowlGeo, mat);
    }

    const bowl0 = makeBowl("#74a592"); // Sage base bowl on staging pad
    bowl0.position.set(PAD_X, 0.004, PAD_Z);
    const bowl1 = makeBowl("#0071e3"); // Cobalt Bowl 1
    const bowl2 = makeBowl("#d8a632"); // Amber Bowl 2

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sc = shadowCanvas.getContext("2d"),
      radial = sc.createRadialGradient(64, 64, 8, 64, 64, 64);
    radial.addColorStop(0, "rgba(20,26,34,.24)");
    radial.addColorStop(0.4, "rgba(20,26,34,.11)");
    radial.addColorStop(1, "rgba(20,26,34,0)");
    sc.fillStyle = radial;
    sc.fillRect(0, 0, 128, 128);
    const contact = mesh(
      new T.PlaneGeometry(0.34, 0.34),
      new T.MeshBasicMaterial({
        map: new T.CanvasTexture(shadowCanvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.0002;
    contact.castShadow = false;

    const robot = new T.Group();
    robot.rotation.x = -Math.PI / 2;
    world.add(robot);
    const joints = [],
      fingers = [],
      bodies = {};
    let motion,
      ready = false,
      failed = false;

    const pathGeometry = new T.BufferGeometry().setFromPoints(
      frames.map(([px, py, pz]) => new T.Vector3(px, pz, -py)),
    );
    const pathLine = new T.Line(
      pathGeometry,
      new T.LineBasicMaterial({
        color: "#86868b",
        transparent: true,
        opacity: 0.3,
      }),
    );
    world.add(pathLine);
    const active = new T.Line(
      new T.BufferGeometry(),
      new T.LineBasicMaterial({
        color: "#0071e3",
        transparent: true,
        opacity: 0.8,
      }),
    );
    world.add(active);
    const dots = Array.from({ length: 8 }, () => {
      const m = mesh(
        new T.SphereGeometry(0.003, 12, 8),
        new T.MeshBasicMaterial({ color: "#003a7a" }),
      );
      m.castShadow = false;
      return m;
    });

    const fetchAsset = async (name) => {
      const response = await fetch(new URL(name, ASSETS));
      if (!response.ok) throw Error(`Robot asset ${name}: ${response.status}`);
      if (name.endsWith(".json")) return response.json();
      return new Response(
        response.body.pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer();
    };
    const load = Promise.all([
      fetchAsset("panda-q.json"),
      fetchAsset("panda-q.gz"),
      fetchAsset("motion.json"),
    ])
      .then(([model, buffer, trajectory]) => {
        if (failed) return;
        const geometries = {};
        for (const [name, entry] of Object.entries(model.meshes)) {
          const geometry = new T.BufferGeometry();
          const q = new Uint16Array(buffer, ...entry.position),
            position = new Float32Array(q.length),
            [ox, oy, oz] = entry.offset,
            [sx, sy, sz] = entry.scale;
          for (let i = 0; i < q.length; i += 3) {
            position[i] = q[i] * sx + ox;
            position[i + 1] = q[i + 1] * sy + oy;
            position[i + 2] = q[i + 2] * sz + oz;
          }
          geometry.setAttribute("position", new T.BufferAttribute(position, 3));
          geometry.setAttribute(
            "normal",
            new T.BufferAttribute(new Int8Array(buffer, ...entry.normal), 3, true),
          );
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
          bodies[node.name] = body;
          if (node.joint) {
            if (node.joint.name.startsWith("finger")) fingers.push(body);
            else joints.push(body);
          }
          for (const piece of node.meshes)
            mesh(
              geometries[piece.name],
              materials[piece.material] || materials.white,
              body,
            );
          node.children.forEach((child) => build(child, body));
        }
        build(model.body, robot);
        motion = trajectory;
        ready = true;
        clients.forEach((c) => c.refresh());
      })
      .catch((error) => {
        failed = true;
        console.warn("Robot model could not load.", error);
        clients.forEach((c) => c.fail());
      });

    function pathAt(p) {
      p = Math.max(0, Math.min(MAX_P, p));
      const k = Math.min(MAX_P - 1, Math.floor(p)),
        u = p - k;
      const a = frames[k],
        b = frames[k + 1];
      return new T.Vector3(
        a[0] + (b[0] - a[0]) * u,
        a[2] + (b[2] - a[2]) * u,
        -(a[1] + (b[1] - a[1]) * u),
      );
    }

    // `world`: { clock, catch1, catch2 } where `clock` is the shared world time `t` (in passes)
    // driving the conveyor belt continuously, independent of whether this robot arm is stalled.
    function render(p, hl, view, options, width, height, worldState) {
      if (!ready) return false;
      const s = task(p),
        at = s.p / motion.step,
        k = Math.min(motion.q.length - 2, Math.floor(at)),
        u = at - k;
      joints.forEach(
        (joint, i) =>
          (joint.rotation.z =
            motion.q[k][i] + (motion.q[k + 1][i] - motion.q[k][i]) * u),
      );
      fingers.forEach(
        (finger) => (finger.position.y = 0.04 - (0.04 - 0.0315) * s.grip),
      );

      // Shared world clock `t` drives the conveyor slats continuously — never pauses on stall!
      const wt = worldState && Number.isFinite(worldState.clock) ? worldState.clock : s.p;
      const pitch = SLAT_SPAN / SLAT_COUNT;
      const beltShift = ((wt * BELT_SPEED) % pitch + pitch) % pitch;
      for (let i = 0; i < SLAT_COUNT; i++) {
        let z = (i / SLAT_COUNT) * SLAT_SPAN - SLAT_SPAN / 2 - beltShift;
        if (z < -SLAT_SPAN / 2) z += SLAT_SPAN;
        slats[i].position.z = z;
      }

      // Free-riding belt positions for both bowls at shared world clock `wt`.
      const z1Free = BOWL1_PICK_Z + (BOWL1_PICK_T - wt) * BELT_SPEED;
      const z2Free = BOWL2_PICK_Z + (BOWL2_PICK_T - wt) * BELT_SPEED;
      const canCatch1 = worldState ? !!worldState.catch1 : true;
      const canCatch2 = worldState ? !!worldState.catch2 : true;

      // Bowl 1 (Cobalt): caught only if this robot closes on it within physical tolerance.
      if (canCatch1 && s.p >= 2.45) {
        bowl1.visible = true;
        bowl1.scale.setScalar(1);
        bowl1.rotation.set(0, 0, 0);
        if (s.p < 3.0) {
          // Smoothly settle the ~4 mm offset into the closing fingers as grip reaches 1.
          const settle = smoothstep((s.p - 2.45) / 0.55);
          const zAtLatch = BOWL1_PICK_Z + (BOWL1_PICK_T - (wt - (s.p - 2.45) * 0.85)) * BELT_SPEED;
          bowl1.position.set(BELT_X, BELT_TOP, zAtLatch + (BOWL1_PICK_Z - zAtLatch) * settle);
        } else if (s.p < 5.15) {
          bowl1.position.set(
            s.position.x,
            Math.max(0.020, s.position.y - BOWL_GRIP_Y),
            s.position.z,
          );
        } else {
          bowl1.position.set(PAD_X, 0.020, PAD_Z);
        }
      } else {
        placeOnBelt(bowl1, z1Free);
      }

      // Bowl 2 (Amber): rides freely on the belt unless caught cleanly within tolerance.
      if (canCatch2 && s.p >= 8.45) {
        bowl2.visible = true;
        bowl2.scale.setScalar(1);
        bowl2.rotation.set(0, 0, 0);
        if (s.p < 9.0) {
          const settle = smoothstep((s.p - 8.45) / 0.55);
          const zAtLatch = BOWL2_PICK_Z + (BOWL2_PICK_T - (wt - (s.p - 8.45) * 0.85)) * BELT_SPEED;
          bowl2.position.set(BELT_X, BELT_TOP, zAtLatch + (BOWL2_PICK_Z - zAtLatch) * settle);
        } else if (s.p < 11.15) {
          bowl2.position.set(
            s.position.x,
            Math.max(0.038, s.position.y - BOWL_GRIP_Y),
            s.position.z,
          );
        } else {
          bowl2.position.set(PAD_X, 0.038, PAD_Z);
        }
      } else {
        placeOnBelt(bowl2, z2Free);
      }

      pathLine.visible = !!options.plan;
      active.visible = !!hl && hl.prog > 0 && !!options.plan;
      if (active.visible) {
        const end = hl.a + (hl.b - hl.a) * hl.prog,
          points = [pathAt(hl.a)];
        for (let q = Math.floor(hl.a) + 1; q < end; q++) points.push(pathAt(q));
        points.push(pathAt(end));
        active.geometry.dispose();
        active.geometry = new T.BufferGeometry().setFromPoints(points);
      }
      dots.forEach((dot, i) => {
        dot.visible =
          !!options.plan && !!hl && i < hl.E && (i + 1) / hl.E <= hl.prog;
        if (dot.visible)
          dot.position.copy(pathAt(hl.a + ((hl.b - hl.a) * (i + 1)) / hl.E));
      });

      camera.aspect = width / height;
      camera.position.set(1.18, 0.86, 1.32);
      camera.lookAt(0.26, 0.30, -0.01);
      camera.fov = 33;
      camera.updateProjectionMatrix();
      if (
        renderer.domElement.width !== width ||
        renderer.domElement.height !== height
      )
        renderer.setSize(width, height, false);
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
    if (!studioLoad) studioLoad = new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(() => {
        loadThree()
          .then(() => { studio = createStudio(); })
          .catch((error) => { studio = null; console.warn("WebGL unavailable; SVG fallback remains active.", error); })
          .finally(() => resolve(studio));
      }, 0));
    });
    return studioLoad;
  }

  function mount(container, options = {}) {
    if (!canWebGL || studio === null || studio?.failed) return null;
    const poster = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
    poster.setAttribute("aria-hidden", "true");
    poster.className = "robot-poster";
    poster.alt = "";
    poster.src = new URL("preview-0.webp?v=20261128o", ASSETS).href;
    container.appendChild(poster);
    const canvas = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.className = "robot-live";
    canvas.style.cssText = "display:block;width:100%;height:100%;";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let p = 0,
      hl = null,
      worldState = null,
      view = options.view || "studio",
      previous = "",
      width = options.width || 1000,
      height = options.height || 700,
      visible = false,
      rendered = false,
      posterFrame = 0;
    canvas.width = width;
    canvas.height = height;

    function draw() {
      if (!rendered) {
        const next = Math.max(0, Math.min(MAX_P, Math.round(p)));
        if (next !== posterFrame) {
          posterFrame = next;
          poster.src = new URL(`preview-${next}.webp?v=20261128o`, ASSETS).href;
        }
      }
      const shared = studio;
      if (!visible || !shared?.ready || shared.failed) return;
      const ck = worldState ? Math.round(worldState.clock * 1000) : Math.round(p * 1000);
      const key = JSON.stringify([
        Math.round(p * 10000),
        ck,
        worldState ? [!!worldState.catch1, !!worldState.catch2] : null,
        hl,
        view,
        width,
        height,
      ]);
      if (previous === key && shared.ready) return;
      if (shared.render(p, hl, view, options, width, height, worldState)) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(shared.renderer.domElement, 0, 0);
        previous = key;
        rendered = true;
        container.classList?.add("robot-ready");
        poster.remove();
      }
    }
    const client = {
      set(progress, highlight, world) {
        p = progress;
        hl = highlight || null;
        worldState = world || null;
        draw();
      },
      setView(value) {
        view = value;
        previous = "";
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
    client.ready = new Promise((resolve) => { resolveReady = resolve; });
    const start = () => {
      if (start.done) return;
      start.done = true;
      loadStudio().then(async (shared) => {
        if (!shared) { client.fail(); return; }
        await shared.load;
        draw();
      }).finally(resolveReady);
    };
    clients.add(client);
    if (typeof IntersectionObserver === "function") {
      new IntersectionObserver((entries, io) => {
        if (entries[0].isIntersecting) { start(); io.disconnect(); }
      }, { rootMargin: "50% 0px" }).observe(container);
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible) draw();
      }, { rootMargin: "160px" }).observe(container);
    } else start();
    draw();
    return client;
  }

  // Expose physics constants so fig-race.js evaluates bowl catches from the exact same kinematics.
  window.PFRobotStudio = {
    mount,
    BELT_SPEED,
    BOWL1_PICK_Z,
    BOWL1_PICK_T,
    BOWL2_PICK_Z,
    BOWL2_PICK_T,
    GRASP_TOL,
  };
  window.PFRobotScene = function (PF, parent, x, y, w, options = {}) {
    if (!canWebGL || studio === null || studio?.failed) return null;
    const g = PF.el("g", { transform: `translate(${x} ${y})` }, parent),
      h = w * 0.66;
    const foreign = PF.el("foreignObject", { width: w, height: h }, g);
    const surface = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    surface.className = "robot-surface";
    foreign.appendChild(surface);
    let fallback;
    const client = mount(surface, {
      ...options,
      width: 600,
      height: 396,
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
