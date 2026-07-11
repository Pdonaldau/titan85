/* ============================================================
   Titan85 — 3D physique renderer (SDF raymarching)
   The body is ONE continuous signed-distance field: torso, limbs,
   glutes and joints blend smoothly into each other (smooth-min),
   so there are no seams or "stuck-on" parts anywhere. Rendered in
   a fragment shader on a fullscreen quad via Three.js (bundled,
   fully offline). Shape params (all 0..1):
     muscle  — shoulders, chest, arms, calves, traps
     lean    — waist taper, belly reduction
     mass    — overall size, hips, thighs, neck
     stature — from user height; stretches the legs
   Morphing is free: params are shader uniforms, tweened per frame.
   Exposes window.Physique3D = { mount, setParams, morphTo }.
   ============================================================ */
(function () {
  "use strict";

  let THREE = null;
  let renderer, scene, camera, quadMat;
  let canvasEl = null;
  let cur = { muscle: 0.3, lean: 0.35, mass: 0.42, stature: 0.5, fem: 0 };
  let tween = null;
  let running = false;

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const VERT = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`;

  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform float uAspect, uRot, uBreath;
    uniform float uMuscle, uLean, uMass, uStature, uFem;

    float smin(float a, float b, float k) {
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(b, a, h) - k * h * (1.0 - h);
    }
    float sdEllipsoid(vec3 p, vec3 r) {
      float k0 = length(p / r);
      float k1 = length(p / (r * r));
      return k0 * (k0 - 1.0) / k1;
    }
    // capsule with different end radii (iq's round cone)
    float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
      vec3 ba = b - a;
      float l2 = dot(ba, ba);
      float rr = r1 - r2;
      float a2 = l2 - rr * rr;
      float il2 = 1.0 / l2;
      vec3 pa = p - a;
      float y = dot(pa, ba);
      float z = y - l2;
      vec3 xv = pa * l2 - ba * y;
      float x2 = dot(xv, xv);
      float y2 = y * y * l2;
      float z2 = z * z * l2;
      float k = sign(rr) * rr * rr * x2;
      if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
      if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
      return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
    }

    // ---- the whole body as one smoothly-blended distance field ----
    float map(vec3 pw) {
      float c = cos(uRot), s = sin(uRot);
      vec3 p = vec3(c * pw.x + s * pw.z, pw.y, -s * pw.x + c * pw.z);
      float M = uMuscle, L = uLean, W = uMass, St = uStature, F = uFem;
      // muscular kilos sit on shoulders/chest/arms, not hips — split W
      float WL = W * (1.0 - 0.45 * M) + 0.10 * F;   // lower-body mass (women carry more here)
      float belly = max(0.0, 2.5 * W - 3.4 * L + 0.7) * (1.0 - 0.25 * F);
      float breath = 1.0 + uBreath;
      vec3 q = vec3(abs(p.x), p.y, p.z);

      // torso core
      float d = sdEllipsoid(p - vec3(0.0, 55.0, -0.8), vec3(8.4 + 1.8*WL + 1.5*F, 6.8, 6.0 + 1.2*WL));             // pelvis
      d = smin(d, sdEllipsoid(p - vec3(0.0, 65.5, 0.1 + 0.4*belly),
                 vec3(9.2 + 3.0*W - 2.0*L + 0.6*M - 1.4*F, 8.5, 4.9 + 1.7*W - 1.3*L + 0.9*belly)), 3.5);          // waist/belly
      d = smin(d, sdEllipsoid(p - vec3(0.0, 82.0, 0.9 + 0.8*M - 0.6*F),
                 vec3((11.4 + 3.4*M + 1.0*W - 1.6*F) * breath, 6.8, (4.8 + 1.2*M + 0.6*W) * breath)), 5.0);       // chest — wide flat slab
      d = smin(d, sdEllipsoid(q - vec3(3.8, 79.5 - 1.5*F, 3.0 + 0.8*M),
                 vec3(2.6 + 1.8*M, 2.0 + 1.0*M + 1.0*F, 0.8 + 1.0*M + 1.2*F)), 2.6);                              // pecs (emerge with muscle) / bust
      float sw = 8.8 + 5.0*M + 0.5*W - 2.0*F;                                                                      // shoulder half-width
      d = smin(d, sdRoundCone(p, vec3(-sw, 87.5, 0.2), vec3(sw, 87.5, 0.2), 3.6 + 1.0*M - 0.5*F, 3.6 + 1.0*M - 0.5*F), 3.0); // shoulder bar
      d = smin(d, sdEllipsoid(p - vec3(0.0, 88.6, -1.2), vec3(5.5 + 2.6*M, 3.2 + 0.8*M, 3.8)), 3.0);              // traps
      d = smin(d, sdRoundCone(p, vec3(0.0, 90.0, -0.4), vec3(0.0, 97.5, -0.2), 3.6 + 0.9*M - 0.6*F, 2.8 + 0.5*M - 0.4*F), 2.5); // neck
      d = smin(d, sdEllipsoid(p - vec3(0.0, 103.3, 0.3), vec3(5.2, 6.5, 5.5)), 1.8);                              // head
      d = smin(d, sdEllipsoid(q - vec3(4.2, 53.0, -3.0), vec3(4.0 + 0.7*WL + 0.8*F, 5.0, 4.0 + 0.5*WL + 0.6*F)), 3.5); // glutes

      // arms (mirrored) — deltoid, upper, forearm, hand all blended
      vec3 shJ = vec3(sw + 0.6, 87.2, 0.2);
      vec3 elJ = vec3(sw + 4.4 + 1.2*M, 70.5, 0.8);
      vec3 wrJ = vec3(sw + 6.2 + 1.2*M, 55.0, 2.6);
      d = smin(d, sdEllipsoid(q - vec3(sw + 0.7, 86.9, 0.2), vec3(3.0 + 1.8*M - 0.4*F, 3.0 + 1.6*M - 0.4*F, 2.9 + 1.5*M - 0.4*F)), 2.8); // deltoid
      d = smin(d, sdRoundCone(q, shJ, elJ, 2.8 + 1.7*M + 0.3*W - 0.5*F, 2.2 + 0.9*M - 0.3*F), 2.2);               // upper arm
      d = smin(d, sdRoundCone(q, elJ, wrJ, 2.4 + 1.3*M - 0.4*F, 1.6 + 0.3*M - 0.2*F), 2.0);                       // forearm
      d = smin(d, sdEllipsoid(q - (wrJ + vec3(0.4, -3.6, 0.6)), vec3(1.9, 3.2, 1.3)), 1.6);                       // hand

      // legs (mirrored) — thigh grows out of pelvis/glutes, calf out of shin
      float drop = 2.5 * St;
      vec3 hipJ = vec3(5.6 + 0.8*WL, 55.5, -0.6);
      vec3 knJ  = vec3(6.4, 30.5 - drop, 1.2);
      vec3 anJ  = vec3(5.6, 6.0, -0.4);
      d = smin(d, sdRoundCone(q, hipJ, knJ, 5.2 + 1.6*WL + 1.1*M, 3.1 + 0.5*M + 0.3*WL), 3.2);                    // thigh
      d = smin(d, sdRoundCone(q, knJ, anJ, 3.1 + 0.5*M, 1.9), 2.2);                                               // shin
      d = smin(d, sdEllipsoid(q - vec3(6.0, 25.0 - drop, -1.6), vec3(2.1 + 0.5*M, 4.4, 2.2 + 1.0*M)), 2.4);       // calf
      d = smin(d, sdEllipsoid(q - vec3(5.6, 2.3, 2.6), vec3(2.8, 1.7, 5.4)), 1.5);                                // foot
      return d;
    }

    vec3 calcNormal(vec3 p) {
      vec2 e = vec2(1.0, -1.0) * 0.5773 * 0.12;
      return normalize(
        e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
        e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
    }

    vec3 aces(vec3 x) {
      return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    void main() {
      // camera (matches the previous mesh version framing)
      vec3 ro = vec3(0.0, 58.0, 192.0);
      vec3 ta = vec3(0.0, 55.0, 0.0);
      vec3 fw = normalize(ta - ro);
      vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(rt, fw);
      vec2 ndc = vUv * 2.0 - 1.0;
      float tanF = 0.3057;  // tan(34deg/2)
      vec3 rd = normalize(fw + ndc.x * tanF * uAspect * rt + ndc.y * tanF * up);

      // march
      float t = 90.0;
      float hit = -1.0;
      for (int i = 0; i < 96; i++) {
        vec3 pos = ro + rd * t;
        float h = map(pos);
        if (h < 0.05) { hit = t; break; }
        t += h * 0.9;
        if (t > 330.0) break;
      }

      vec3 col = vec3(0.0);
      float alpha = 0.0;

      if (hit > 0.0) {
        vec3 p = ro + rd * hit;
        vec3 n = calcNormal(p);
        float ao = clamp(map(p + n * 3.0) / 3.0, 0.0, 1.0) * 0.5 + 0.5;

        // warm clay skin; key light well off to the side so muscle forms
        // actually cast shading across the body instead of flat frontal light
        vec3 albedo = vec3(0.50, 0.37, 0.28);
        vec3 keyL = normalize(vec3(0.62, 0.58, 0.38));
        vec3 fillL = normalize(vec3(-0.45, 0.25, 0.75));
        vec3 rimL = normalize(vec3(-0.55, 0.30, -0.72));

        vec3 hemi = mix(vec3(0.10, 0.13, 0.22), vec3(0.68, 0.74, 0.90), n.y * 0.5 + 0.5) * 0.30;
        vec3 lit = hemi;
        lit += vec3(1.0, 0.95, 0.88) * max(dot(n, keyL), 0.0) * 0.95;
        lit += vec3(0.48, 0.64, 1.00) * max(dot(n, fillL), 0.0) * 0.12;
        col = albedo * lit * ao;

        // green rim (matches app accent)
        float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        col += vec3(0.13, 0.77, 0.35) * fres * (max(dot(n, rimL), 0.0) * 0.9 + 0.25) * 1.15;

        // soft specular from key
        vec3 hv = normalize(keyL - rd);
        col += vec3(1.0) * pow(max(dot(n, hv), 0.0), 24.0) * 0.18;

        alpha = 1.0;
      } else if (rd.y < -0.02) {
        // contact shadow on the floor plane
        float tf = (0.0 - ro.y) / rd.y;
        vec3 fp = ro + rd * tf;
        if (tf > 0.0 && abs(fp.x) < 60.0 && abs(fp.z) < 60.0) {
          float d1 = map(fp + vec3(0.0, 2.0, 0.0));
          float d2 = map(fp + vec3(0.0, 7.0, 0.0));
          float occ = clamp(1.0 - d1 / 8.0, 0.0, 1.0) * 0.6 + clamp(1.0 - d2 / 14.0, 0.0, 1.0) * 0.4;
          alpha = 0.62 * occ * occ;
          col = vec3(0.0);
        }
      }

      col = aces(col);
      col = pow(col, vec3(1.0 / 2.2));
      gl_FragColor = vec4(col, alpha);
    }`;

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
    u.uRot.value = Math.sin(s * 0.45) * 0.38;
    u.uBreath.value = Math.sin(s * 1.15) * 0.012;
    renderer.render(scene, camera);
  }

  function resize() {
    if (!canvasEl || !renderer) return;
    const w = canvasEl.clientWidth, h = canvasEl.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(dpr);
    quadMat.uniforms.uAspect.value = w / h;
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

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    scene = new THREE.Scene();
    camera = new THREE.Camera(); // shader does its own projection

    quadMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      uniforms: {
        uAspect:  { value: 1 },
        uRot:     { value: 0 },
        uBreath:  { value: 0 },
        uMuscle:  { value: cur.muscle },
        uLean:    { value: cur.lean },
        uMass:    { value: cur.mass },
        uStature: { value: cur.stature },
        uFem:     { value: cur.fem },
      },
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));

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
  window.__FRAG_TAG = "warm-sidelit-v6";
})();
