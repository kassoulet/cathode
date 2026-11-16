// Side-by-side test bench: crt-canvas (this repo) vs crt-shader (npm).
import { createCRT, MASKS, PRESET_NAMES } from "../src/index.js";
import { createRuntime, prepareInput, resolveSettings, PRESETS } from "crt-shader";
import { controlGroups } from "crt-shader/presets";

const $ = (selector) => document.querySelector(selector);
const errorBox = $("#error");
const showError = (error) => {
  console.error(error);
  errorBox.textContent = String(error?.message ?? error);
};

// ---- example images ------------------------------------------------------
// `mode` is crt-shader's input mode (pixel = native pixels, photo = downsample),
// `lines` is the scanline count handed to crt-canvas.
const IMAGES = [
  { name: "SMPTE bars", url: "images/bars.png", mode: "pixel", lines: 240 },
  { name: "Pixel-art scene", url: "images/sprites.png", mode: "pixel", lines: 224 },
  { name: "C64 text", url: "images/terminal.png", mode: "pixel", lines: 200 },
  { name: "Landscape", url: "images/landscape.png", mode: "photo", lines: 360 },
  { name: "Gradients", url: "images/gradient.png", mode: "photo", lines: 360 },
];

let current = null; // { image, def, id }
let nextId = 0;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`cannot load ${url}`));
    image.src = url;
  });
}

// ---- generic slider rows -------------------------------------------------
function decimals(step) {
  return step >= 1 ? 0 : (String(step).split(".")[1] ?? "").length;
}

/** Build a group of sliders; returns a function that re-reads all values. */
function addGroup(parent, title, entries, open = false) {
  const details = document.createElement("details");
  details.open = open;
  details.innerHTML = `<summary>${title}</summary>`;
  const syncers = [];
  for (const { label, min, max, step, get, set } of entries) {
    const row = document.createElement("div");
    row.className = "ctl";
    const name = document.createElement("label");
    name.textContent = label;
    name.title = label;
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min, max, step });
    const out = document.createElement("output");
    const show = () => {
      input.value = get();
      out.textContent = Number(get()).toFixed(decimals(step));
    };
    input.addEventListener("input", () => {
      set(Number(input.value));
      out.textContent = Number(input.value).toFixed(decimals(step));
    });
    row.append(name, input, out);
    details.append(row);
    syncers.push(show);
  }
  parent.append(details);
  return () => syncers.forEach((fn) => fn());
}

function select(options, value, onChange) {
  const el = document.createElement("select");
  for (const option of options) {
    const [val, text] = Array.isArray(option) ? option : [option, option];
    el.add(new Option(text, val));
  }
  el.value = value;
  el.addEventListener("change", () => onChange(el.value));
  return el;
}

function button(text, onClick) {
  const el = document.createElement("button");
  el.className = "btn";
  el.textContent = text;
  el.addEventListener("click", onClick);
  return el;
}

function download(href, name) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
}

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

// ---- crt-canvas (ours) ---------------------------------------------------
const OURS = [
  ["Signal (needs PAL/NTSC)", [
    ["jailbars"], ["noise"], ["sharpening"], ["lumaBlur"], ["chromaBlur"],
    ["crosstalk"], ["phase", 0, 45, 0.5], ["hannover"], ["rainbowing"], ["drift"],
  ]],
  ["Geometry & beam", [
    ["curve"], ["rotation", -100, 100, 1], ["bleed"], ["convergence"], ["hWave"],
    ["expansion", 0, 2], ["scanlines"],
  ]],
  ["Phosphor & glass", [
    ["mask"], ["phosphorDecay"], ["vignette"], ["adjacent"], ["halation"],
    ["ambient"], ["reflections"], ["overscan"],
  ]],
  ["Picture", [
    ["brightness"], ["contrast"], ["saturation"], ["tint", -1, 1],
  ]],
];

