/* Lightweight offline canvas chart — no external libraries. */
function drawWeightChart(history) {
  const canvas = document.getElementById("weightChart");
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = 200;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { l: 38, r: 14, t: 16, b: 24 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;

  if (!history || history.length < 2) {
    ctx.fillStyle = "#64748b";
    ctx.font = "14px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      history && history.length === 1 ? "Log one more weigh-in to see a trend" : "No weight logged yet",
      cssW / 2, cssH / 2
    );
    return;
  }

  const weights = history.map(h => h.weight);
  let min = Math.min(...weights);
  let max = Math.max(...weights);
  const span = max - min || 1;
  min -= span * 0.15;
  max += span * 0.15;
  const range = max - min || 1;

  const x = i => pad.l + (i * w) / (history.length - 1);
  const y = v => pad.t + h - ((v - min) / range) * h;

  // gridlines + y labels
  ctx.strokeStyle = "#1e293b";
  ctx.fillStyle = "#64748b";
  ctx.font = "10px -apple-system, sans-serif";
  ctx.textAlign = "right";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const val = min + (range * g) / 3;
    const gy = y(val);
    ctx.beginPath();
    ctx.moveTo(pad.l, gy);
    ctx.lineTo(cssW - pad.r, gy);
    ctx.stroke();
    ctx.fillText(val.toFixed(1), pad.l - 6, gy + 3);
  }

  // area fill
  ctx.beginPath();
  ctx.moveTo(x(0), y(weights[0]));
  weights.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(weights.length - 1), pad.t + h);
  ctx.lineTo(x(0), pad.t + h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  grad.addColorStop(0, "rgba(34,197,94,0.28)");
  grad.addColorStop(1, "rgba(34,197,94,0)");
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  weights.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // points
  ctx.fillStyle = "#22c55e";
  weights.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(v), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
}
