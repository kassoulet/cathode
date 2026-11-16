// Minimal WebGL2 helpers used by the CRT pipeline.

const TEXTURE_2D = 0x0de1;

export function getContext(canvas, attributes = {}) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
    ...attributes,
  });
  if (!gl) {
    throw new Error("crt-canvas: WebGL2 is not available in this browser");
  }
  if (!gl.getExtension("EXT_color_buffer_float")) {
    throw new Error(
      "crt-canvas: EXT_color_buffer_float is required (RGBA16F render targets)",
    );
  }
  return gl;
}

function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`crt-canvas: compiling ${label} failed:\n${log}`);
  }
  return shader;
}

export class Program {
  constructor(gl, vertexSource, fragmentSource, label = "program") {
    this.gl = gl;
    this.label = label;
    this.locations = new Map();

    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, `${label} (vertex)`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} (fragment)`);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`crt-canvas: linking ${label} failed:\n${log}`);
    }
    this.program = program;
  }

  use() {
    this.gl.useProgram(this.program);
    return this;
  }

  loc(name) {
    if (!this.locations.has(name)) {
      this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.locations.get(name);
  }

  f32(name, value) {
    const loc = this.loc(name);
    if (loc) this.gl.uniform1f(loc, value);
    return this;
  }

  i32(name, value) {
    const loc = this.loc(name);
    if (loc) this.gl.uniform1i(loc, value);
    return this;
  }

  bool(name, value) {
    return this.i32(name, value ? 1 : 0);
  }

  vec2(name, x, y) {
    const loc = this.loc(name);
    if (loc) this.gl.uniform2f(loc, x, y);
    return this;
  }

  vec3(name, x, y, z) {
    const loc = this.loc(name);
    if (loc) this.gl.uniform3f(loc, x, y, z);
    return this;
  }

  vec3v(name, value) {
    return this.vec3(name, value[0], value[1], value[2]);
  }

  mat2(name, value) {
    const loc = this.loc(name);
    if (loc) this.gl.uniformMatrix2fv(loc, false, value);
    return this;
  }

  sampler(name, unit) {
    return this.i32(name, unit);
  }

  resolution(width, height) {
    return this.vec2("iResolution", width, height);
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.locations.clear();
  }
}

export function createTexture(
  gl,
  {
    width,
    height,
    internalFormat = gl.RGBA8,
    format = gl.RGBA,
    type = gl.UNSIGNED_BYTE,
    filter = gl.LINEAR,
    wrap = gl.CLAMP_TO_EDGE,
    mipmaps = false,
  } = {},
) {  const texture = gl.createTexture();
  gl.bindTexture(TEXTURE_2D, texture);

  const levels = mipmaps
    ? 1 + Math.floor(Math.log2(Math.max(width, height)))
    : 1;
  gl.texStorage2D(TEXTURE_2D, levels, internalFormat, width, height);

  gl.texParameteri(TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(
    TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    mipmaps ? gl.LINEAR_MIPMAP_LINEAR : filter,
  );
  gl.texParameteri(TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

  gl.bindTexture(TEXTURE_2D, null);
  return { texture, width, height, levels, mipmaps };
}

export function uploadImage(gl, target, image) {
  gl.bindTexture(TEXTURE_2D, target.texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texSubImage2D(
    TEXTURE_2D,
    0,
    0,
    0,
    target.width,
    target.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    image,
  );
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (target.mipmaps) gl.generateMipmap(TEXTURE_2D);
  gl.bindTexture(TEXTURE_2D, null);
}

export function uploadCanvas(gl, target, canvas) {
  gl.bindTexture(TEXTURE_2D, target.texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texSubImage2D(
    TEXTURE_2D,
    0,
    0,
    0,
    target.width,
    target.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    canvas,
  );
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(TEXTURE_2D);
  gl.bindTexture(TEXTURE_2D, null);
}

export class Target {
  constructor(
    gl,
    width,
    height,
    internalFormat,
    format,
    type,
    { mipmaps = false, filter = gl.LINEAR } = {},
  ) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.mipmaps = mipmaps;
    this.texture = createTexture(gl, {
      width,
      height,
      internalFormat,
      format,
      type,
      filter,
      wrap: gl.CLAMP_TO_EDGE, // WebGL2 has no CLAMP_TO_BORDER
      mipmaps,
    });

    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      TEXTURE_2D,
      this.texture.texture,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `crt-canvas: incomplete framebuffer (${status.toString(16)})`,
      );
    }
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
  }

  generateMipmaps() {
    if (!this.mipmaps) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(TEXTURE_2D, this.texture.texture);
    gl.generateMipmap(TEXTURE_2D);
    gl.bindTexture(TEXTURE_2D, null);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.texture.texture);
  }
}

export class Quad {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
  }
}

export function bindTexture(gl, program, name, unit, texture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(TEXTURE_2D, texture);
  program.sampler(name, unit);
}

export function readPixels(gl, width, height) {
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** Flip a bottom-up RGBA buffer (as returned by readPixels) for canvas use. */
export function flipRows(pixels, width, height) {
  const row = width * 4;
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * row;
    out.set(pixels.subarray(src, src + row), y * row);
  }
  return out;
}
