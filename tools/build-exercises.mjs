/* ============================================================
   build-exercises.mjs
   Builds data/exercises.json (slim, English-only) from the
   hasaneyldrm/exercises-dataset repo.

   Usage:
     git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset.git
     node tools/build-exercises.mjs path/to/exercises-dataset

   Output record (short keys keep the file small):
     i  id            "0025"
     n  name          "barbell bench press"
     b  group         chest|back|shoulders|arms|legs|core|cardio
     t  target        "pectorals"
     e  equipment     "barbell"
     g  media base    "0025-EIeI8Vf"  (→ videos/<g>.gif, images/<g>.jpg)
     s  steps         ["Lie flat...", ...]
     m  secondary     ["triceps", ...]
   ============================================================ */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
if (!src) {
  console.error("Usage: node tools/build-exercises.mjs <path-to-exercises-dataset>");
  process.exit(1);
}

// dataset body_part → app muscle group
const GROUPS = {
  "chest": "chest",
  "back": "back",
  "shoulders": "shoulders",
  "neck": "shoulders",
  "upper arms": "arms",
  "lower arms": "arms",
  "upper legs": "legs",
  "lower legs": "legs",
  "waist": "core",
  "cardio": "cardio",
};

const raw = JSON.parse(readFileSync(join(src, "data", "exercises.json"), "utf8"));

const slim = raw.map(e => ({
  i: e.id,
  n: e.name,
  b: GROUPS[e.body_part] || "core",
  t: e.target,
  e: e.equipment,
  g: e.gif_url.replace(/^videos\//, "").replace(/\.gif$/, ""),
  s: (e.instruction_steps && e.instruction_steps.en) || [],
  m: e.secondary_muscles || [],
}));

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "exercises.json");
writeFileSync(out, JSON.stringify(slim));
const kb = Math.round(JSON.stringify(slim).length / 1024);
console.log(`Wrote ${slim.length} exercises (${kb} KB) → ${out}`);
