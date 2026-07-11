/* ============================================================
   Titan85 — 3D physique renderer (real human mesh)
   Renders data/body.bin — a preprocessed A-pose male base mesh
   (24k verts) with baked per-vertex morph weights — and morphs
   it in the vertex shader from the shape params (all 0..1):
     muscle  — deltoids/biceps/pecs/traps/lats/calves bulk
     lean    — reduces belly/love-handles/glute fat
     mass    — overall girth (BMI-driven)
     stature — leg length from user height
     fem     — female proportions (shoulders/hips/waist/bust)
   Morph = uniform tweening, perfectly smooth. Fully offline.
   Exposes window.Physique3D = { mount, setParams, morphTo }.
   ============================================================ */
(function () {
  "use strict";

  let THREE = null;
  let renderer, scene, camera, mesh, group, quadMat;
  let canvasEl = null;
  let cur = { muscle: 0.3, lean: 0.35, mass: 0.42, stature: 0.5, fem: 0 };
  let tween = null;
  let running = false;

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const VERT = `
    attribute float aR;   // distance to skeleton axis (girth reference)
    attribute vec4 aW1;   // muscle, fat, bellyPush, leg
    attribute vec4 aW2;   // shoulder, hip, bust, waist
    uniform float uMuscle, uLean, uMass, uStature, uFem, uBreath;
    varying vec3 vN;
    varying vec3 vWorld;

    void main() {
      // how much soft tissue this body carries
      float fat = clamp(uMass * 0.9 - uLean * 0.75 + 0.18, 0.0, 1.3);

      // fractional girth growth — applied along the vertex normal scaled
      // by distance-to-bone, which is seam-free across limb boundaries
      float gain =
          uMuscle * aW1.x * 0.45
        + fat     * aW1.y * 0.60
        + uMass   * 0.08
        - uLean   * 0.06 * (1.0 - aW1.x)
        + uFem    * (aW2.y * 0.26 - aW2.x * 0.22 - aW2.w * 0.18)
        + uBreath * aW2.z;

      vec3 pos = position + normalize(normal) * aR * gain;

      // belly pushes forward, bust with fem
      pos.z += fat  * aW1.z * 0.95;
      pos.z += uFem * aW2.z * 0.45;

      // stature: legs lengthen, everything above rides up
      float legS = 0.93 + uStature * 0.14;
      pos.y = mix(pos.y + 9.2 * (legS - 1.0), pos.y * legS, aW1.w);

      vN = normalMatrix * normal;
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      vWorld = (modelMatrix * vec4(pos, 1.0)).xyz;
      gl_Position = projectionMatrix * mv;
    }`;

  const FRAG = `
    precision highp float;
    varying vec3 vN;
    varying vec3 vWorld;
    uniform vec3 uCam;

    vec3 aces(vec3 x) {
      return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    void main() {
      vec3 n = normalize(vN);
      vec3 vdir = normalize(uCam - vWorld);

      vec3 albedo = vec3(0.50, 0.37, 0.28);   // warm clay
      vec3 keyL = normalize(vec3(0.62, 0.58, 0.38));
      vec3 fillL = normalize(vec3(-0.45, 0.25, 0.75));
      vec3 rimL = normalize(vec3(-0.55, 0.30, -0.72));

      vec3 hemi = mix(vec3(0.10, 0.13, 0.22), vec3(0.68, 0.74, 0.90), n.y * 0.5 + 0.5) * 0.30;
      vec3 lit = hemi;
      lit += vec3(1.0, 0.95, 0.88) * max(dot(n, keyL), 0.0) * 0.95;
      lit += vec3(0.48, 0.64, 1.00) * max(dot(n, fillL), 0.0) * 0.12;
      vec3 col = albedo * lit;

      // green accent rim
      float fres = pow(1.0 - max(dot(n, vdir), 0.0), 3.0);
      col += vec3(0.13, 0.77, 0.35) * fres * (max(dot(n, rimL), 0.0) * 0.9 + 0.25) * 1.05;

      // soft specular
      vec3 hv = normalize(keyL + vdir);
      col += vec3(1.0) * pow(max(dot(n, hv), 0.0), 24.0) * 0.15;

      col = aces(col);
      col = pow(col, vec3(1.0 / 2.2));
      gl_FragColor = vec4(col, 1.0);
    }`;

  /* ---------- body.bin loader ---------- */
  async function loadBody() {
    const res = await fetch("data/body.bin");
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf);
    const nVerts = dv.getUint32(0, true);
    const nIdx = dv.getUint32(4, true);
    const pad4 = n => (n + 3) & ~3;
    let off = 8;
    const pos = new Float32Array(buf, off, nVerts * 3); off += nVerts * 12;
    const rad = new Float32Array(buf, off, nVerts); off += nVerts * 4;
    const nrm8 = new Int8Array(buf, off, nVerts * 3); off += pad4(nVerts * 3);
    const w1 = new Uint8Array(buf, off, nVerts * 4); off += nVerts * 4;
    const w2 = new Uint8Array(buf, off, nVerts * 4); off += nVerts * 4;
    const idx = new Uint16Array(buf, off, nIdx);

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aR", new THREE.BufferAttribute(rad, 1));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm8, 3, true));
    g.setAttribute("aW1", new THREE.BufferAttribute(w1, 4, true));
    g.setAttribute("aW2", new THREE.BufferAttribute(w2, 4, true));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }

  function makeFloorShadow() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, "rgba(0,0,0,0.5)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 7),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.05;
    return m;
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden || !canvasEl.offsetParent) return;

    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.dur);
      const e = easeInOut(t);
      cur = {
        muscle:  lerp(tween.from.muscle,  tween.to.muscle,  e),
        lean:    lerp(tween.from.lean,    tween.to.lean,    e),
        mass:    lerp(tween.from.mass,    tween.to.mass,    e),
        stature: lerp(tween.from.stature, tween.to.stature, e),
        fem:     lerp(tween.from.fem,     tween.to.fem,     e),
      };
      if (t >= 1) tween = null;
    }

    const s = now / 1000;
    const u = quadMat.uniforms;
    u.uMuscle.value = cur.muscle;
    u.uLean.value = cur.lean;
    u.uMass.value = cur.mass;
    u.uStature.value = cur.stature;
    u.uFem.value = cur.fem;
    u.uBreath.value = Math.max(0, Math.sin(s * 1.1)) * 0.012;
    u.uCam.value.copy(camera.position);
    if (group) group.rotation.y = Math.sin(s * 0.45) * 0.42;
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

  function normParams(p) {
    return {
      muscle:  clamp01(p.muscle),
      lean:    clamp01(p.lean),
      mass:    clamp01(p.mass),
      stature: p.stature != null ? clamp01(p.stature) : cur.stature,
      fem:     p.fem != null ? clamp01(p.fem) : cur.fem,
    };
  }

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
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 0.5, 200);
    camera.position.set(0, 11.6, 39);
    camera.lookAt(0, 10.3, 0);

    quadMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMuscle:  { value: cur.muscle },
        uLean:    { value: cur.lean },
        uMass:    { value: cur.mass },
        uStature: { value: cur.stature },
        uFem:     { value: cur.fem },
        uBreath:  { value: 0 },
        uCam:     { value: new THREE.Vector3() },
      },
    });

    let geo;
    try {
      geo = await loadBody();
    } catch (e) {
      console.warn("Physique3D: body.bin failed to load", e);
      return false;
    }
    mesh = new THREE.Mesh(geo, quadMat);
    group = new THREE.Group();
    group.add(mesh);
    group.add(makeFloorShadow());
    scene.add(group);

    new ResizeObserver(resize).observe(canvas);
    resize();
    running = true;
    requestAnimationFrame(frame);
    return true;
  }

  function setParams(p) {
    cur = normParams(p);
    tween = null;
  }

  function morphTo(p, dur) {
    tween = { from: { ...cur }, to: normParams(p), t0: performance.now(), dur: dur || 900 };
  }

  window.Physique3D = { mount, setParams, morphTo };
  window.__FRAG_TAG = "realmesh-v8";
})();
