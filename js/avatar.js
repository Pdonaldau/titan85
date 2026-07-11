/* ============================================================
   Titan85 — procedural physique "skin"
   Draws a stylized 3D-animated character entirely in SVG.
   Its build morphs from three 0..1 parameters:
     muscle  — shoulders / arms / chest mass
     lean    — waist taper + visible ab definition
     mass    — overall body size (neck, torso, legs)
   No image files: fully offline, scales to any size.
   ============================================================ */

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function buildAvatar(params, uid) {
  const muscle = clamp01(params.muscle);
  const lean   = clamp01(params.lean);
  const mass   = clamp01(params.mass);

  const cx = 120;

  // ---- driven dimensions ----
  const headR      = 25 + mass * 3;
  const headCy     = 50;
  const neckHalf   = 8 + muscle * 3 + mass * 1.5;
  const shoulderY  = 88;
  const shoulderH  = 38 + muscle * 28 + mass * 4;        // half-span of shoulders
  const chestY     = 126;
  const waistY     = 180;
  const waistH     = Math.max(18, 30 + mass * 16 - lean * 15 + muscle * 3);
  const hipY       = 200;
  const hipH       = 28 + mass * 10 + muscle * 2;

  // arms (thick round-capped limbs)
  const armW    = 16 + muscle * 20 + mass * 3;
  const foreW   = 12 + muscle * 10 + mass * 2;
  const shX     = cx + shoulderH * 0.84;                 // shoulder joint (right side)
  const shY     = shoulderY + 4;
  const elbowX  = cx + shoulderH + 6 + muscle * 5;
  const elbowY  = 152;
  const wristX  = cx + shoulderH - 1 + mass * 2;
  const wristY  = 200;

  // legs
  const thighW = 24 + mass * 12 + muscle * 8;
  const shinW  = 15 + mass * 6 + muscle * 3;
  const legX   = hipH * 0.5 + 5;
  const kneeX  = legX * 0.92;
  const kneeY  = 264;
  const ankleX = legX * 0.85;
  const ankleY = 322;

  // ---- helpers ----
  // a rounded cylindrical limb with cheap 3D shading
  const limb = (x1, y1, x2, y2, w) => `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="url(#${uid}-skinD)" stroke-width="${w}" stroke-linecap="round"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="url(#${uid}-skin)" stroke-width="${w * 0.8}" stroke-linecap="round"/>
    <line x1="${x1 - w * 0.14}" y1="${y1}" x2="${x2 - w * 0.11}" y2="${y2}" stroke="#ffffff" stroke-opacity="0.16" stroke-width="${w * 0.26}" stroke-linecap="round"/>`;

  const mirror = (s) => s;   // (right side is drawn, left is a scaled mirror in markup)

  // torso silhouette (symmetric, neck notch at top)
  const torso = `M ${cx - shoulderH} ${shoulderY}
    C ${cx - shoulderH - 3} ${chestY - 8}, ${cx - waistH - 7} ${waistY - 26}, ${cx - waistH} ${waistY}
    C ${cx - waistH + 2} ${hipY - 6}, ${cx - hipH} ${hipY - 5}, ${cx - hipH} ${hipY}
    L ${cx + hipH} ${hipY}
    C ${cx + hipH} ${hipY - 5}, ${cx + waistH - 2} ${hipY - 6}, ${cx + waistH} ${waistY}
    C ${cx + waistH + 7} ${waistY - 26}, ${cx + shoulderH + 3} ${chestY - 8}, ${cx + shoulderH} ${shoulderY}
    C ${cx + shoulderH - 6} ${shoulderY - 9}, ${cx + neckHalf + 5} ${shoulderY - 5}, ${cx + neckHalf} ${shoulderY - 11}
    L ${cx - neckHalf} ${shoulderY - 11}
    C ${cx - neckHalf - 5} ${shoulderY - 5}, ${cx - shoulderH + 6} ${shoulderY - 9}, ${cx - shoulderH} ${shoulderY} Z`;

  // pecs
  const pecX = shoulderH * 0.42;
  const pecRx = 15 + muscle * 8;
  const pecRy = 11 + muscle * 4;

  // abs — appear with leanness
  const absOp = clamp01((lean - 0.25) * 1.4) * 0.55;
  let abs = "";
  if (absOp > 0.02) {
    const top = chestY + 14, bottom = waistY - 8;
    abs += `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${bottom}" stroke="url(#${uid}-skinD)" stroke-width="2.4" stroke-linecap="round" opacity="${absOp}"/>`;
    for (let i = 0; i < 3; i++) {
      const y = lerp(top + 10, bottom - 4, i / 3);
      abs += `<line x1="${cx - 15}" y1="${y}" x2="${cx - 3}" y2="${y}" stroke="url(#${uid}-skinD)" stroke-width="2.2" stroke-linecap="round" opacity="${absOp}"/>
              <line x1="${cx + 3}" y1="${y}" x2="${cx + 15}" y2="${y}" stroke="url(#${uid}-skinD)" stroke-width="2.2" stroke-linecap="round" opacity="${absOp}"/>`;
    }
  }

  // shorts over hips / upper thighs
  const shorts = `
    <path d="M ${cx - hipH - 2} ${hipY - 14}
      L ${cx + hipH + 2} ${hipY - 14}
      L ${cx + hipH - 2} ${hipY + 26}
      L ${cx + 5} ${hipY + 20}
      L ${cx - 5} ${hipY + 20}
      L ${cx - hipH + 2} ${hipY + 26} Z"
      fill="url(#${uid}-shorts)" stroke="#0b3b26" stroke-width="1.5"/>`;

  return `
  <svg viewBox="0 0 240 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Physique character">
    <defs>
      <linearGradient id="${uid}-skin" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f6c79c"/>
        <stop offset="1" stop-color="#dd935a"/>
      </linearGradient>
      <linearGradient id="${uid}-skinD" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#cf8654"/>
        <stop offset="1" stop-color="#a5623a"/>
      </linearGradient>
      <linearGradient id="${uid}-shorts" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#22c55e"/>
        <stop offset="1" stop-color="#065f46"/>
      </linearGradient>
      <radialGradient id="${uid}-floor" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#000000" stop-opacity="0.45"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <!-- floor shadow -->
    <ellipse cx="${cx}" cy="332" rx="${52 + mass * 14}" ry="10" fill="url(#${uid}-floor)"/>

    <!-- arms (behind torso) -->
    <g>${limb(shX, shY, elbowX, elbowY, armW)}${limb(elbowX, elbowY, wristX, wristY, foreW)}</g>
    <g transform="translate(${cx * 2},0) scale(-1,1)">${limb(shX, shY, elbowX, elbowY, armW)}${limb(elbowX, elbowY, wristX, wristY, foreW)}</g>

    <!-- legs (behind torso) -->
    <g>
      ${limb(cx + legX, hipY + 6, cx + kneeX, kneeY, thighW)}
      ${limb(cx + kneeX, kneeY, cx + ankleX, ankleY, shinW)}
      ${limb(cx - legX, hipY + 6, cx - kneeX, kneeY, thighW)}
      ${limb(cx - kneeX, kneeY, cx - ankleX, ankleY, shinW)}
      <ellipse cx="${cx - ankleX}" cy="${ankleY + 3}" rx="${shinW * 0.6}" ry="6" fill="url(#${uid}-skinD)"/>
      <ellipse cx="${cx + ankleX}" cy="${ankleY + 3}" rx="${shinW * 0.6}" ry="6" fill="url(#${uid}-skinD)"/>
    </g>

    <!-- neck -->
    <rect x="${cx - neckHalf}" y="${headCy + headR - 8}" width="${neckHalf * 2}" height="24" rx="6" fill="url(#${uid}-skinD)"/>

    <!-- torso -->
    <path d="${torso}" fill="url(#${uid}-skin)" stroke="url(#${uid}-skinD)" stroke-width="1.5"/>
    <ellipse cx="${cx - pecX}" cy="${chestY}" rx="${pecRx}" ry="${pecRy}" fill="url(#${uid}-skinD)" opacity="0.35"/>
    <ellipse cx="${cx + pecX}" cy="${chestY}" rx="${pecRx}" ry="${pecRy}" fill="url(#${uid}-skinD)" opacity="0.35"/>
    <path d="M ${cx - shoulderH + 6} ${shoulderY} q 10 -6 ${shoulderH - 14} 0" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="4" stroke-linecap="round"/>
    ${abs}

    ${shorts}

    <!-- head -->
    <circle cx="${cx}" cy="${headCy}" r="${headR}" fill="url(#${uid}-skin)" stroke="url(#${uid}-skinD)" stroke-width="1.5"/>
    <path d="M ${cx - headR} ${headCy - 4}
             a ${headR} ${headR} 0 0 1 ${headR * 2} 0
             q -${headR} -14 -${headR * 2} 0 Z" fill="#3a2c22"/>
    <ellipse cx="${cx - 8}" cy="${headCy + 1}" rx="2.4" ry="3.4" fill="#2a2015"/>
    <ellipse cx="${cx + 8}" cy="${headCy + 1}" rx="2.4" ry="3.4" fill="#2a2015"/>
    <path d="M ${cx - 7} ${headCy + 11} q 7 5 14 0" fill="none" stroke="#a5623a" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

/* ---- derive skin parameters from stats ---- */
function buildFromMeasures(weight, arms, waist) {
  return {
    muscle: arms != null ? clamp01((arms - 28) / 18) : null,
    lean:   waist != null ? clamp01((96 - waist) / 20) : null,
    mass:   weight != null ? clamp01((weight - 65) / 40) : null,
  };
}
