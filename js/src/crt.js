// The CRT renderer: ports the Rust player's pass order to WebGL2 and the
// shaders from Toddler-Boy/CRTEmulation-Data.

import {
  Program,
  Quad,
  Target,
  bindTexture,
  createTexture,
  flipRows,
  readPixels,
  uploadImage,
} from "./gl.js";
import {
  DEFAULT_SETTINGS,
  applySetting,
  loadPreset,
} from "./presets.js";
import { ENCODER_SHADER, VERTEX, VERTEX_ROTATED } from "./shaders.js";

const TEXTURE_2D = 0x0de1;

// The shipped masks hold 8 RGB triads per 64 texels, so 8 texels per source
// pixel makes one triad as wide as one input pixel.
const MASK_TEXELS_PER_PIXEL = 8;

function even(value) {
  const v = Math.round(value);
  return v + (v & 1);
}

/** Virtual resolutions: `lines` scanlines for the source, 3 px per line. */
export function plan(aspect, lines) {
  const a = Math.max(0.5, Math.min(4, aspect));
  const nh = Math.max(60, Math.min(1080, Math.round(lines)));
  const nw = even(nh * a);

  let ch = Math.min(nh * 3, 2160);
  let cw = even(ch * a);
  if (cw > 3840) {
    cw = 3840;
    ch = even(cw / a);
  }
  return { native: [nw, nh], crt: [cw, ch] };
}

function tubeRect(winW, winH, aspect, margin = 0.96) {
  const w = Math.max(1, winW);
  const h = Math.max(1, winH);
  let tw;
  let th;
  if (w / h > aspect) {
    th = h;
    tw = h * aspect;
  } else {
    tw = w;
    th = w / aspect;
  }
  return [Math.max(2, Math.trunc(tw * margin)), Math.max(2, Math.trunc(th * margin))];
}

function sourceSize(source) {
  if (!source) throw new Error("crt-canvas: no source was provided");
  const width =
    source.videoWidth ?? source.naturalWidth ?? source.displayWidth ?? source.width;
  const height =
    source.videoHeight ?? source.naturalHeight ?? source.displayHeight ?? source.height;
  if (!width || !height) {
    throw new Error(
      "crt-canvas: the source has no dimensions yet (is the video metadata loaded?)",
    );
  }
  return [width, height];
}

function refreshRate(analog) {
  return analog === "pal" ? 50.125 : 59.826;
}

function flicker(settings) {
  const threshold = 0.7;
  const value = Math.max(settings.phosphorDecay - threshold, 0) / (1 - threshold);
  return Math.pow(value, 2 / 3) * 0.05;
}

function decayFactors(settings, dt) {
  const crtDecay = settings.phosphorDecay;
  const decay = 1 + (10 - 1) * crtDecay;
  const factors = [18, 17, 20];
  const t = Math.max(0, Math.min(1, (crtDecay - 0.6) * 10));
  const off = 1 - t * t * (3 - 2 * t);
  return factors.map((factor) => Math.pow(2, -(factor * decay) * dt) * off);
}

export class CRT {
  constructor(gl, canvas, config) {
    this.gl = gl;
    this.canvas = canvas;
    this.dataUrl = config.dataUrl;
    this.options = config.options ?? {};
    this.settings = config.settings;
    this.shaders = config.shaders;
    this.maskImages = config.maskImages;
    this.reflectionImage = config.reflectionImage;

    this.quad = new Quad(gl);
    this.programs = {
      simulation: new Program(gl, VERTEX, this.shaders.simulation, "crt-simulation"),
      curved: new Program(gl, VERTEX_ROTATED, this.shaders.curved, "crt-curved"),
      adjacent: new Program(gl, VERTEX, this.shaders.adjacent, "crt-adjacent-excitation"),
      halation: new Program(gl, VERTEX, this.shaders.halation, "crt-halation"),
      bloom: new Program(gl, VERTEX, this.shaders.bloom, "crt-calc-bloom"),
      decoderPal: new Program(gl, VERTEX, this.shaders.decoderPal, "decoder-pal"),
      decoderNtsc: new Program(gl, VERTEX, this.shaders.decoderNtsc, "decoder-ntsc"),
      encoder: new Program(gl, VERTEX, ENCODER_SHADER, "encoder-rgb"),
    };

    this.reflection = createTexture(gl, {
      width: this.reflectionImage.naturalWidth,
      height: this.reflectionImage.naturalHeight,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
      mipmaps: true,
    });
    uploadImage(gl, this.reflection, this.reflectionImage);

    this.mask = null;
    this._buildMask(this.settings.maskBitmap);

    this._targets = null;
    this._lastTime = null;
    this._crtIndex = 0;
    this._bloomIndex = 0;
    this._reflectionOn = this.options.reflection !== false;
  }

