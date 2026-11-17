// Cathode: unified CRT filter API over interchangeable backends (specs.md).
import { DEFAULTS, merge } from "./settings.js";
import { Presets, presetFor } from "./presets.js";
import { createGl, glSupported } from "./backends/gl.js";
import { createFast } from "./backends/fast.js";

/** A `Presets.X.Y` object, or the spec's `{complexity, tier, ...overrides}` shape. */
function resolve(preset) {
  if (preset?.complexity && preset?.tier) {
    const { complexity, tier, ...overrides } = preset;
    return merge(presetFor({ complexity, tier }), overrides);
  }
  return merge(DEFAULTS, preset);
}

export class Cathode {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {object} [o.preset=Presets.Detailed.Enhance]  or `{complexity, tier}` (lowercase, as in the spec)
   * @param {"gl"|"fast"} [o.backend="gl"]  gl falls back to fast without WebGL2; wgpu/sw throw.
   * @param {object} [o.gl]  extra options forwarded to crt-canvas (e.g. dataUrl).
   */
  constructor({ canvas, preset = Presets.Detailed.Enhance, backend = "gl", gl: glOptions } = {}) {
    if (backend === "sw" || backend === "wgpu") throw new Error(`cathode: the '${backend}' backend is not implemented in cathode-js`);
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("cathode: `canvas` must be a <canvas>");
    this.canvas = canvas;
    this.settings = resolve(preset);
    this.source = null;
    this._playing = false;
    this.backend = null;
    if (backend === "gl" && !glSupported()) {
      console.warn("cathode: WebGL2 + float targets unavailable, falling back to 'fast'");
      backend = "fast";
    }
    /** Resolves once the backend is ready. */
    this.ready = (backend === "gl" ? createGl(canvas, glOptions) : Promise.resolve(createFast(canvas)))
      .then((b) => {
        this.backend = b;
        b.apply(this.settings);
        if (this.source && !this._playing) this.render();
        return this;
      });
  }

  /** Bind a video, canvas, image, ImageBitmap or OffscreenCanvas. */
  attachSource(source) {
    this.source = source;
    if (!this._playing) this.render();
    return this;
  }

  configure(patch) {
    this.settings = merge(this.settings, patch);
    this.backend?.apply(this.settings);
    if (!this._playing) this.render();
    return this;
  }

  setPreset(preset) {
    this.settings = resolve(preset);
    this.backend?.apply(this.settings);
    if (!this._playing) this.render();
    return this;
  }

  /** Draw one frame now (no-op until the backend and a source are ready). */
  render(time = performance.now() / 1000) {
    if (!this.backend || !this.source) return;
    const s = this.source;
    if (s.readyState !== undefined && s.readyState < 2) return; // video without data yet
    this.backend.render(s, time);
  }

  /** Start the render loop only (requestVideoFrameCallback for a <video>, else rAF). Never touches playback. */
  run() {
    if (this._playing) return this;
    this._playing = true;
    const src = this.source;
    const rvfc = src?.requestVideoFrameCallback ? src : null;
    const loop = () => {
      if (!this._playing) return;
      schedule();
      this.render(performance.now() / 1000);
    };
    const schedule = () => {
      if (rvfc) {
        const id = rvfc.requestVideoFrameCallback(loop);
        this._cancel = () => rvfc.cancelVideoFrameCallback(id);
      } else {
        const id = requestAnimationFrame(loop);
        this._cancel = () => cancelAnimationFrame(id);
      }
    };
    schedule();
    return this;
  }

  stop() {
    this._playing = false;
    this._cancel?.();
    return this;
  }

  /** `run()` plus playing an attached <video>. */
  play() {
    this.source?.play?.();
    return this.run();
  }

  pause() {
    this.source?.pause?.();
    return this.stop();
  }

  toJSON() { return this.settings; }

  dispose() {
    this.stop();
    this.backend?.dispose();
    this.backend = null;
  }
}
