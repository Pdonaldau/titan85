/* ============================================================
   Titan85 — body mesh preprocessor (run once, offline)
   Reads mesh/FinalBaseMesh.obj (A-pose male base mesh, quads,
   v//vn) and bakes data/body.bin for the in-app renderer:
     - triangulated, deduped (v,vn) vertices
     - per-vertex skeleton axis point (radial morph origin)
     - per-vertex morph weights:
         w1 = [muscle, fat, bellyPush, leg]
         w2 = [shoulder, hip, bust, waist]   (fem morphs)
   Usage:  node tools/build-body.mjs
   ============================================================ */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "mesh", "FinalBaseMesh.obj");
const OUT = join(root, "data", "body.bin");

/* ---------- parse OBJ ---------- */
const positions = [], normals = [];
const outPos = [], outNrm = [], indices = [];
const vertMap = new Map(); // "vi/ni" -> out index

const lines = readFileSync(SRC, "utf8").split("\n");
const faceVerts = [];
for (const line of lines) {
  if (line.startsWith("v ")) {
    const [x, y, z] = line.trim().split(/\s+/).slice(1).map(Number);
    positions.push([x, y, z]);
  } else if (line.startsWith("vn ")) {
    const [x, y, z] = line.trim().split(/\s+/).slice(1).map(Number);
    normals.push([x, y, z]);
  } else if (line.startsWith("f ")) {
    const refs = line.trim().split(/\s+/).slice(1).map(tok => {
      const [v, , n] = tok.split("/");
      return [parseInt(v) - 1, parseInt(n) - 1];
    });
    faceVerts.push(refs);
  }
}

function outIndex([vi, ni]) {
  const key = vi + "/" + ni;
  let idx = vertMap.get(key);
  if (idx === undefined) {
    idx = outPos.length / 3;
    vertMap.set(key, idx);
    outPos.push(...positions[vi]);
    outNrm.push(...normals[ni]);
  }
  return idx;
}
for (const refs of faceVerts) {
  const idx = refs.map(outIndex);
  for (let i = 1; i < idx.length - 1; i++) indices.push(idx[0], idx[i], idx[i + 1]); // fan
}
const nVerts = outPos.length / 3;
console.log(`verts ${nVerts}, tris ${indices.length / 3}`);
if (nVerts > 65535) throw new Error("too many verts for uint16 indices");

/* ---------- skeleton ---------- */
// segments in mesh space (right side; queries use |x|)
const BONES = {
  torso: [[0, 8.5, 0], [0, 17.2, 0]],
  head:  [[0, 17.2, 0], [0, 20.7, 0]],
  arm:   [[2.25, 16.4, -0.1], [5.55, 9.4, 0.35]],
  leg:   [[1.05, 9.6, 0], [1.1, 0.8, 0.1]],
};

function closestOnSeg(p, [a, b]) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2;
  t = Math.max(0, Math.min(1, t));
  return { pt: [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t], t };
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// gaussian-ish bump: 1 at c, 0 at c±w
const bump = (x, c, w) => Math.max(0, 1 - ((x - c) / w) ** 2);

/* ---------- per-vertex bake ---------- */
// aR = distance to the blended skeleton axis. The shader displaces along
// the vertex NORMAL by aR * gain — normals and aR are continuous across
// bone boundaries, so no seams (radial-from-axis displacement is not).
const aR = new Float32Array(nVerts);
const w1 = new Uint8Array(nVerts * 4);
const w2 = new Uint8Array(nVerts * 4);