  get width() {
    return this._targets?.size[0] ?? 0;
  }

  get height() {
    return this._targets?.size[1] ?? 0;
  }

  get nativeWidth() {
    return this._targets?.native[0] ?? 0;
  }

  get nativeHeight() {
    return this._targets?.native[1] ?? 0;
  }

  _buildMask(name) {
    const gl = this.gl;
    const image = this.maskImages.get(name);
    if (!image) {
      throw new Error(`crt-canvas: CRT mask '${name}' was not loaded`);
    }
    if (this.mask) gl.deleteTexture(this.mask.texture);

    // Native-size bitmap, tiled by the shader so one triad spans one source
    // pixel (see crtMaskRepeats).
    this.mask = createTexture(gl, {
      width: image.naturalWidth,
      height: image.naturalHeight,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
      wrap: gl.REPEAT,
      mipmaps: true,
    });
    uploadImage(gl, this.mask, image);
  }

  _disposeTargets() {
    if (!this._targets) return;
    const gl = this.gl;
    gl.deleteTexture(this._targets.source.texture);
    for (const target of this._targets.crt) target.dispose();
    for (const target of this._targets.bloom) target.dispose();
    this._targets.adjacent.dispose();
    this._targets.halation.dispose();
    this._targets.yuv.dispose();
    this._targets.decoded.dispose();
    this._targets = null;
  }

  _ensureTargets(aspect) {
    const layout = plan(aspect, this.settings.lines);
    const [nw, nh] = layout.native;
    const [cw, ch] = layout.crt;
    if (
      this._targets &&
      this._targets.native[0] === nw &&
      this._targets.native[1] === nh &&
      this._targets.size[0] === cw &&
      this._targets.size[1] === ch
    ) {
      return;
    }
    this._disposeTargets();
    const gl = this.gl;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = nw;
    sourceCanvas.height = nh;

    const target = (w, h, internalFormat, format, type, options) =>
      new Target(gl, w, h, internalFormat, format, type, options);

    this._targets = {
      native: [nw, nh],
      size: [cw, ch],
      sourceCanvas,
      sourceCtx: sourceCanvas.getContext("2d"),
      source: createTexture(gl, {
        width: nw,
        height: nh,
        internalFormat: gl.RGBA8,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        filter: gl.LINEAR,
        wrap: gl.CLAMP_TO_EDGE,
        mipmaps: true,
      }),
      crt: [
        target(cw, ch, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, { mipmaps: true }),
        target(cw, ch, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, { mipmaps: true }),
      ],
      adjacent: target(cw, ch, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, { mipmaps: true }),
      halation: target(cw, ch, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, { mipmaps: true }),
      bloom: [
        target(1, 1, gl.R32F, gl.RED, gl.FLOAT, { filter: gl.NEAREST }),
        target(1, 1, gl.R32F, gl.RED, gl.FLOAT, { filter: gl.NEAREST }),
      ],
      yuv: target(nw, nh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, { mipmaps: true }),
      decoded: target(nw, nh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, { mipmaps: true }),
    };
    // Old frame history belongs to the previous size.
    this._crtIndex = 0;
    this._bloomIndex = 0;
  }

