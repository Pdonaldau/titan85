/* ============================================================
   Titan85 — 3D physique mannequin
   A parametric human body mesh built entirely in code and
   rendered with Three.js (bundled locally — fully offline).
   The body shape is a continuous function of three params:
     muscle 0..1 — shoulders, chest, arms, calves, traps
     lean   0..1 — waist taper, belly reduction
     mass   0..1 — overall size, hips, thighs, neck
   Exposes window.Physique3D = { mount, setParams, morphTo }.
   ============================================================ */
(function () {
  "use strict";

  let THREE = null;
  let renderer, scene, camera, bodyGroup, material;
  let canvasEl = null;
  let cur = { muscle: 0.3, lean: 0.35, mass: 0.42 };
  let tween = null;   // { from, to, t0, dur }
  let dirty = true;
  let running = false;

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  /* ---------- geometry helpers ---------- */

  // Smooth an array of numbers in place-ish (simple neighbour averaging).
  function smooth(arr, passes) {
    let a = arr.slice();
    for (let p = 0; p < passes; p++) {
      const b = a.slice();
      for (let i = 1; i < a.length - 1; i++) b[i] = (a[i - 1] + a[i] * 2 + a[i + 1]) / 4;
      a = b;
    }
    return a;
  }

  // Linear interpolation over (y, value) stations for a given y.
  function stationValue(stations, y, idx) {
    if (y <= stations[0][0]) return stations[0][idx];
    for (let i = 0; i < stations.length - 1; i++) {
      const [y0] = stations[i], [y1] = stations[i + 1];
      if (y >= y0 && y <= y1) {
        const t = (y - y0) / (y1 - y0);
        return lerp(stations[i][idx], stations[i + 1][idx], t);
      }
    }
    return stations[stations.length - 1][idx];
  }

  // Build a lofted, capped surface from horizontal elliptical rings.
  // ringDefs: [{y, rx, rz, front (extra +z bulge), back (extra -z bulge), zc (centre z offset — posture curve)}]
  function loft(ringDefs, radialSegs) {
    const pos = [];
    const idx = [];
    const R = ringDefs.length;

    // bottom pole (shallow so the pelvis doesn't poke down between the legs)
    pos.push(0, ringDefs[0].y - Math.min(ringDefs[0].rx, ringDefs[0].rz) * 0.3, ringDefs[0].zc || 0);
    const bottomPole = 0;

    for (let r = 0; r < R; r++) {
      const d = ringDefs[r];
      // taper cap rings toward the poles for rounded closure
      for (let s = 0; s < radialSegs; s++) {
        const th = (s / radialSegs) * Math.PI * 2;
        const cx = Math.cos(th), sz = Math.sin(th);
        let x = d.rx * cx;
        let z = (d.zc || 0) + d.rz * sz;
        if (sz > 0 && d.front) z += d.front * Math.pow(sz, 1.6);
        if (sz < 0 && d.back) z -= d.back * Math.pow(-sz, 1.6);
        pos.push(x, d.y, z);
      }
    }

    // top pole
    const last = ringDefs[R - 1];
    pos.push(0, last.y + Math.min(last.rx, last.rz) * 0.5, last.zc || 0);
    const topPole = pos.length / 3 - 1;

    const ring = r => 1 + r * radialSegs; // first vertex index of ring r

    // bottom fan
    for (let s = 0; s < radialSegs; s++) {
      idx.push(bottomPole, ring(0) + ((s + 1) % radialSegs), ring(0) + s);
    }
    // walls
    for (let r = 0; r < R - 1; r++) {
      for (let s = 0; s < radialSegs; s++) {
        const a = ring(r) + s, b = ring(r) + ((s + 1) % radialSegs);
        const c = ring(r + 1) + s, d2 = ring(r + 1) + ((s + 1) % radialSegs);
        idx.push(a, b, c, b, d2, c);
      }
    }
    // top fan
    for (let s = 0; s < radialSegs; s++) {
      idx.push(topPole, ring(R - 1) + s, ring(R - 1) + ((s + 1) % radialSegs));
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Tapered tube along a Catmull-Rom curve with a radius profile fn(s 0..1).
  function taperedTube(points, radiusFn, tubularSegs, radialSegs) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const frames = curve.computeFrenetFrames(tubularSegs, false);
    const pos = [], idx = [];
    for (let i = 0; i <= tubularSegs; i++) {
      const s = i / tubularSegs;
      const p = curve.getPointAt(s);
      const N = frames.normals[Math.min(i, tubularSegs - 1)];
      const B = frames.binormals[Math.min(i, tubularSegs - 1)];
      const r = radiusFn(s);
      for (let j = 0; j < radialSegs; j++) {
        const th = (j / radialSegs) * Math.PI * 2;
        const c = Math.cos(th), sn = Math.sin(th);
        pos.push(
          p.x + r * (c * N.x + sn * B.x),
          p.y + r * (c * N.y + sn * B.y),
          p.z + r * (c * N.z + sn * B.z)
        );
      }
    }
    for (let i = 0; i < tubularSegs; i++) {
      for (let j = 0; j < radialSegs; j++) {
        const a = i * radialSegs + j, b = i * radialSegs + ((j + 1) % radialSegs);
        const c = (i + 1) * radialSegs + j, d = (i + 1) * radialSegs + ((j + 1) % radialSegs);
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Piecewise-smooth radius profile from (s, r) stops.
  function profile(stops) {
    return s => {
      if (s <= stops[0][0]) return stops[0][1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (s >= stops[i][0] && s <= stops[i + 1][0]) {
          const t = (s - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
          const e = t * t * (3 - 2 * t); // smoothstep
          return lerp(stops[i][1], stops[i + 1][1], e);
        }
      }
      return stops[stops.length - 1][1];
    };
  }

  /* ---------- the body ---------- */

  function buildBody(p) {
    const muscle = clamp01(p.muscle), lean = clamp01(p.lean), mass = clamp01(p.mass);
    const group = new THREE.Group();
    const add = geo => { const m = new THREE.Mesh(geo, material); group.add(m); return m; };

    /* --- torso: lofted rings from pelvis (y≈48) to neck base (y≈92) --- */
    const belly = Math.max(0, 3.2 * mass - 4.2 * lean + 1.2);
    // stations: y, rx, rz, front bulge, back bulge, zc (posture S-curve)
    const st = [
      [51, 7.4 + mass * 1.5,            5.5 + mass * 0.9,  0,          0,                 -0.9],
      [57, 11.0 + mass * 2.2,           7.2 + mass * 1.4,  belly*0.35, 0.4,               -0.7],
      [64, 9.8 + mass * 3.8 - lean*3.2 + muscle*0.6, 6.8 + mass*2.7 - lean*2.0, belly, 0.6,  0.1],
      [71, 10.0 + mass * 3.2 - lean*2.5 + muscle*1.2, 7.0 + mass*2.0 - lean*1.5, belly*0.75, 1.0 + muscle*0.8, 0.7],
      [79, 11.4 + muscle * 2.6 + mass * 1.5,  7.6 + mass * 1.1,  1.0 + muscle*1.6, 1.4 + muscle*1.2, 1.2],
      [85, 12.2 + muscle * 4.2 + mass * 0.9,  7.8 + mass * 0.7,  1.2 + muscle*2.0, 1.2 + muscle*1.4, 1.2],
      [90, 13.0 + muscle * 6.4 + mass * 0.6,  7.4 + muscle*0.9,  0.4 + muscle*0.6, 0.8 + muscle*1.4, 0.5],
      [92.5, (13.0 + muscle * 6.4) * 0.30,    4.6,               0,          0.3 + muscle*0.6,  -0.2],
    ];
    const rings = [];
    const RN = 34;
    const ys = [], rxs = [], rzs = [], fs = [], bs = [], zcs = [];
    for (let i = 0; i < RN; i++) {
      const y = lerp(st[0][0], st[st.length - 1][0], i / (RN - 1));
      ys.push(y);
      rxs.push(stationValue(st, y, 1));
      rzs.push(stationValue(st, y, 2));
      fs.push(stationValue(st, y, 3));
      bs.push(stationValue(st, y, 4));
      zcs.push(stationValue(st, y, 5));
    }
    const rxS = smooth(rxs, 3), rzS = smooth(rzs, 3), fS = smooth(fs, 2), bS = smooth(bs, 2), zcS = smooth(zcs, 3);
    for (let i = 0; i < RN; i++) rings.push({ y: ys[i], rx: rxS[i], rz: rzS[i], front: fS[i], back: bS[i], zc: zcS[i] });
    add(loft(rings, 36));

    const shoulderRx = 13.0 + muscle * 6.4 + mass * 0.6;

    /* --- neck + head (faceless mannequin) --- */
    const neckR = 2.6 + muscle * 1.1 + mass * 0.25;
    add(taperedTube([[0, 90.5, -0.4], [0, 95, -0.7], [0, 99, -0.3]], profile([[0, neckR + 1.4], [0.5, neckR], [1, neckR + 0.3]]), 8, 18));
    const head = add(new THREE.SphereGeometry(5.9, 28, 22));
    head.position.set(0, 103.4, 0.3);
    head.scale.set(0.9, 1.12, 0.96);

    /* --- arms: one continuous tapered limb, deltoid + hand built in --- */
    const flare = 6.0 + muscle * 3.2;                // how far the arm swings out
    const dSh = 3.1 + muscle * 2.3 + mass * 0.3;     // deltoid
    const dBi = 2.5 + muscle * 2.3 + mass * 0.35;    // biceps
    const dEl = 2.0 + muscle * 0.9;                  // elbow
    const dFo = 2.2 + muscle * 1.3;                  // forearm
    const dWr = 1.5 + muscle * 0.3;                  // wrist
    const armX = shoulderRx - dSh * 0.55;            // rooted inside the torso wall
    // radius profile runs shoulder→fingertips; the swell at .90 is the palm
    const armProfile = profile([
      [0, dSh * 0.9], [0.10, dSh], [0.22, dSh * 0.9], [0.32, dBi], [0.48, dEl],
      [0.60, dFo], [0.78, dWr], [0.86, dWr * 0.95], [0.90, dWr * 1.25], [1, dWr * 0.5],
    ]);
    for (const side of [-1, 1]) {
      const tip = [side * (armX + flare + 0.6), 45.5, 3.6];
      add(taperedTube(
        [[side * (armX - dSh * 0.4), 87.9, 0],
         [side * armX, 87.6, 0.2],
         [side * (armX + flare * 0.72), 71, 0.8],
         [side * (armX + flare), 55, 2.8],
         tip],
        armProfile, 30, 18));
      // rounded fingertip closure
      const end = add(new THREE.SphereGeometry(dWr * 0.55, 12, 10));
      end.position.set(tip[0], tip[1] + 0.2, tip[2]);
      end.scale.set(1, 1.2, 0.9);
    }

    /* --- legs --- */
    const hipX = 7.2 + mass * 0.8;
    const tTh = 4.5 + mass * 1.5 + muscle * 1.0;   // thigh
    const tKn = 2.9 + muscle * 0.5 + mass * 0.35;  // knee
    const tCa = 3.0 + muscle * 1.3 + mass * 0.4;   // calf
    const tAn = 1.8 + mass * 0.15;                 // ankle
    const legProfile = profile([[0, tTh], [0.28, tTh * 0.88], [0.48, tKn], [0.64, tCa], [1, tAn]]);
    for (const side of [-1, 1]) {
      add(taperedTube(
        [[side * (hipX - 0.3), 58, -0.7], [side * hipX, 55, -0.3], [side * (hipX + 0.3), 30, 1.6], [side * (hipX - 1.3), 5.5, -0.4]],
        legProfile, 26, 18));
      // foot
      const foot = add(new THREE.SphereGeometry(2.6, 18, 14));
      foot.position.set(side * (hipX - 1.3), 2.0, 2.6);
      foot.scale.set(1.15, 0.6, 2.3);
    }

    return group;
  }

  /* ---------- scene ---------- */

  function rebuild() {
    if (bodyGroup) {
      scene.remove(bodyGroup);
      bodyGroup.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    }
    bodyGroup = buildBody(cur);
    scene.add(bodyGroup);
  }

  function makeFloorShadow() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, "rgba(0,0,0,0.42)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 34),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.5;
    return mesh;
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);

    // skip work while the Today view (or the app) is hidden — saves battery
    if (document.hidden || !canvasEl.offsetParent) return;

    // tween params
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.dur);
      const e = easeInOut(t);
      cur = {
        muscle: lerp(tween.from.muscle, tween.to.muscle, e),
        lean:   lerp(tween.from.lean,   tween.to.lean,   e),
        mass:   lerp(tween.from.mass,   tween.to.mass,   e),
      };
      dirty = true;
      if (t >= 1) tween = null;
    }
    if (dirty) { rebuild(); dirty = false; }

    // idle motion: gentle sway + breathing
    const s = now / 1000;
    if (bodyGroup) {
      bodyGroup.rotation.y = Math.sin(s * 0.45) * 0.38;
      bodyGroup.scale.x = bodyGroup.scale.z = 1 + Math.sin(s * 1.15) * 0.006;
    }
    renderer.render(scene, camera);
  }

  function resize() {
    if (!canvasEl || !renderer) return;
    const w = canvasEl.clientWidth, h = canvasEl.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(dpr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---------- public API ---------- */

  async function mount(canvas) {
    if (renderer) return true;
    canvasEl = canvas;
    try {
      THREE = await import("./vendor/three.module.min.js");
    } catch (e) {
      console.warn("Physique3D: three.js failed to load", e);
      return false;
    }

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 1, 600);
    camera.position.set(0, 58, 185);
    camera.lookAt(0, 54, 0);

    scene.add(new THREE.HemisphereLight(0xdde7ff, 0x232f45, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(45, 90, 95);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x22c55e, 2.4);
    rim.position.set(-70, 45, -90);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x7aa2ff, 0.55);
    fill.position.set(-40, 25, 70);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0x33415e, 0.5));

    // DoubleSide: cap-fan winding varies per surface; culling holes are worse
    // than the negligible cost of shading both faces of one character.
    // Warm matte clay tone — reads organic rather than plastic mannequin.
    material = new THREE.MeshStandardMaterial({ color: 0xd8cfc4, roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide });

    scene.add(makeFloorShadow());
    rebuild();

    new ResizeObserver(resize).observe(canvas);
    resize();
    running = true;
    requestAnimationFrame(frame);
    return true;
  }

  function setParams(p) {
    cur = { muscle: clamp01(p.muscle), lean: clamp01(p.lean), mass: clamp01(p.mass) };
    tween = null;
    dirty = true;
  }

  function morphTo(p, dur) {
    tween = {
      from: { ...cur },
      to: { muscle: clamp01(p.muscle), lean: clamp01(p.lean), mass: clamp01(p.mass) },
      t0: performance.now(),
      dur: dur || 900,
    };
  }

  window.Physique3D = { mount, setParams, morphTo };
})();
