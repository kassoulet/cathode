// Runs every comparison renderer across input/output sizes and reports median frame times.
import ours from "../compare/renderers/ours.js";
import theirs from "../compare/renderers/theirs.js";
import cathode from "../compare/renderers/cathode.js";
import { lite, deluxe } from "../compare/renderers/zmbc.js";
import { cathodeGl, cathodeFast } from "../compare/renderers/cathode-js.js";
import { lottes, geom, easymode, royale } from "../compare/renderers/libretro.js";

const RENDERERS = [ours, theirs, cathodeGl, cathodeFast, cathode, lite, deluxe, lottes, geom, easymode, royale];

const INPUTS = [
  { name: "240p", width: 426, height: 240 },
  { name: "480p", width: 854, height: 480 },
  { name: "720p", width: 1280, height: 720 },
  { name: "1080p", width: 1920, height: 1080 },
  { name: "2160p", width: 3840, height: 2160 },
];
const OUTPUTS = [
  { name: "720p", width: 1280, height: 720 },
  { name: "1080p", width: 1920, height: 1080 },
  { name: "2160p", width: 3840, height: 2160 },
];

const WARMUP = 3;
const RUNS = 3;
const FRAMES_PER_RUN = 5;

const runButton = document.querySelector("#run");
const cancelButton = document.querySelector("#cancel");
const downloadButton = document.querySelector("#download");
const copyButton = document.querySelector("#copy");
const csvDownloadButton = document.querySelector("#csv-download");
const csvCopyButton = document.querySelector("#csv-copy");
const statusEl = document.querySelector("#status");
const barEl = document.querySelector("#bar");
const bodyEl = document.querySelector("#results tbody");
const errorsEl = document.querySelector("#errors");
const jsonEl = document.querySelector("#json");
const stage = document.querySelector("#stage");

const dpr = Math.min(window.devicePixelRatio || 1, 2);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const errorText = (error) => String(error?.message ?? error);
let cancelled = false;
let running = false;

function setStageSize(size) {
  stage.style.width = `${size.width / dpr}px`;
  stage.style.height = `${size.height / dpr}px`;
}

function makeSource(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const bars = ["#ffffff", "#ffff00", "#00ffff", "#00ff00", "#ff00ff", "#ff0000", "#0000ff", "#000000"];
  const barWidth = width / bars.length;
  bars.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(i * barWidth), 0, Math.ceil(barWidth) + 1, height);
  });

  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, "rgba(255,255,255,0.35)");
  shade.addColorStop(0.5, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  const cell = Math.max(2, Math.round(height / 60));
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  for (let y = 0; y < height; y += cell * 2) {
    for (let x = 0; x < width; x += cell * 2) ctx.fillRect(x, y, cell, cell);
  }

  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = Math.max(1, height / 240);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(width, height);
  ctx.moveTo(width, 0); ctx.lineTo(0, height);
  ctx.stroke();

  ctx.fillStyle = "#000";
  ctx.font = `${Math.round(height / 14)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${width}×${height}`, width / 2, height / 2);

  // Several renderers read naturalWidth/naturalHeight; canvases don't have them.
  Object.defineProperties(canvas, {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  return canvas;
}

function environment() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  let gpu = "unavailable";
  if (gl) {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    gpu,
    devicePixelRatio: window.devicePixelRatio || 1,
    renderScale: dpr,
  };
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  return {
    samples: samples.length,
    medianMs: median,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    meanMs: mean,
    stddevMs: Math.sqrt(variance),
    fps: median > 0 ? 1000 / median : null,
  };
}

function frameTime(instance, gl, image, def) {
  const started = performance.now();
  instance.draw(image, def, started);
  gl?.finish();
  return performance.now() - started;
}

function addRow(result) {
  const tr = document.createElement("tr");
  const cells = [
    result.label,
    result.input,
    result.output,
    `${result.canvasWidth}×${result.canvasHeight}`,
    result.medianMs.toFixed(2),
    result.minMs.toFixed(2),
    result.meanMs.toFixed(2),
    result.stddevMs.toFixed(2),
    result.fps === null ? "—" : result.fps.toFixed(1),
    result.timing,
  ];
  for (const [i, value] of cells.entries()) {
    const td = document.createElement("td");
    td.textContent = value;
    if (i === 0) td.title = result.renderer;
    tr.append(td);
  }
  bodyEl.append(tr);
}

function setStatus(text) { statusEl.textContent = text; }
function setProgress(done, total) { barEl.style.width = `${(done / total) * 100}%`; }

