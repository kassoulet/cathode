// cathode-fx — CRT emulation for a <canvas>, using the shaders from
// Toddler-Boy/CRTEmulation-Data.

import { getContext } from "./gl.js";
import { CRT } from "./crt.js";
import {
  fragmentShader,
  loadShader,
  SHADER_FILES,
} from "./shaders.js";
import {
  DEFAULT_SETTINGS,
  MASKS,
  PRESET_NAMES,
  detectDataUrl,
  resolveSettings,
} from "./presets.js";

export { CRT, plan } from "./crt.js";
export { Cathode } from "./cathode/cathode.js";
export { Presets } from "./cathode/presets.js";
export {
  DEFAULT_SETTINGS,
  MASKS,
  PRESET_NAMES,
  maskFileName,
  normalizeAnalog,
  parsePresetYaml,
} from "./presets.js";

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`cathode-fx: cannot load image ${url}`));
    image.src = url;
  });
}

/**
 * Create a CRT renderer bound to `canvas`.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {string} [options.preset="Default"]  Preset name or settings object.
 * @param {string} [options.dataUrl]           URL of the CRTEmulation-Data directory.
 * @param {"off"|"pal"|"ntsc"} [options.analog="off"]
 * @param {number} [options.lines=270]         Simulated scanline count.
 * @param {number} [options.aspect]            Source aspect; inferred per frame.
 * @param {boolean} [options.autoResize=true]  Track the canvas CSS size.
 * @param {boolean} [options.reflection=true]  Draw the glass reflection.
 * @param {object} [options.overrides]         Setting overrides (0..1 units).
 * @returns {Promise<CRT>}
 */
export async function createCRT(canvas, options = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("cathode-fx: the first argument must be a <canvas>");
  }
  const gl = getContext(canvas, options.gl);
  const dataUrl = await detectDataUrl(options.dataUrl);
  const settings = await resolveSettings(dataUrl, options);

  const shaderBase = new URL("Shaders/", dataUrl);
  const cache = new Map();
  const bodies = await Promise.all(
    Object.values(SHADER_FILES).map((file) => loadShader(shaderBase, file, cache)),
  );
  const shaders = {};
  Object.keys(SHADER_FILES).forEach((key, index) => {
    shaders[key] = fragmentShader(bodies[index]);
  });

  const maskImages = new Map();
  const [reflectionImage] = await Promise.all([
    loadImage(new URL("reflections.png", dataUrl).href),
    ...MASKS.map(async (mask) => {
      const image = await loadImage(
        new URL(`CRT Masks/${encodeURIComponent(mask)}.png`, dataUrl).href,
      );
      maskImages.set(mask, image);
    }),
  ]);

  return new CRT(gl, canvas, {
    dataUrl,
    options,
    settings,
    shaders,
    maskImages,
    reflectionImage,
  });
}

/**
 * Convenience wrapper: create a renderer and drive it from requestAnimationFrame.
 * `source` may be a video/image/canvas or a function returning one.
 */
export async function attach(canvas, source, options = {}) {
  const crt = await createCRT(canvas, options);
  let running = true;
  const loop = (now) => {
    if (!running) return;
    try {
      crt.render(typeof source === "function" ? source() : source, now / 1000);
    } catch (error) {
      console.error(error);
      running = false;
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    crt,
    stop() {
      running = false;
    },
  };
}
