import { createCRT, MASKS, PRESET_NAMES } from "../src/index.js";

const canvas = document.querySelector("#crt");
const status = document.querySelector("#status");
const presetSelect = document.querySelector("#preset");
const maskSelect = document.querySelector("#mask");
const analogSelect = document.querySelector("#analog");
const reflectionInput = document.querySelector("#reflection");
const sliders = {
  curve: document.querySelector("#curve"),
  scanlines: document.querySelector("#scanlines"),
  mask: document.querySelector("#maskIntensity"),
  vignette: document.querySelector("#vignette"),
  noise: document.querySelector("#noise"),
  phosphorDecay: document.querySelector("#decay"),
};

// ---- procedural source ----------------------------------------------------
const source = document.createElement("canvas");
source.width = 640;
source.height = 480;
const ctx = source.getContext("2d");

const BARS = ["#fff", "#ff0", "#0ff", "#0f0", "#f0f", "#f00", "#00f"];

function drawSource(t) {
  const { width: w, height: h } = source;

  // Colour bars
  const barW = w / BARS.length;
  for (let i = 0; i < BARS.length; i += 1) {
    ctx.fillStyle = BARS[i];
    ctx.fillRect(i * barW, 0, Math.ceil(barW), h * 0.55);
  }

  // Greyscale steps
  for (let i = 0; i < 10; i += 1) {
    const v = Math.round((i / 9) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect((i * w) / 10, h * 0.55, w / 10 + 1, h * 0.16);
  }

  // Checker patch and fine lines (good for judging masks and bandwidth)
  const cell = 8;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? "#fff" : "#000";
      ctx.fillRect(360 + x * cell, 300 + y * cell, cell, cell);
    }
  }
  ctx.fillStyle = "#fff";
  for (let x = 0; x < 120; x += 4) ctx.fillRect(360 + x, 380, 2, 24);

  // Moving diagonal sweep
  const phase = (t * 90) % (w + h);
  ctx.save();
  ctx.strokeStyle = "#8cf";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(phase - h, 0);
  ctx.lineTo(phase, h);
  ctx.stroke();
  ctx.restore();

  // Bouncing disc
  const cx = w / 2 + Math.cos(t * 1.3) * (w / 3);
  const cy = h * 0.28 + Math.sin(t * 1.9) * (h / 6);
  const gradient = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34);
  gradient.addColorStop(0, "#fff");
  gradient.addColorStop(1, "#f80");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.fill();

  // Caption
  ctx.fillStyle = "#000";
  ctx.globalAlpha = 0.55;
  ctx.fillRect(10, 10, 250, 30);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "16px ui-monospace, monospace";
  ctx.fillText(`crt-canvas  ${t.toFixed(2)}s`, 18, 30);
}

// ---- controls -------------------------------------------------------------
for (const name of PRESET_NAMES) {
  presetSelect.add(new Option(name, name));
}
for (const name of MASKS) {
  maskSelect.add(new Option(name, name));
}
presetSelect.value = "Default";
maskSelect.value = "Default";

const crt = await createCRT(canvas, { preset: "Default", lines: 270 });
status.textContent = `CRT ${crt.width}×${crt.height}\nCTRL ${crt.nativeWidth}×${crt.nativeHeight}`;

let video = null;
let sourceElement = source;

presetSelect.addEventListener("change", async () => {
  await crt.setPreset(presetSelect.value);
  syncControls();
  updateStatus();
});

maskSelect.addEventListener("change", () => {
  crt.setMask(maskSelect.value);
  updateStatus();
});

analogSelect.addEventListener("change", () => {
  crt.setAnalog(analogSelect.value);
});

for (const [key, input] of Object.entries(sliders)) {
  input.addEventListener("input", () => {
    crt.setOptions({ [key]: Number(input.value) / 100 });
  });
}

reflectionInput.addEventListener("change", () => {
  crt.setReflection(reflectionInput.checked);
});

document.querySelector("#snapshot").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = `crt-canvas-${Date.now()}.png`;
  link.href = crt.snapshot();
  link.click();
});

document.querySelector("#reset").addEventListener("click", async () => {
  await crt.setPreset(presetSelect.value);
  syncControls();
});

document.querySelector("#file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!video) {
    video = document.createElement("video");
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
  }
  video.src = URL.createObjectURL(file);
  await video.play();
  sourceElement = video;
  updateStatus();
});

function syncControls() {
  const settings = crt.settings;
  presetSelect.value = PRESET_NAMES.includes(presetSelect.value)
    ? presetSelect.value
    : presetSelect.value;
  maskSelect.value = settings.maskBitmap;
  analogSelect.value = settings.analog;
  for (const [key, input] of Object.entries(sliders)) {
    input.value = Math.round((settings[key] ?? 0) * 100);
  }
}

function updateStatus() {
  const s = crt.settings;
  status.textContent =
    `CRT ${crt.width}×${crt.height}  CTL ${crt.nativeWidth}×${crt.nativeHeight}` +
    `\nmask ${s.maskBitmap}  signal ${s.analog}`;
}

// ---- render loop ----------------------------------------------------------
let statusReady = false;
function frame(now) {
  const t = now / 1000;
  if (sourceElement === source) drawSource(t);
  crt.render(sourceElement, t);
  if (!statusReady) {
    statusReady = true;
    updateStatus();
  }
  requestAnimationFrame(frame);
}

syncControls();
requestAnimationFrame(frame);