for (let i = 0; i < nVerts; i++) {
  const x = outPos[i * 3], y = outPos[i * 3 + 1], z = outPos[i * 3 + 2];
  const ax = Math.abs(x);
  const q = [ax, y, z];

  // soft-blend axis between the two nearest bones (avoids armpit seams)
  const cands = Object.entries(BONES).map(([name, seg]) => {
    const { pt, t } = closestOnSeg(q, seg);
    return { name, pt, t, d: dist(q, pt) };
  }).sort((p, r) => p.d - r.d);
  const [c0, c1] = cands;
  const k0 = 1 / Math.max(c0.d, 0.2) ** 2;
  const k1 = 1 / Math.max(c1.d, 0.2) ** 2;
  const bl = k0 / (k0 + k1);
  const axPt = [
    c0.pt[0] * bl + c1.pt[0] * (1 - bl),
    c0.pt[1] * bl + c1.pt[1] * (1 - bl),
    c0.pt[2] * bl + c1.pt[2] * (1 - bl),
  ];
  aR[i] = dist(q, axPt);

  const bone = c0.name, t = c0.t;

  /* ---- morph weights ---- */
  let muscle = 0, fat = 0, belly = 0, shoulder = 0, hip = 0, bust = 0, waist = 0;

  if (bone === "arm") {
    // continuous along the arm: 0.55 at shoulder joint (matches torso
    // shoulder weight) → 0.9 biceps → 0.55 forearm → 0.05 hand
    muscle = 0.55 + 0.35 * smooth(0.0, 0.12, t)
           - 0.35 * smooth(0.45, 0.60, t)
           - 0.50 * smooth(0.75, 0.90, t);
    muscle = clamp01(muscle);
    fat = 0.25 * smooth(0.4, 0.0, t) + 0.06;
    shoulder = 0.8 * smooth(0.3, 0.05, t);
  } else if (bone === "leg") {
    // thigh: matches torso hip fat (0.55) at the crease, tapers to knee
    fat = 0.55 * smooth(0.5, 0.0, t) + 0.06;
    muscle = 0.4 * smooth(0.55, 0.35, t)
           + (z < 0 ? 0.55 : 0.22) * bump(t, 0.67, 0.22);
    muscle = clamp01(muscle);
    hip = 0.7 * smooth(0.25, 0.0, t);
  } else if (bone === "torso") {
    muscle = 0.1; fat = 0.25;
    fat = Math.max(fat, 0.55 * smooth(11.4, 9.9, y));                       // hip band → matches thigh at crease
    const shoulderW = smooth(15.6, 16.6, y) * smooth(0.4, 1.0, ax);
    muscle = Math.max(muscle, 0.55 * shoulderW);                            // traps/shoulder shelf
    shoulder = 0.9 * shoulderW;
    const pecW = bump(y, 15.2, 1.4) * smooth(0.1, 0.5, z) * smooth(2.4, 1.6, ax) * smooth(0.15, 0.5, ax);
    muscle = Math.max(muscle, 0.8 * pecW);                                  // pecs
    bust = 0.9 * pecW;
    const backW = bump(y, 15.0, 1.8) * smooth(-0.3, -0.8, z);
    muscle = Math.max(muscle, 0.5 * backW);                                 // upper back
    const latW = bump(y, 13.8, 1.5) * smooth(1.1, 1.8, ax);
    muscle = Math.max(muscle, 0.4 * latW);                                  // lats
    const bellyBand = bump(y, 12.1, 2.2) * smooth(-0.1, 0.5, z);
    fat = Math.max(fat, bellyBand);                                         // belly front
    const loveW = bump(y, 11.9, 2.0) * smooth(0.9, 1.7, ax);
    fat = Math.max(fat, 0.65 * loveW);                                      // love handles
    const gluteW = bump(y, 9.7, 1.6) * smooth(-0.2, -0.9, z);
    fat = Math.max(fat, 0.7 * gluteW);                                      // glutes
    hip = Math.max(hip, gluteW, 0.75 * bump(y, 9.9, 1.7));
    belly = bellyBand * smooth(2.0, 1.2, ax);                               // forward push zone
    waist = bump(y, 12.6, 1.8);
  } else { // head
    muscle = 0.25 * smooth(17.9, 17.2, y);                                  // neck only
  }

  // feet stay put
  if (y < 1.3) { muscle = 0; fat = 0; }
  const legW = smooth(10.5, 9.2, y); // 1 below hip, 0 above

  w1[i * 4] = Math.round(clamp01(muscle) * 255);
  w1[i * 4 + 1] = Math.round(clamp01(fat) * 255);
  w1[i * 4 + 2] = Math.round(clamp01(belly) * 255);
  w1[i * 4 + 3] = Math.round(clamp01(legW) * 255);
  w2[i * 4] = Math.round(clamp01(shoulder) * 255);
  w2[i * 4 + 1] = Math.round(clamp01(hip) * 255);
  w2[i * 4 + 2] = Math.round(clamp01(bust) * 255);
  w2[i * 4 + 3] = Math.round(clamp01(waist) * 255);
}

/* ---------- pack binary ---------- */
const pad4 = n => (n + 3) & ~3;
const posBytes = nVerts * 12;
const rBytes = nVerts * 4;
const nrmBytes = pad4(nVerts * 3);
const w1Bytes = nVerts * 4;
const w2Bytes = nVerts * 4;
const idxBytes = pad4(indices.length * 2);
const total = 8 + posBytes + rBytes + nrmBytes + w1Bytes + w2Bytes + idxBytes;

const buf = new ArrayBuffer(total);
const dv = new DataView(buf);
let off = 0;
dv.setUint32(off, nVerts, true); off += 4;
dv.setUint32(off, indices.length, true); off += 4;
new Float32Array(buf, off, nVerts * 3).set(outPos); off += posBytes;
new Float32Array(buf, off, nVerts).set(aR); off += rBytes;
const nrm8 = new Int8Array(buf, off, nVerts * 3);
for (let i = 0; i < nVerts * 3; i++) nrm8[i] = Math.round(Math.max(-1, Math.min(1, outNrm[i])) * 127);
off += nrmBytes;
new Uint8Array(buf, off, nVerts * 4).set(w1); off += w1Bytes;
new Uint8Array(buf, off, nVerts * 4).set(w2); off += w2Bytes;
new Uint16Array(buf, off, indices.length).set(indices); off += idxBytes;

writeFileSync(OUT, Buffer.from(buf));
console.log(`wrote ${OUT} (${(total / 1024).toFixed(0)} KB)`);
