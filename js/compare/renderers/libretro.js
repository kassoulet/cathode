// Runs libretro GLSL presets (.glslp) in WebGL2: crt-lottes, crt-geom, crt-easymode, crt-royale.
// Shaders and LUT masks are fetched at runtime from libretro/glsl-shaders (pinned commit), so no
// third-party (public-domain / GPL-2) shader code is vendored in this repo.
import { addGroup, select, button, commonButtons, fitCanvas } from "./ui.js";

const SHA = "a35069864b4bf30f8c8e740d57206543fb7e745e";
const BASE = `https://raw.githubusercontent.com/libretro/glsl-shaders/${SHA}/crt/`;

const text = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
};
const loadImage = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`cannot load ${url}`));
  image.src = url;
});

/** `key = "value" # comment` lines → object. */
function parsePreset(src) {
  const o = {};
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*"?([^"#\n]*?)"?\s*(?:#.*)?$/);
    if (m) o[m[1]] = m[2].trim();
  }
  return o;
}

const bool = (v) => v === "true" || v === "1";
const WRAP = (gl, m) => ({ repeat: gl.REPEAT, mirrored_repeat: gl.MIRRORED_REPEAT }[m] ?? gl.CLAMP_TO_EDGE);

function prepare(src, stage) {
  const body = src.replace(/^\s*#version.*$/m, "");
  return `#version 300 es\nprecision highp float;\nprecision highp int;\n#define ${stage}\n#define PARAMETER_UNIFORM\n${body}`;
}

function compile(gl, type, source, what) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${what}: ${gl.getShaderInfoLog(s)}`);
  return s;
}

async function loadPreset(gl, file) {
  const url = BASE + file;
  const P = parsePreset(await text(url));
  const n = Number(P.shaders);
  const rel = (p) => new URL(p, url).href;
  const sources = await Promise.all(Array.from({ length: n }, (_, i) => text(rel(P[`shader${i}`]))));
  const luts = {};
  await Promise.all((P.textures ?? "").split(";").filter(Boolean).map(async (name) => {
    const image = await loadImage(rel(P[name]));
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const mip = bool(P[`${name}_mipmap`]);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    const linear = P[`${name}_linear`] !== "false";
    const wrap = WRAP(gl, P[`${name}_wrap_mode`]);
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, wrap], [gl.TEXTURE_WRAP_T, wrap],
      [gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST],
      [gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : linear ? gl.LINEAR : gl.NEAREST]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    luts[name] = { tex: t, w: image.naturalWidth, h: image.naturalHeight };
  }));

  const params = {}; // name → {desc, def, min, max, step}
  const passes = sources.map((src, i) => {
    for (const m of src.matchAll(/^#pragma parameter\s+(\w+)\s+"([^"]*)"\s+(\S+)\s+(\S+)\s+(\S+)\s*(\S+)?/gm)) {
      params[m[1]] ??= { desc: m[2], def: +m[3], min: +m[4], max: +m[5], step: +(m[6] ?? 0.01) || 0.01 };
    }
    const last = i === n - 1;
    const type = (axis) => P[`scale_type_${axis}${i}`] ?? P[`scale_type${i}`] ?? (last ? "viewport" : "source");
    const scale = (axis) => Number(P[`scale_${axis}${i}`] ?? P[`scale${i}`] ?? 1);
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, prepare(src, "VERTEX"), `pass ${i} vertex`));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, prepare(src, "FRAGMENT"), `pass ${i} fragment`));
    gl.bindAttribLocation(prog, 0, "VertexCoord");
    gl.bindAttribLocation(prog, 1, "TexCoord");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`pass ${i}: ${gl.getProgramInfoLog(prog)}`);
    const uniforms = [];
    for (let u = 0; u < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); u++) {
      const info = gl.getActiveUniform(prog, u);
      uniforms.push({ name: info.name.replace(/\[0\]$/, ""), type: info.type, loc: gl.getUniformLocation(prog, info.name) });
    }
    return {
      prog, uniforms, last, alias: P[`alias${i}`], linear: bool(P[`filter_linear${i}`]),
      wrap: WRAP(gl, P[`wrap_mode${i}`]), srgb: bool(P[`srgb_framebuffer${i}`]),
      sx: [type("x"), scale("x")], sy: [type("y"), scale("y")],
      out: { tex: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 },
    };
  });
  // Parameter overrides set in the preset itself.
  for (const k of Object.keys(params)) if (P[k] !== undefined) params[k].def = Number(P[k]);
  return { passes, luts, params };
}

function create(file, id, label) {
  return {
    id, label,
    async create({ canvas, top, root, meta }) {
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
      if (!gl) throw new Error("WebGL2 unavailable");
      const { passes, luts, params } = await loadPreset(gl, file);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      // x, y, u, v (v up: the source is uploaded flipped, FBOs are bottom-up)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

      const source = { tex: gl.createTexture(), w: 1, h: 1 };
      let uploaded = null;
      let frameCount = 0;
      const values = Object.fromEntries(Object.entries(params).map(([k, p]) => [k, p.def]));
      const syncers = [];
      const names = Object.keys(params);
      if (names.length) {
        syncers.push(addGroup(root, "Parameters", names.map((k) => ({
          label: params[k].desc || k, min: params[k].min, max: params[k].max, step: params[k].step,
          get: () => values[k], set: (v) => { values[k] = v; },
        })), true));
      }
      top.append(button("Reset", () => { for (const k of names) values[k] = params[k].def; syncers.forEach((f) => f()); }),
        ...commonButtons(id, canvas, () => ({ preset: file, ...values })));
      syncers.forEach((f) => f());

      const setSampler = (t, filter, wrap, mip) => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ?? filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      };
      const nextLinear = (i) => (passes[i + 1] ?? passes[i]).linear;

      function resize(pass, i, inW, inH, vw, vh) {
        const dim = ([type, s], inSize, vSize) => Math.max(1, Math.round(type === "viewport" ? vSize * s : type === "absolute" ? s : inSize * s));
        const w = dim(pass.sx, inW, vw), h = dim(pass.sy, inH, vh);
        const o = pass.out;
        if (o.w !== w || o.h !== h) {
          gl.bindTexture(gl.TEXTURE_2D, o.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, pass.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          setSampler(o.tex, nextLinear(i) ? gl.LINEAR : gl.NEAREST, gl.CLAMP_TO_EDGE);
          gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, o.tex, 0);
          Object.assign(o, { w, h });
        }
        return o;
      }

      function run(image, vw, vh) {
        if (uploaded !== image) {
          gl.bindTexture(gl.TEXTURE_2D, source.tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          Object.assign(source, { w: image.naturalWidth ?? image.width, h: image.naturalHeight ?? image.height });
          uploaded = image;
        }
        setSampler(source.tex, passes[0].linear ? gl.LINEAR : gl.NEAREST, gl.CLAMP_TO_EDGE);
        const outs = []; // pass outputs so far
        const byName = (name) => {
          if (name === "Texture" || name === "Source") return outs.at(-1) ?? source;
          if (name === "Original" || name === "Orig") return source;
          name = name.replace(/Texture$/, "");
          let m = name.match(/^PassPrev(\d+)$/);
          if (m) return +m[1] === 0 ? (outs.at(-1) ?? source) : (outs.at(-(+m[1])) ?? source);
          m = name.match(/^Pass(\d+)$/);
          if (m) return outs[+m[1] - 1];
          const p = passes.findIndex((q) => q.alias === name);
          return p >= 0 && p < outs.length ? outs[p] : luts[name];
        };
        passes.forEach((pass, i) => {
          const input = outs.at(-1) ?? source;
          const out = pass.last ? { w: vw, h: vh, fbo: null } : resize(pass, i, input.w, input.h, vw, vh);
          gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
          gl.viewport(0, 0, out.w, out.h);
          gl.useProgram(pass.prog);
          let unit = 0;
          for (const u of pass.uniforms) {
            const { name, type, loc } = u;
            if (type === gl.SAMPLER_2D) {
              const t = byName(name);
              if (!t) continue;
              gl.activeTexture(gl.TEXTURE0 + unit);
              gl.bindTexture(gl.TEXTURE_2D, t.tex);
              gl.uniform1i(loc, unit++);
              continue;
            }
            if (name === "MVPMatrix") { gl.uniformMatrix4fv(loc, false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); continue; }
            if (name === "FrameCount") { type === gl.INT ? gl.uniform1i(loc, frameCount) : gl.uniform1f(loc, frameCount); continue; }
            if (name === "FrameDirection") { type === gl.INT ? gl.uniform1i(loc, 1) : gl.uniform1f(loc, 1); continue; }
            if (type === gl.FLOAT) { if (name in values) gl.uniform1f(loc, values[name]); continue; }
            if (type !== gl.FLOAT_VEC2 && type !== gl.FLOAT_VEC4) continue;
            const size = name === "OutputSize" ? out : name === "InputSize" || name === "TextureSize" ? input
              : /Size$/.test(name) ? byName(name.replace(/(Texture|Input)?Size$/, "")) : null;
            if (!size) continue;
            type === gl.FLOAT_VEC2 ? gl.uniform2f(loc, size.w, size.h) : gl.uniform4f(loc, size.w, size.h, 1 / size.w, 1 / size.h);
          }
          if (pass.wrap !== gl.CLAMP_TO_EDGE && input.tex) { gl.bindTexture(gl.TEXTURE_2D, input.tex); setSampler(input.tex, pass.linear ? gl.LINEAR : gl.NEAREST, pass.wrap); }
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          if (!pass.last) outs.push(out);
        });
        frameCount++;
      }

      return {
        useImage() {},
        draw(image) {
          const [w, h] = fitCanvas(canvas);
          run(image, w, h);
          meta(`${w}×${h} out · ${passes.length} pass${passes.length > 1 ? "es" : ""}`);
        },
        dispose() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
      };
    },
  };
}

export const lottes = create("crt-lottes.glslp", "libretro-lottes", "Lottes (libretro)");
export const geom = create("crt-geom.glslp", "libretro-geom", "crt-geom (libretro)");
export const easymode = create("crt-easymode.glslp", "libretro-easymode", "crt-easymode (libretro)");
export const royale = create("crt-royale.glslp", "libretro-royale", "crt-royale (libretro)");
