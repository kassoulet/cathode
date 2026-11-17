// Small DOM helpers shared by the renderer adapters.
export const decimals = (step) => (step >= 1 ? 0 : (String(step).split(".")[1] ?? "").length);

/** Build a group of sliders; returns a function that re-reads all values. */
export function addGroup(parent, title, entries, open = false) {
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

export function select(options, value, onChange) {
  const el = document.createElement("select");
  for (const option of options) {
    const [val, text] = Array.isArray(option) ? option : [option, option];
    el.add(new Option(text, val));
  }
  el.value = value;
  el.addEventListener("change", () => onChange(el.value));
  return el;
}

export function button(text, onClick) {
  const el = document.createElement("button");
  el.className = "btn";
  el.textContent = text;
  el.addEventListener("click", onClick);
  return el;
}

export function download(href, name) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
}

export const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

/** Standard "Save PNG" + "Copy settings" buttons. `canvas` must have been drawn this frame. */
export const commonButtons = (name, canvas, getSettings, beforeSave = () => {}) => [
  button("Save PNG", () => { beforeSave(); download(canvas.toDataURL("image/png"), `${name}-${Date.now()}.png`); }),
  button("Copy settings", () => navigator.clipboard.writeText(JSON.stringify(getSettings(), null, 2))),
];

export function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

/** Link a program; attributes bound by name to locations in order. */
export function program(gl, vs, fs, attribs = ["a_pos"]) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const locs = {};
  p.u = (name) => (locs[name] ??= gl.getUniformLocation(p, name));
  return p;
}

/** Full-screen quad as a TRIANGLE_STRIP in attribute 0 (4 vertices). */
export function bindQuad(gl) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

/** Size the canvas backing store to its CSS box; returns [w, h]. */
export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(2, Math.round(rect.width * dpr()));
  const h = Math.max(2, Math.round(rect.height * dpr()));
  if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  return [w, h];
}
