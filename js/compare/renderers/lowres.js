// lowres (from the zmbc web player): "CRT-Lite" (one pass) and "CRT Deluxe" (lite → ghost accumulator → post).
// Shaders extracted verbatim; presets/params ported from shaders.ts and crt-deluxe.ts.
import { CRT_VERTEX, NOFLIP_VERTEX, CRT_LITE_FRAGMENT, CRT_DELUXE_BLEND_FRAGMENT, CRT_DELUXE_POST_FRAGMENT } from "./lowres-shaders.js";
import { addGroup, select, commonButtons, program, fitCanvas, button } from "./ui.js";

const LITE_PRESETS = {
  "scanline":        { scanline: 0.75, beamDark: 0.22, beamBright: 0.38, maskType: 0, maskStrength: 0,    curvature: 0,    vignette: 0.15, boost: 1.25 },
  "shadow-mask":     { scanline: 0.55, beamDark: 0.24, beamBright: 0.4,  maskType: 2, maskStrength: 0.3,  curvature: 0,    vignette: 0.15, boost: 1.35 },
  "aperture-grille": { scanline: 0.6,  beamDark: 0.22, beamBright: 0.38, maskType: 1, maskStrength: 0.3,  curvature: 0,    vignette: 0.1,  boost: 1.35 },
  "slot-mask":       { scanline: 0.5,  beamDark: 0.24, beamBright: 0.42, maskType: 3, maskStrength: 0.25, curvature: 0.02, vignette: 0.2,  boost: 1.45 },
  "arcade":          { scanline: 1.0,  beamDark: 0.18, beamBright: 0.45, maskType: 1, maskStrength: 0.15, curvature: 0.04, vignette: 0.25, boost: 1.5 },
};
const LITE_RANGES = [
  ["scanline", 0, 1], ["beamDark", 0.05, 0.8], ["beamBright", 0.05, 0.8], ["maskStrength", 0, 1],
  ["curvature", 0, 0.1], ["vignette", 0, 1], ["boost", 1, 2],
];

const I = (scanline, bloom, noise, flicker, vignette, chromatic, phosphor, warp, colorDrift, artifacts, ghosting) =>
  ({ scanline, bloom, noise, flicker, vignette, chromatic, phosphor, warp, colorDrift, artifacts, ghosting });
const DET = { low: 0.3, medium: 0.6, high: 1.0 };
const DES = { low: 0.2, medium: 0.5, high: 1.0 };
const DELUXE_PRESETS = {
  "crt-33": ["CRT-33 Trinitron", "msdos", DET.high, DES.low, I(1.0, 0.5, 0.0, 0.1, 0.2, 0.3, 1.0, 0.0, 0.0, 0.0, 0.0)],
  "crt-26": ["CRT-26 VGA Workhorse", "msdos", DET.medium, DES.medium, I(1.0, 0.7, 0.3, 0.2, 0.4, 0.5, 0.8, 0.2, 0.3, 0.0, 0.0)],
  "crt-20": ["CRT-20 Flickering VGA", "msdos", DET.low, DES.high, I(0.6, 0.3, 1.0, 1.0, 0.8, 1.0, 0.3, 0.8, 1.0, 0.0, 0.0)],
  "crt-40": ["CRT-40 A1200", "amiga", DET.high, DES.low, I(1.0, 0.4, 0.0, 0.2, 0.3, 0.2, 1.0, 0.0, 0.0, 0.1, 0.0)],
  "crt-36": ["CRT-36 Amiga 1084S", "amiga", DET.medium, DES.medium, I(1.0, 0.6, 0.2, 0.3, 0.5, 0.4, 0.7, 0.3, 0.4, 0.3, 0.0)],
  "crt-30": ["CRT-30 Amiga Composite", "amiga", DET.low, DES.high, I(0.7, 0.8, 1.0, 0.8, 0.9, 1.0, 0.3, 0.7, 1.0, 1.0, 0.0)],
  "crt-64": ["CRT-64 Breadbin", "c64", DET.high, DES.low, I(1.0, 0.6, 0.0, 0.1, 0.3, 0.2, 1.0, 0.0, 0.0, 0.5, 0.0)],
  "crt-60": ["CRT-60 C64 Composite", "c64", DET.medium, DES.medium, I(1.0, 0.8, 0.4, 0.3, 0.6, 0.5, 0.7, 0.3, 0.5, 0.8, 0.3)],
  "crt-50": ["CRT-50 Ancient C64", "c64", DET.low, DES.high, I(0.5, 1.0, 1.0, 0.8, 1.0, 1.0, 0.2, 1.0, 1.0, 1.0, 1.0)],
};
const PROFILE = {
  msdos: { beamDark: 0.2, beamBright: 0.36, maskType: 2 },
  amiga: { beamDark: 0.24, beamBright: 0.42, maskType: 3 },
  c64: { beamDark: 0.3, beamBright: 0.46, maskType: 3 },
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function deluxeState(id) {
  const [, platform, details, destruction, intensities] = DELUXE_PRESETS[id];
  return { id, platform, details, destruction, curvature: intensities.warp * destruction, ...intensities };
}

/** Shared GL2 plumbing: texture upload, FBO targets, 6-vertex quad on a_pos. */
function setup(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("WebGL2 unavailable");
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const texture = (filter, w = 1, h = 1) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const source = texture(gl.NEAREST);
  let uploaded = null;
  const target = () => ({ tex: texture(gl.LINEAR), fbo: gl.createFramebuffer(), w: 0, h: 0 });
  const bindPass = (t, w, h, ...inputs) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t?.fbo ?? null);
    gl.viewport(0, 0, w, h);
    inputs.forEach((tx, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tx); });
  };
  const size = (t, w, h) => {
    if (t.w === w && t.h === h) return false;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    Object.assign(t, { w, h });
    return true;
  };
  const upload = (image) => {
    if (uploaded === image) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    uploaded = image;
  };
  return { gl, source, target, bindPass, size, upload };
}