async function setupOurs() {
  const canvas = $("#ours-canvas");
  const crt = await createCRT(canvas, { preset: "Default", lines: 270 });
  let snapshotName = null;
  let preset = "Default";
  const syncers = [];

  const top = $("#ours-top");
  const presetSelect = select(PRESET_NAMES, preset, async (name) => {
    preset = name;
    await crt.setPreset(name);
    syncAll();
  });
  const maskSelect = select(MASKS, crt.settings.maskBitmap, (name) => crt.setMask(name));
  const analogSelect = select(
    [["off", "RGB (clean)"], ["pal", "PAL"], ["ntsc", "NTSC"]],
    crt.settings.analog,
    (mode) => crt.setAnalog(mode),
  );
  const reflection = document.createElement("label");
  reflection.innerHTML = `<input type="checkbox" checked> glass reflection`;
  reflection.firstChild.addEventListener("change", (e) => crt.setReflection(e.target.checked));
  top.append(
    presetSelect, maskSelect, analogSelect, reflection,
    button("Reset", async () => { await crt.setPreset(preset); syncAll(); }),
    button("Save PNG", () => { snapshotName = `crt-canvas-${Date.now()}.png`; }),
    button("Copy settings", () => navigator.clipboard.writeText(JSON.stringify(crt.settings, null, 2))),
  );

  const root = $("#ours-controls");
  syncers.push(addGroup(root, "Scanlines", [{
    label: "lines", min: 60, max: 1080, step: 1,
    get: () => crt.settings.lines, set: (v) => crt.setOptions({ lines: v }),
  }], true));
  for (const [title, keys] of OURS) {
    syncers.push(addGroup(root, title, keys.map(([key, min = 0, max = 1, step = 0.01]) => ({
      label: key, min, max, step,
      get: () => crt.settings[key], set: (v) => crt.setOptions({ [key]: v }),
    })), title === "Geometry & beam"));
  }
  syncers.push(addGroup(root, "Colour fringing (x, y)", ["bleedRed", "bleedGreen", "bleedBlue"].flatMap((key) =>
    [0, 1].map((i) => ({
      label: `${key} ${i ? "y" : "x"}`, min: -1, max: 1, step: 0.01,
      get: () => crt.settings[key][i],
      set: (v) => {
        const pair = [...crt.settings[key]];
        pair[i] = v;
        crt.setOptions({ [key]: pair });
      },
    })))));

  function syncAll() {
    maskSelect.value = crt.settings.maskBitmap;
    analogSelect.value = crt.settings.analog;
    syncers.forEach((fn) => fn());
  }
  syncAll();

  let frames = 0;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!current) return;
    try {
      crt.render(current.image, now / 1000);
      if (snapshotName) {
        download(canvas.toDataURL("image/png"), snapshotName);
        snapshotName = null;
      }
    } catch (error) {
      showError(error);
      return;
    }
    frames += 1;
    if (now - last >= 500) {
      $("#ours-meta").textContent =
        `${crt.width}×${crt.height} CRT · ${crt.nativeWidth}×${crt.nativeHeight} source · ` +
        `${canvas.width}×${canvas.height} out · ${Math.round((frames * 1000) / (now - last))} fps`;
      frames = 0;
      last = now;
    }
  }
  requestAnimationFrame(frame);

  return {
    useImage(def) {
      crt.setOptions({ lines: def.lines });
      syncAll();
    },
  };
}

