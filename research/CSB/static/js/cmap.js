// Match the custom w-plane plots in transform/transform.py.
const gridLines = 16;
const segments = 160;
const limit = 10;

export function createWPlaneMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  let gamma = 0;

  function draw() {
    const size = canvas.clientWidth;
    if (!ctx || !size) return;
    const pixels = Math.round(size * (window.devicePixelRatio || 1));
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = canvas.height = pixels;
    }
    ctx.setTransform(pixels / size, 0, 0, pixels / size, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const left = 16;
    const top = 5;
    const side = size - left - top;
    const centerX = left + side / 2;
    const centerY = top + side / 2;
    const scale = side / (2 * limit);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, side, side);
    ctx.clip();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = '#afc4ce';
    ctx.setLineDash([1, 2]);
    ctx.beginPath();
    for (let tick = -limit; tick <= limit; tick += 2.5) {
      ctx.moveTo(centerX + tick * scale, top);
      ctx.lineTo(centerX + tick * scale, top + side);
      ctx.moveTo(left, centerY - tick * scale);
      ctx.lineTo(left + side, centerY - tick * scale);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // w = exp((a + ib)z). At zero rotation this is exp(z).
    const a = 1 / Math.sqrt(1 + Math.abs(gamma));
    const b = a * Math.sign(gamma) * Math.sqrt(Math.abs(gamma));
    ctx.lineWidth = 0.85;
    function drawFamily(fixedReal) {
      for (let i = 0; i < gridLines; i++) {
        const fraction = i / (gridLines - 1);
        const fixed = (2 * fraction - 1) * Math.PI;
        const lightness = 70 - 38 * fraction;
        ctx.strokeStyle = fixedReal ? `hsl(207 58% ${lightness}%)` : `hsl(8 58% ${lightness}%)`;
        ctx.beginPath();
        for (let j = 0; j <= segments; j++) {
          const varying = (2 * j / segments - 1) * Math.PI;
          const x = fixedReal ? fixed : varying;
          const y = fixedReal ? varying : fixed;
          const radius = Math.exp(a * x - b * y);
          const angle = b * x + a * y;
          const px = centerX + scale * radius * Math.cos(angle);
          const py = centerY - scale * radius * Math.sin(angle);
          if (j === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    drawFamily(true);
    drawFamily(false);
    ctx.restore();

    ctx.strokeStyle = '#b7cad3';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(left, top, side, side);
    ctx.fillStyle = '#526976';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Re(w)', centerX, size - 4);
    ctx.save();
    ctx.translate(10, centerY);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Im(w)', 0, 0);
    ctx.restore();
  }

  new ResizeObserver(draw).observe(canvas);
  function setGamma(value) {
    gamma = value;
    canvas.setAttribute('aria-description', gamma === 0
      ? 'Concentric circles and radial spokes at zero rotation.'
      : `Two families of logarithmic spirals at rotation ${gamma.toFixed(2)}.`);
    draw();
  }
  return { setGamma };
}
