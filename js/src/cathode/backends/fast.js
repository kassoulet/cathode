// `fast` backend: Canvas2D only. Scanlines, vignette, chromatic aberration, rounded bezel,
// hum bar. No curvature/mask/persistence/analog — use `gl` for those.
const sizeOf = (s) => [s.videoWidth ?? s.naturalWidth ?? s.displayWidth ?? s.width,
  s.videoHeight ?? s.naturalHeight ?? s.displayHeight ?? s.height];

export function createFast(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("cathode: 2D context unavailable");
  const tmp = document.createElement("canvas");
  const tctx = tmp.getContext("2d");
  let s;

  function fit() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round((rect.width || canvas.width) * dpr));
    const h = Math.max(2, Math.round((rect.height || canvas.height) * dpr));
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }

  return {
    name: "fast",
    apply(settings) { s = settings; },
    render(source, time) {
      fit();
      const W = canvas.width, H = canvas.height;
      const [sw, sh] = sizeOf(source);
      const aspect = s.geometry.aspectRatio ?? sw / sh;
      const w = Math.min(W, H * aspect), h = w / aspect;
      const x = (W - w) / 2, y = (H - h) / 2;

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, s.geometry.cornerRadius * Math.min(w, h));
      ctx.clip();
      ctx.imageSmoothingEnabled = w < sw * 2; // crisp pixels when upscaling a lot

      const shift = s.signal.chromaticAberration * w;
      if (shift > 0.05) { // three channel-isolated copies, offset, added together
        tmp.width = W; tmp.height = H;
        ctx.globalCompositeOperation = "lighter";
        [["#f00", -shift], ["#0f0", 0], ["#00f", shift]].forEach(([color, dx]) => {
          tctx.globalCompositeOperation = "source-over";
          tctx.clearRect(0, 0, W, H);
          tctx.drawImage(source, x + dx, y, w, h);
          tctx.globalCompositeOperation = "multiply";
          tctx.fillStyle = color;
          tctx.fillRect(0, 0, W, H);
          ctx.drawImage(tmp, 0, 0);
        });
        ctx.globalCompositeOperation = "source-over";
      } else {
        ctx.drawImage(source, x, y, w, h);
      }

      const lines = s.beam.scanlineCount || Math.min(480, Math.max(120, sh));
      const period = h / lines;
      if (s.beam.scanlineIntensity > 0 && period >= 2) {
        const row = document.createElement("canvas");
        row.width = 1; row.height = Math.max(2, Math.round(period));
        const rctx = row.getContext("2d");
        rctx.fillStyle = `rgba(0,0,0,${s.beam.scanlineIntensity})`;
        rctx.fillRect(0, row.height / 2, 1, row.height / 2);
        ctx.fillStyle = ctx.createPattern(row, "repeat");
        ctx.translate(x, y);
        ctx.fillRect(0, 0, w, h);
        ctx.translate(-x, -y);
      }

      const v = s.geometry.vignette * 0.6;
      if (v > 0) {
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(w, h) * 0.35, W / 2, H / 2, Math.hypot(w, h) / 2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${Math.min(1, v)})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
      }

      if (s.signal.humBar > 0) {
        const by = y + ((time * 0.1) % 1) * h;
        const g = ctx.createLinearGradient(0, by - h * 0.1, 0, by + h * 0.1);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, `rgba(255,255,255,${s.signal.humBar * 0.25})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, by - h * 0.1, w, h * 0.2);
      }
      ctx.restore();
    },
    dispose() {},
  };
}