function drawLite(g, prog, image, w, h, p, into) {
  const { gl } = g;
  g.bindPass(into, w, h, g.source);
  gl.useProgram(prog);
  gl.uniform1i(prog.u("u_texture"), 0);
  gl.uniform2f(prog.u("u_videoSize"), image.naturalWidth, image.naturalHeight);
  gl.uniform2f(prog.u("u_canvasSize"), w, h);
  gl.uniform3f(prog.u("u_scan"), p.scanline, p.beamDark, p.beamBright);
  gl.uniform2f(prog.u("u_mask"), p.maskType, p.maskStrength);
  gl.uniform3f(prog.u("u_geom"), p.curvature, p.vignette, p.boost);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

export const lite = {
  id: "lowres-lite",
  label: "lowres CRT-Lite",
  async create({ canvas, top, root, meta }) {
    const g = setup(canvas);
    const prog = program(g.gl, CRT_VERTEX, CRT_LITE_FRAGMENT);
    let name = "shadow-mask";
    let p = { ...LITE_PRESETS[name] };
    const syncers = [];
    const presetSelect = select(Object.keys(LITE_PRESETS), name, (n) => { name = n; p = { ...LITE_PRESETS[n] }; syncAll(); });
    const maskSelect = select([[0, "no mask"], [1, "aperture grille"], [2, "shadow mask"], [3, "slot mask"]], p.maskType,
      (v) => { p.maskType = Number(v); });
    top.append(presetSelect, maskSelect,
      button("Reset", () => { p = { ...LITE_PRESETS[name] }; syncAll(); }),
      ...commonButtons("lowres-lite", canvas, () => ({ preset: name, ...p })));
    syncers.push(addGroup(root, "CRT-Lite", LITE_RANGES.map(([key, min, max]) => ({
      label: key, min, max, step: 0.01, get: () => p[key], set: (v) => { p[key] = v; },
    })), true));
    function syncAll() { maskSelect.value = p.maskType; syncers.forEach((fn) => fn()); }
    syncAll();
    return {
      useImage() {},
      draw(image) {
        const [w, h] = fitCanvas(canvas);
        g.upload(image);
        drawLite(g, prog, image, w, h, p, null);
        meta(`${w}×${h} out · single pass, ${image.naturalWidth}×${image.naturalHeight} source`);
      },
      dispose() { g.gl.getExtension("WEBGL_lose_context")?.loseContext(); },
    };
  },
};

export const deluxe = {
  id: "lowres-deluxe",
  label: "lowres CRT Deluxe",
  async create({ canvas, top, root, meta }) {
    const g = setup(canvas);
    const { gl } = g;
    const liteProg = program(gl, CRT_VERTEX, CRT_LITE_FRAGMENT);
    const post = program(gl, NOFLIP_VERTEX, CRT_DELUXE_POST_FRAGMENT);
    const blend = program(gl, NOFLIP_VERTEX, CRT_DELUXE_BLEND_FRAGMENT);
    const liteT = g.target();
    const accum = [g.target(), g.target()];
    let read = 0;
    let fresh = true;
    let s = deluxeState("crt-26");
    const syncers = [];
    const presetSelect = select(Object.entries(DELUXE_PRESETS).map(([id, v]) => [id, v[0]]), s.id, (id) => {
      s = deluxeState(id); fresh = true; syncAll();
    });
    top.append(presetSelect,
      button("Reset", () => { s = deluxeState(s.id); syncAll(); }),
      ...commonButtons("lowres-deluxe", canvas, () => s));
    const rows = (keys, min = 0, max = 1) => keys.map((key) => ({
      label: key, min, max, step: 0.01, get: () => s[key], set: (v) => { s[key] = v; },
    }));
    syncers.push(addGroup(root, "Levels", rows(["details", "destruction", "curvature"]), true));
    syncers.push(addGroup(root, "Intensities", rows(["scanline", "bloom", "noise", "flicker", "vignette",
      "chromatic", "phosphor", "warp", "colorDrift", "artifacts", "ghosting"]), true));
    function syncAll() { syncers.forEach((fn) => fn()); }
    syncAll();

    return {
      useImage() { fresh = true; },
      draw(image, def, now) {
        const [w, h] = fitCanvas(canvas);
        g.upload(image);
        if (g.size(liteT, w, h)) fresh = true;
        const det = clamp01(s.details);
        drawLite(g, liteProg, image, w, h, {
          ...PROFILE[s.platform],
          scanline: s.scanline * (0.5 + 0.5 * det),
          maskStrength: 0.35 * s.phosphor * det,
          curvature: 0, vignette: 0, boost: 1.4,
        }, liteT);

        let src = liteT.tex;
        const rel = Math.min(2, clamp01(s.destruction) / Math.max(DELUXE_PRESETS[s.id][3], 1e-3));
        const mix = Math.max(0.4, 1 - s.ghosting * 0.3 * rel);
        if (mix < 0.999) {
          const [rd, wr] = [accum[read], accum[1 - read]];
          if (g.size(rd, w, h)) fresh = true;
          g.size(wr, w, h);
          g.bindPass(wr, w, h, rd.tex, liteT.tex);
          gl.useProgram(blend);
          gl.uniform1i(blend.u("u_accum"), 0);
          gl.uniform1i(blend.u("u_current"), 1);
          gl.uniform1f(blend.u("u_ghost_factor"), fresh ? 1 : mix);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          fresh = false;
          read = 1 - read;
          src = wr.tex;
        } else fresh = true;

        g.bindPass(null, w, h, src);
        gl.useProgram(post);
        gl.uniform1i(post.u("u_texture"), 0);
        gl.uniform2f(post.u("u_resolution"), w, h);
        gl.uniform1f(post.u("u_time"), now / 1000);
        gl.uniform1f(post.u("u_details"), det);
        gl.uniform1f(post.u("u_destruction"), clamp01(s.destruction));
        gl.uniform4f(post.u("u_fx0"), s.bloom, s.noise, s.flicker, s.vignette);
        gl.uniform4f(post.u("u_fx1"), s.chromatic, clamp01(s.curvature), s.colorDrift, s.platform === "c64" ? s.artifacts : 0);
        gl.uniform1f(post.u("u_blur_px"), Math.max(1, (h / image.naturalHeight) * 0.5));
        gl.uniform1f(post.u("u_flicker_hz"), s.platform === "amiga" ? 50 : 60);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        meta(`${w}×${h} out · 3 passes (lite → ghost → post), ${image.naturalWidth}×${image.naturalHeight} source`);
      },
      dispose() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
    };
  },
};