  _autoResize() {
    if (this.options.autoResize === false) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.options.maxPixelRatio ?? 2);
    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this._disposed = false;
    }
  }

  resize() {
    this._autoResize();
  }

  setReflection(on) {
    this._reflectionOn = Boolean(on);
    return this;
  }

  toggleReflection() {
    this._reflectionOn = !this._reflectionOn;
    return this._reflectionOn;
  }

  setAnalog(mode) {
    this.settings.analog =
      String(mode).toLowerCase() === "pal"
        ? "pal"
        : String(mode).toLowerCase() === "ntsc" ||
            String(mode).toLowerCase() === "yiq"
          ? "ntsc"
          : "off";
    return this;
  }

  setMask(name) {
    this.settings.maskBitmap = name;
    this._buildMask(name);
    return this;
  }

  /** Load a preset by name, keeping the scanline count and analogue mode. */
  async setPreset(name) {
    const preset = await loadPreset(this.dataUrl, String(name));
    const previous = this.settings;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...preset,
      lines: previous.lines,
      analog: previous.analog,
    };
    this._buildMask(this.settings.maskBitmap);
    return this;
  }

  setOptions(patch) {
    const previousLines = this.settings.lines;
    const previousMask = this.settings.maskBitmap;
    for (const [key, value] of Object.entries(patch)) {
      if (key === "reflection") {
        this.setReflection(value);
      } else if (key === "mask" && typeof value === "string") {
        this.settings.maskBitmap = value;
      } else {
        applySetting(this.settings, key, value);
      }
    }
    if (this.settings.maskBitmap !== previousMask) {
      this._buildMask(this.settings.maskBitmap);
    }
    if (this.settings.lines !== previousLines) this._disposeTargets();
    return this;
  }

  _drawSource(source) {
    const gl = this.gl;
    const t = this._targets;
    const ctx = t.sourceCtx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, t.native[0], t.native[1]);

    gl.bindTexture(TEXTURE_2D, t.source.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(
      TEXTURE_2D,
      0,
      0,
      0,
      t.native[0],
      t.native[1],
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      t.sourceCanvas,
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(TEXTURE_2D);
    gl.bindTexture(TEXTURE_2D, null);
  }

  _setDecoderUniforms(program, settings, analog, t) {
    const ntsc = analog === "ntsc";
    const rate = refreshRate(analog);
    program.f32("crtRefreshRate", rate);
    program.f32("decSharpening", settings.sharpening);
    program.f32("decLumablur", settings.lumaBlur);
    program.f32("decChromablur", settings.chromaBlur);
    program.f32("decCrosstalk", settings.crosstalk);
    program.f32("decPhase", settings.phase);
    program.f32("decPALDelayLine", settings.hannover);
    program.f32("decCrossColor", settings.rainbowing);
    program.f32("decDrift", settings.drift);
    program.f32("decNoise", settings.noise);
    program.f32("decJailbars", settings.jailbars);
    program.f32("iTime", t);

    const brightness = settings.brightness - (ntsc ? 0.7 : 0.5);
    const contrast = 0.4 + (1.2 - 0.4) * settings.contrast;
    const saturation = (ntsc ? 0.8 : 0.9) * settings.saturation;
    program.vec3(
      "encBrightnessContrastSaturation",
      brightness * 0.5,
      contrast,
      saturation,
    );

    const tintLinear = settings.tint;
    const tint =
      Math.pow(Math.abs(tintLinear), 2.5) * Math.sign(tintLinear || 1);
    program.vec3(
      "encTintGains",
      1 + tint,
      1 - (tint * (0.299 - 0.114)) / 0.587,
      1 - tint,
    );
  }

  render(source, time = performance.now() / 1000) {
    const gl = this.gl;
    const settings = this.settings;
    this._autoResize();

    const [sw, sh] = sourceSize(source);
    const aspect = this.options.aspect ?? sw / sh;
    this._ensureTargets(aspect);
    this._drawSource(source);

    const dt =
      this._lastTime === null
        ? 1 / 60
        : Math.min(0.1, Math.max(0.001, time - this._lastTime));
    this._lastTime = time;
    const t = time;

    const targets = this._targets;
    const analog = settings.analog;
    let sourceTex = targets.source.texture;

    // ---- analogue signal path -------------------------------------
    if (analog !== "off") {
      const { encoder } = this.programs;
      encoder.use();
      encoder.resolution(targets.native[0], targets.native[1]);
      encoder.f32("iTime", t);
      encoder.i32("uYiq", analog === "ntsc" ? 1 : 0);
      bindTexture(gl, encoder, "iChannel0", 0, targets.source.texture);
      targets.yuv.bind();
      this.quad.draw();

      const decoder =
        analog === "ntsc" ? this.programs.decoderNtsc : this.programs.decoderPal;
      decoder.use();
      decoder.resolution(targets.native[0], targets.native[1]);
      this._setDecoderUniforms(decoder, settings, analog, t);
      bindTexture(gl, decoder, "iChannel0", 0, targets.yuv.texture.texture);
      targets.decoded.bind();
      this.quad.draw();
      targets.decoded.generateMipmaps();
      sourceTex = targets.decoded.texture.texture;
    }

    // ---- beam bloom level (1x1 ping-pong) --------------------------
    const bloomRead = targets.bloom[this._bloomIndex];
    const bloomWrite = targets.bloom[this._bloomIndex ^ 1];
    bloomWrite.bind();
    this.programs.bloom.use();
    this.programs.bloom.resolution(1, 1);
    this.programs.bloom.f32("deltaTime", dt);
    bindTexture(gl, this.programs.bloom, "iChannel0", 0, bloomRead.texture.texture);
    bindTexture(gl, this.programs.bloom, "iChannel1", 1, sourceTex);
    this.quad.draw();

    // ---- CRT simulation -------------------------------------------
    const read = this._crtIndex;
    const write = read ^ 1;
    const crtRead = targets.crt[read];
    const crtWrite = targets.crt[write];
    crtWrite.bind();
    const sim = this.programs.simulation;
    sim.use();
    sim.resolution(crtWrite.width, crtWrite.height);
    sim.f32("iTime", t);
    sim.f32("crtRefreshRate", refreshRate(analog));
    sim.f32("crtLinePixels", 5.0);
    sim.f32("crtBleed", settings.bleed);
    sim.vec2("crtRedOffset", settings.bleedRed[0], settings.bleedRed[1]);
    sim.vec2("crtGreenOffset", settings.bleedGreen[0], settings.bleedGreen[1]);
    sim.vec2("crtBlueOffset", settings.bleedBlue[0], settings.bleedBlue[1]);
    sim.f32("crtHoffset", settings.hWave);
    sim.f32("crtConvergence", settings.convergence);
    sim.f32("crtScanlines", settings.scanlines);
    sim.f32("crtMask", settings.mask);
    sim.vec2(
      "crtMaskRepeats",
      (targets.native[0] * MASK_TEXELS_PER_PIXEL) / this.mask.width,
      (targets.native[1] * MASK_TEXELS_PER_PIXEL) / this.mask.height,
    );
    sim.f32("crtBloomExpansion", settings.expansion);
    sim.f32("crtAmbient", settings.ambient);
    sim.f32("crtGlow", 1.0);
    sim.f32("u_deltaTime", dt);
    sim.f32("u_phosphorFlicker", flicker(settings));
    const [dr, dg, db] = decayFactors(settings, dt);
    sim.vec3("u_decayFactor", dr, dg, db);
    const over = 1 + (0.86 - 1) * settings.overscan;
    const yOver = over * (analog === "ntsc" ? 0.8825 : 1);
    sim.vec2("crtOverscan", over, yOver);
    bindTexture(gl, sim, "iChannel0", 0, sourceTex);
    bindTexture(gl, sim, "iChannel1", 1, this.mask.texture);
    bindTexture(gl, sim, "iChannel2", 2, crtRead.texture.texture);
    bindTexture(gl, sim, "iChannel3", 3, bloomWrite.texture.texture);
    this.quad.draw();
    crtWrite.generateMipmaps();

    // ---- phosphor spill -------------------------------------------
    targets.adjacent.bind();
    const adjacent = this.programs.adjacent;
    adjacent.use();
    adjacent.resolution(crtWrite.width, crtWrite.height);
    adjacent.f32("iTime", t);
    adjacent.f32("crtAdjacent", settings.adjacent);
    bindTexture(gl, adjacent, "iChannel0", 0, crtWrite.texture.texture);
    this.quad.draw();
    targets.adjacent.generateMipmaps();

    // ---- halation -------------------------------------------------
    targets.halation.bind();
    const halation = this.programs.halation;
    halation.use();
    halation.resolution(crtWrite.width, crtWrite.height);
    halation.f32("iTime", t);
    halation.f32("crtHalation", settings.halation);
    bindTexture(gl, halation, "iChannel0", 0, targets.adjacent.texture.texture);
    this.quad.draw();
    targets.halation.generateMipmaps();

    // ---- tube geometry, vignette, glass reflection ----------------
    const winW = gl.drawingBufferWidth;
    const winH = gl.drawingBufferHeight;
    const [tw, th] = tubeRect(winW, winH, this._targets.size[0] / this._targets.size[1], 0.96);
    const rotation = ((settings.rotation * 0.005) * Math.PI) / 180;
    const sin = Math.sin(rotation);
    const cos = Math.cos(rotation);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, winW, winH);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const curved = this.programs.curved;
    curved.use();
    curved.resolution(tw, th);
    curved.f32("iTime", t);
    curved.f32("crtCurve", settings.curve);
    curved.f32("crtVignette", settings.vignette);
    curved.f32("crtAmbient", settings.ambient);
    curved.f32("crtDistortion", 0.3);
    curved.f32("crtRotation", rotation);
    curved.f32("crtAspect", tw / th);
    curved.bool("crtSource", false);
    curved.f32("crtRflCorrection", 1.0);
    curved.f32("camZoom", 1.0);
    curved.i32("crtWebcamFormat", 0);
    curved.vec3("camBrightnessContrastSaturation", 1, 1, 1);
    curved.vec3("yuvCol0", 0, 0, 0);
    curved.vec3("yuvCol1", 0, 0, 0);
    curved.vec3("yuvCol2", 0, 0, 0);
    curved.vec3("yuvBias", 0, 0, 0);
    curved.f32(
      "crtReflection",
      this._reflectionOn ? settings.reflections : 0.0,
    );
    curved.vec3("backCol", 0, 0, 0);
    bindTexture(gl, curved, "iChannel0", 0, targets.halation.texture.texture);
    bindTexture(gl, curved, "iChannel1", 1, this.reflection.texture);
    bindTexture(gl, curved, "iChannel2", 2, targets.halation.texture.texture);
    bindTexture(gl, curved, "iChannel3", 3, targets.halation.texture.texture);

    curved.vec2("uScale", tw / Math.max(1, winW), th / Math.max(1, winH));
    curved.f32("uWindowAspect", Math.max(1, winW) / Math.max(1, winH));
    curved.mat2("uRot", [cos, sin, -sin, cos]);
    this.quad.draw();

    this._crtIndex = write;
    this._bloomIndex ^= 1;
    return this;
  }

  /** Read the current drawing buffer top-down (for saving or inspecting). */
  readPixels() {
    const gl = this.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const data = flipRows(readPixels(gl, width, height), width, height);
    return { width, height, data };
  }

  /** PNG data URL of the last rendered frame. */
  snapshot(type = "image/png") {
    return this.canvas.toDataURL(type);
  }

  dispose() {
    this._disposeTargets();
    for (const program of Object.values(this.programs)) program.dispose();
    this.quad.dispose();
    if (this.mask) this.gl.deleteTexture(this.mask.texture);
    this.gl.deleteTexture(this.reflection.texture);
  }
}
