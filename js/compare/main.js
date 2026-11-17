// Side-by-side test bench: each pane picks one renderer.
import ours from "./renderers/ours.js";
import theirs from "./renderers/theirs.js";
import cathode from "./renderers/cathode.js";
import { lite, deluxe } from "./renderers/zmbc.js";
import { cathodeGl, cathodeFast } from "./renderers/cathode-js.js";
import { lottes, geom, easymode, royale } from "./renderers/libretro.js";

const RENDERERS = [ours, theirs, cathodeGl, cathodeFast, cathode, lite, deluxe, lottes, geom, easymode, royale];
const DEFAULT_PANES = ["crt-canvas", "crt-shader"];

const $ = (selector) => document.querySelector(selector);
const errorBox = $("#error");
const showError = (error) => {
  console.error(error);
  errorBox.textContent = String(error?.message ?? error);
};

// `mode` is crt-shader's input mode (pixel = native pixels, photo = downsample),
// `lines` is the scanline count handed to crt-canvas.
const IMAGES = [
  { name: "SMPTE bars", url: "images/bars.png", mode: "pixel", lines: 240 },
  { name: "Pixel-art scene", url: "images/sprites.png", mode: "pixel", lines: 224 },
  { name: "C64 text", url: "images/terminal.png", mode: "pixel", lines: 200 },
  { name: "Landscape", url: "images/landscape.png", mode: "photo", lines: 360 },
  { name: "Gradients", url: "images/gradient.png", mode: "photo", lines: 360 },
];

let current = null; // { image, def }
const panes = [];

const loadImage = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`cannot load ${url}`));
  image.src = url;
});

function setupPane(section, initial) {
  const q = (sel) => section.querySelector(sel);
  const picker = q(".renderer");
  const pane = { instance: null, generation: 0, frames: 0, fps: 0, text: "", last: performance.now() };
  for (const r of RENDERERS) picker.add(new Option(r.label, r.id));
  picker.value = initial;

  const metaEl = q(".meta");
  let metaAt = 0;
  const writeMeta = () => {
    if (pane.text) metaEl.textContent = pane.text + (pane.fps ? ` · ${Math.round(pane.fps)} fps` : "");
  };
  pane.writeMeta = writeMeta;
  const meta = (text) => {
    pane.text = text;
    pane.frames += 1;
    const now = performance.now();
    if (now - metaAt > 500) { metaAt = now; writeMeta(); }
  };

  async function load() {
    const generation = ++pane.generation;
    pane.instance?.dispose?.();
    pane.instance = null;
    Object.assign(pane, { frames: 0, fps: 0, text: "", last: performance.now() });
    // A canvas can't change context type, so every switch gets a fresh one.
    const view = q(".view");
    const canvas = document.createElement("canvas");
    view.replaceChildren(canvas);
    for (const el of [q(".top"), q(".controls")]) el.replaceChildren();
    metaEl.textContent = "loading…";
    try {
      const renderer = RENDERERS.find((r) => r.id === picker.value);
      const instance = await renderer.create({
        canvas, top: q(".top"), root: q(".controls"), meta: (t) => { metaAt = 0; meta(t); }, error: showError,
      });
      if (generation !== pane.generation) return instance.dispose?.();
      pane.instance = instance;
      if (current) instance.useImage(current.def);
    } catch (error) {
      showError(error);
      metaEl.textContent = "failed — see error above";
    }
  }
  picker.addEventListener("change", load);
  pane.load = load;
  panes.push(pane);
  return pane;
}

function frame(now) {
  if (current) {
    for (const pane of panes) {
      try {
        pane.instance?.draw(current.image, current.def, now);
      } catch (error) {
        showError(error);
        pane.instance = null; // stop redrawing a broken renderer
      }
    }
  }
  for (const pane of panes) {
    if (now - pane.last >= 500) {
      pane.fps = current ? (pane.frames * 1000) / (now - pane.last) : 0;
      pane.frames = 0;
      pane.last = now;
      pane.writeMeta();
    }
  }
  // Registered after draw so crt-shader's flush rAF runs first next frame.
  requestAnimationFrame(frame);
}

async function main() {
  const sections = document.querySelectorAll(".pane");
  sections.forEach((section, i) => setupPane(section, DEFAULT_PANES[i]));
  const strip = $("#images");

  async function choose(def, chosen) {
    try {
      const image = await loadImage(def.url);
      current = { image, def };
      for (const b of strip.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === chosen));
      document.querySelectorAll(".view").forEach((v) =>
        v.style.setProperty("--ar", `${image.naturalWidth} / ${image.naturalHeight}`));
      panes.forEach((pane) => pane.instance?.useImage(def));
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
  await Promise.all(panes.map((pane) => pane.load()));
  panes.forEach((pane) => { pane.last = performance.now(); pane.frames = 0; });
  requestAnimationFrame(frame);
}

main().catch(showError);