async function run() {
  if (running) return;
  running = true;
  cancelled = false;
  runButton.disabled = true;
  cancelButton.disabled = false;
  downloadButton.disabled = true;
  copyButton.disabled = true;
  csvDownloadButton.disabled = true;
  csvCopyButton.disabled = true;
  bodyEl.replaceChildren();
  errorsEl.textContent = "";
  jsonEl.value = "";
  setProgress(0, 1);

  const startedAt = performance.now();
  const results = [];
  const errors = [];
  const sources = INPUTS.map((input) => ({ ...input, image: makeSource(input.width, input.height) }));
  const total = RENDERERS.length * OUTPUTS.length * INPUTS.length;
  let done = 0;

  for (const renderer of RENDERERS) {
    if (cancelled) break;
    setStatus(`loading ${renderer.label}…`);
    const canvas = document.createElement("canvas");
    stage.replaceChildren(canvas);
    let instance = null;
    let gl = null;
    try {
      setStageSize(OUTPUTS[0]);
      instance = await renderer.create({
        canvas,
        top: document.createElement("div"),
        root: document.createElement("div"),
        meta() {},
      });
      gl = instance.gl ?? canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    } catch (error) {
      const message = errorText(error);
      errors.push({ renderer: renderer.id, label: renderer.label, error: message });
      done += OUTPUTS.length * INPUTS.length;
      setProgress(done, total);
      await tick();
      continue;
    }

    try {
      for (const output of OUTPUTS) {
        if (cancelled) break;
        setStageSize(output);
        for (const input of sources) {
          if (cancelled) break;
          done += 1;
          setStatus(`${renderer.label} · ${input.name} → ${output.name} · ${done}/${total}`);
          const def = { name: input.name, mode: "pixel", lines: input.height };
          try {
            instance.useImage?.(def);
            // Yield between frames so slow (software) GPUs don't freeze the page and Cancel works.
            for (let i = 0; i < WARMUP && !cancelled; i++) { frameTime(instance, gl, input.image, def); await tick(); }
            const samples = [];
            for (let r = 0; r < RUNS && !cancelled; r++) {
              for (let f = 0; f < FRAMES_PER_RUN && !cancelled; f++) {
                samples.push(frameTime(instance, gl, input.image, def));
                await tick();
              }
            }
            if (cancelled) break;
            const result = {
              renderer: renderer.id,
              label: renderer.label,
              input: input.name,
              inputWidth: input.width,
              inputHeight: input.height,
              output: output.name,
              outputWidth: output.width,
              outputHeight: output.height,
              canvasWidth: canvas.width,
              canvasHeight: canvas.height,
              timing: gl ? "gpu (gl.finish)" : "cpu (2d)",
              warmupFrames: WARMUP,
              runs: RUNS,
              framesPerRun: FRAMES_PER_RUN,
              ...stats(samples),
            };
            results.push(result);
            addRow(result);
          } catch (error) {
            errors.push({
              renderer: renderer.id, label: renderer.label,
              input: input.name, output: output.name, error: errorText(error),
            });
          }
          setProgress(done, total);
          await tick();
        }
      }
    } finally {
      try { instance?.dispose?.(); } catch {}
      stage.replaceChildren();
    }
  }

  const report = {
    environment: environment(),
    methodology: {
      inputs: INPUTS,
      outputs: OUTPUTS,
      warmupFrames: WARMUP,
      runs: RUNS,
      framesPerRun: FRAMES_PER_RUN,
      frameTime: "draw() + gl.finish(); 2D panes report CPU draw time",
      cancelled,
      durationMs: performance.now() - startedAt,
    },
    results,
    errors,
  };
  jsonEl.value = JSON.stringify(report, null, 2);
  window.benchmark = report;
  errorsEl.textContent = errors.map((e) =>
    `${e.label}${e.input ? ` ${e.input}→${e.output}` : ""}: ${e.error}`).join("\n");
  runButton.disabled = false;
  cancelButton.disabled = true;
  downloadButton.disabled = false;
  copyButton.disabled = false;
  csvDownloadButton.disabled = false;
  csvCopyButton.disabled = false;
  setProgress(1, 1);
  setStatus(`${cancelled ? "cancelled" : "done"} · ${results.length} rows · ${((performance.now() - startedAt) / 1000).toFixed(1)} s`);
  running = false;
}

runButton.addEventListener("click", () => {
  run().catch((error) => {
    setStatus(errorText(error));
    runButton.disabled = false;
    cancelButton.disabled = true;
    running = false;
  });
});
cancelButton.addEventListener("click", () => { cancelled = true; setStatus("cancelling…"); });

function toCsv(results) {
  const columns = ["renderer", "label", "input", "inputWidth", "inputHeight",
    "output", "outputWidth", "outputHeight", "canvasWidth", "canvasHeight", "timing",
    "samples", "medianMs", "minMs", "maxMs", "meanMs", "stddevMs", "fps"];
  const cell = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(","), ...results.map((row) => columns.map((c) => cell(row[c])).join(","))].join("\n");
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

downloadButton.addEventListener("click", () =>
  download(`crt-benchmark-${Date.now()}.json`, jsonEl.value, "application/json"));
copyButton.addEventListener("click", () => navigator.clipboard.writeText(jsonEl.value));
csvDownloadButton.addEventListener("click", () =>
  download(`crt-benchmark-${Date.now()}.csv`, toCsv(window.benchmark.results), "text/csv"));
csvCopyButton.addEventListener("click", () => navigator.clipboard.writeText(toCsv(window.benchmark.results)));
