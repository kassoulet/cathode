// Cathode: unified CRT filter API over interchangeable backends (specs.md).
import { DEFAULTS, merge } from "./settings.js";
import { Presets } from "./presets.js";
import { createGl, glSupported } from "./backends/gl.js";
import { createFast } from "./backends/fast.js";

export class Cathode {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {object} [o.preset=Presets.Detailed.Enhance]
   * @param {"gl"|"fast"|"sw"} [o.backend="gl"]  gl falls back to fast without WebGL2.
   * @param {object} [o.gl]  extra options forwarded to crt-canvas (e.g. dataUrl).
   */
  constructor({ canvas, preset = Presets.Detailed.Enhance, backend = "gl", gl: glOptions } = {}) {
    if (backend === "sw") throw new Error("cathode: the 'sw' backend is not implemented in cathode-js");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("cathode: `canvas` must be a <canvas>");
    this.canvas = canvas;
    this.settings = merge(DEFAULTS, preset);
    this.source = null;
    this._playing = false;
    this._raf = 0;
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
    this.settings = merge(DEFAULTS, preset);
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

  /** Render every animation frame (and play an attached <video>). */
  play() {
    if (this._playing) return this;
    this._playing = true;
    this.source?.play?.();
    const loop = (now) => {
      if (!this._playing) return;
      this._raf = requestAnimationFrame(loop);
      this.render(now / 1000);
    };
    this._raf = requestAnimationFrame(loop);
    return this;
  }

  pause() {
    this._playing = false;
    cancelAnimationFrame(this._raf);
    this.source?.pause?.();
    return this;
  }

  toJSON() { return this.settings; }

  dispose() {
    this.pause();
    this.backend?.dispose();
    this.backend = null;
  }
}