// ---- crt-shader (npm) ----------------------------------------------------
async function setupTheirs() {
  const canvas = $("#theirs-canvas");
  const runtime = createRuntime();
  let preset = "reference";
  let settings = resolveSettings(preset);
  let inputMode = "pixel";
  let inputResolution = 96;
  const prepared = new Map();
  const versions = new Map();
  const syncers = [];

  const sourceFor = () => {
    const key = `${current.id}:${inputMode}:${inputResolution}`;
    if (!prepared.has(key)) {
      prepared.set(key, prepareInput(current.image, { inputMode, inputResolution }));
      versions.set(key, versions.size + 1);
    }
    return [prepared.get(key), versions.get(key)];
  };

  let scheduled = false;
  function render() {
    if (!current || scheduled) return;
    scheduled = true;
    requestAnimationFrame(async () => {
      scheduled = false;
      try {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(2, Math.round(rect.width * dpr()));
        const height = Math.max(2, Math.round(rect.height * dpr()));
        const [source, sourceVersion] = sourceFor();
        await runtime.render({
          source, output: canvas, width, height, preset, settings: { ...settings }, sourceVersion,
        });
        $("#theirs-meta").textContent =
          `${width}×${height} out · mode ${inputMode}` +
          (inputMode === "photo" ? ` (${inputResolution}px longest edge)` : ` (${source.width}×${source.height})`);
      } catch (error) {
        if (error?.name !== "AbortError") showError(error);
      }
    });
  }

  const top = $("#theirs-top");
  const presetSelect = select(Object.keys(PRESETS), preset, (name) => {
    preset = name;
    settings = resolveSettings(name);
    syncAll();
    render();
  });
  const modeSelect = select(["pixel", "photo"], inputMode, (mode) => {
    inputMode = mode;
    render();
  });
  top.append(
    presetSelect, modeSelect,
    button("Reset", () => { settings = resolveSettings(preset); syncAll(); render(); }),
    button("Save PNG", () => download(canvas.toDataURL("image/png"), `crt-shader-${Date.now()}.png`)),
    button("Copy settings", () => navigator.clipboard.writeText(JSON.stringify({ preset, inputMode, inputResolution, settings }, null, 2))),
  );

  const root = $("#theirs-controls");
  syncers.push(addGroup(root, "Input", [{
    label: "inputResolution (photo)", min: 16, max: 512, step: 1,
    get: () => inputResolution, set: (v) => { inputResolution = v; render(); },
  }], true));
  controlGroups.forEach(([title, rows], index) => {
    syncers.push(addGroup(root, title, rows.map(([key, label, min, max, step]) => ({
      label, min, max, step,
      get: () => settings[key], set: (v) => { settings[key] = v; render(); },
    })), index < 3));
  });

  function syncAll() {
    presetSelect.value = preset;
    syncers.forEach((fn) => fn());
  }
  syncAll();
  new ResizeObserver(render).observe(canvas);

  return {
    useImage(def) {
      inputMode = def.mode;
      modeSelect.value = inputMode;
      render();
    },
  };
}

// ---- image picker --------------------------------------------------------
async function main() {
  const [ours, theirs] = await Promise.all([setupOurs(), setupTheirs()]);
  const strip = $("#images");

  async function choose(def, chosen) {
    try {
      const image = await loadImage(def.url);
      current = { image, def, id: nextId++ };
      for (const b of strip.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === chosen));
      document.querySelectorAll(".view").forEach((v) =>
        v.style.setProperty("--ar", `${image.naturalWidth} / ${image.naturalHeight}`));
      ours.useImage(def);
      theirs.useImage(def);
    } catch (error) {
      showError(error);
    }
  }

  const buttons = IMAGES.map((def) => {
    const b = document.createElement("button");
    b.title = def.name;
    b.innerHTML = `<img src="${def.url}" alt="${def.name}">`;
    b.addEventListener("click", () => choose(def, b));
    strip.append(b);
    return b;
  });

  const upload = document.createElement("label");
  upload.innerHTML = `+ image<input type="file" accept="image/*" hidden>`;
  upload.lastChild.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const b = document.createElement("button");
    const url = URL.createObjectURL(file);
    b.title = file.name;
    b.innerHTML = `<img src="${url}" alt="${file.name}">`;
    const def = { name: file.name, url, mode: "photo", lines: 360 };
    b.addEventListener("click", () => choose(def, b));
    strip.insertBefore(b, upload);
    choose(def, b);
  });
  strip.append(upload);

  await choose(IMAGES[0], buttons[0]);
}

main().catch(showError);
