// Adapted from OneFlow project-page/js/robot-scene.js. Mesh provenance is in arm-model/SOURCE.txt.
// This module only renders a requested pose. The controller owns the network-call clock.
(() => {
  "use strict";
  const T = window.THREE;
  const ASSETS = new URL("../assets/arm-model/", document.currentScript.src);
  const frames = [
    [42, 32, 0],
    [48, 38, 0],
    [48, 54, 0],
    [48, 54, 1],
    [48, 38, 1],
    [62, 28, 1],
    [76, 38, 1],
    [76, 54, 1],
    [76, 54, 0],
    [76, 38, 0],
    [58, 28, 0],
    [42, 32, 0],
  ];
  function task(p) {
    p = Math.max(0, Math.min(11, p));
    const k = Math.min(10, Math.floor(p)),
      u = p - k,
      f = u * u * u * (10 - 15 * u + 6 * u * u);
    const a = frames[k],
      b = frames[k + 1];
    const x = a[0] + (b[0] - a[0]) * f,
      y = a[1] + (b[1] - a[1]) * f;
    return {
      p,
      position: new T.Vector3(
        0.46,
        0.02 + (54 - y) * 0.012,
        0.16 - ((x - 48) / 28) * 0.32,
      ),
      grip: a[2] + (b[2] - a[2]) * f,
    };
  }
  function createStudio() {
    if (!T) return null;
    const canvas = document.createElement("canvas");
    const settings = { antialias:true, alpha:true, powerPreference:"low-power" };
    const context = canvas.getContext("webgl2", settings) || canvas.getContext("webgl", settings);
    if (!context) return null;
    const renderer = new T.WebGLRenderer({ canvas, context, ...settings });
    renderer.setPixelRatio(1);
    renderer.setSize(1000, 700);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.VSMShadowMap;
    const world = new T.Scene();
    // Transparent surroundings let the same studio sit naturally in every figure.
    renderer.setClearColor(0x000000, 0);
    const camera = new T.PerspectiveCamera(32, 10 / 7, 0.01, 30);
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
        color: "#3f6ea6",
        metalness: 0.3,
        roughness: 0.27,
      }),
      green: new T.MeshStandardMaterial({
        color: "#7e9fc8",
        emissive: "#254568",
        emissiveIntensity: 0.3,
      }),
    };
    // Broad reflection cards provide a continuous highlight across the real shell surfaces.
    const env = new T.Scene();
    env.background = new T.Color("#a3a8ae");
    function card(x, y, z, w, h, power) {
      const mesh = new T.Mesh(
        new T.PlaneGeometry(w, h),
        new T.MeshBasicMaterial({
          color: new T.Color(power, power, power),
          side: T.DoubleSide,
        }),
      );
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      env.add(mesh);
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
    world.add(new T.HemisphereLight("#eef1f4", "#74797f", 0.65));
    const key = new T.DirectionalLight("#fff7e9", 2.5);
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
    key.target.position.set(0.2, 0.3, 0);
    world.add(key, key.target);
    const fill = new T.DirectionalLight("#d5e5ed", 0.65);
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
      new T.ShadowMaterial({ color: "#39424d", opacity: 0.14 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.castShadow = false;
    const base = mesh(
      new T.CylinderGeometry(0.115, 0.12, 0.012, 80),
      materials.off_white,
    );
    base.position.y = -0.002;
    // Rounded target block: beveled edges catch light without a painted outline.
    const shape = new T.Shape();
    const r = 0.003,
      half = 0.017;
    shape.moveTo(-half + r, -half);
    shape.lineTo(half - r, -half);
    shape.quadraticCurveTo(half, -half, half, -half + r);
    shape.lineTo(half, half - r);
    shape.quadraticCurveTo(half, half, half - r, half);
    shape.lineTo(-half + r, half);
    shape.quadraticCurveTo(-half, half, -half, half - r);
    shape.lineTo(-half, -half + r);
    shape.quadraticCurveTo(-half, -half, -half + r, -half);
    const cubeGeo = new T.ExtrudeGeometry(shape, {
      depth: 0.034,
      bevelEnabled: true,
      bevelSize: 0.003,
      bevelThickness: 0.003,
      bevelSegments: 4,
      steps: 1,
      curveSegments: 8,
    });
    cubeGeo.translate(0, 0, -0.017);
    const cube = mesh(
      cubeGeo,
      new T.MeshPhysicalMaterial({
        color: "#d8a632",
        metalness: 0.32,
        roughness: 0.27,
        clearcoat: 0.22,
      }),
    );
    const pad = mesh(
      new T.CylinderGeometry(0.052, 0.052, 0.002, 64),
      new T.MeshStandardMaterial({ color: "#8a95a2", roughness: 0.8 }),
    );
    pad.position.set(0.46, -0.001, -0.16);
    const ring = mesh(
      new T.TorusGeometry(0.046, 0.0006, 6, 80),
      new T.MeshStandardMaterial({ color: "#dde3ea", roughness: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0.46, 0.0003, -0.16);
    ring.castShadow = false;
    // A faint ground contact layer complements the broad dynamic shadows.
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sc = shadowCanvas.getContext("2d"),
      radial = sc.createRadialGradient(64, 64, 8, 64, 64, 64);
    radial.addColorStop(0, "rgba(20,26,34,.26)");
    radial.addColorStop(0.4, "rgba(20,26,34,.12)");
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
    const joints = [], fingers = [];
    let motion,
      ready = false,
      failed = false;
    const fetchAsset = async (name) => {
      const response = await fetch(new URL(name, ASSETS));
      if (!response.ok) throw Error(`Robot asset ${name}: ${response.status}`);
      if (name.endsWith(".json")) return response.json();
      // The quantized mesh buffer is stored gzip-compressed and inflated here, so its transfer
      // size does not depend on how the server compresses binary files.
      const bytes = await response.arrayBuffer();
      const prefix = new Uint8Array(bytes, 0, 2);
      if (prefix[0] !== 0x1f || prefix[1] !== 0x8b) return bytes;
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
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
          // Positions: uint16 per axis over the mesh bounding box, decoded once to metres.
          // Normals: normalized int8, used directly by the shader.
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

      })
      .catch((error) => {
        failed = true;
        throw error;
      });
    function render(p, view, width, height) {
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
        (finger) => (finger.position.y = 0.04 - (0.04 - 0.0204) * s.grip),
      );
      cube.position.copy(
        s.p >= 3 && s.p < 8
          ? s.position
          : new T.Vector3(0.46, 0.02, s.p < 3 ? 0.16 : -0.16),
      );
      camera.aspect = width / height;
      // Both endpoints are the original project cameras. Interpolate their world-space
      // targets while keeping the gripper in view throughout the live camera change.
      const zoom = typeof view === "number" ? view : Number(view === "detail");
      const detailCamera = s.position.clone().add(new T.Vector3(.42, .25, .49));
      const detailTarget = s.position.clone().add(new T.Vector3(0, .065, 0));
      camera.position.set(1.25, .85, 1.45).lerp(detailCamera, zoom);
      camera.lookAt(new T.Vector3(.21, .32, 0).lerp(detailTarget, zoom));
      camera.fov = 28 + 3 * zoom;
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
      window.dispatchEvent(new Event("oneflow:arm-context-lost"));
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

  let ready;
  window.OneFlowCallScene = {
    load() {
      if (!ready) ready = Promise.resolve().then(async () => {
        const shared = createStudio();
        if (!shared) throw Error("3D rendering unavailable");
        await shared.load;
        return (canvas, position, view) => {
          if (!shared.render(position, view, canvas.width, canvas.height)) return false;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(shared.renderer.domElement, 0, 0);
          return true;
        };
      });
      return ready;
    },
  };
})();
