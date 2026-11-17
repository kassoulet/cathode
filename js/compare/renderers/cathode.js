// cathode (YouTube CRT overlay): single-pass WebGL1 shader, shader/presets extracted verbatim.
import { DEFAULTS, PRESETS, PHOSPHORS, RANGES, VERTEX, FRAGMENT } from "./cathode-data.js";
import { addGroup, select, commonButtons, program, bindQuad, fitCanvas, button } from "./ui.js";

const FLOATS = ["curvature", "scanlines", "grille", "glow", "aberration", "vignette", "noise",
  "flicker", "brightness", "contrast", "saturation"];

export default {
  id: "cathode",
  label: "cathode (YouTube overlay)",
  async create({ canvas, top, root, meta }) {
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL unavailable");
    const prog = program(gl, VERTEX, FRAGMENT, ["a_position"]);
    gl.useProgram(prog);
    bindQuad(gl);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(prog.u("u_texture"), 0);

    let settings = { ...DEFAULTS, ...PRESETS.classic };
    let uploaded = null;
    const syncers = [];
    const presetSelect = select(Object.keys(PRESETS), "classic", (name) => {
      settings = { ...DEFAULTS, ...PRESETS[name] }; syncAll();
    });
    const phosphorSelect = select(Object.keys(PHOSPHORS), settings.phosphor, (name) => { settings.phosphor = name; });
    top.append(presetSelect, phosphorSelect,
      button("Reset", () => { settings = { ...DEFAULTS, ...PRESETS[presetSelect.value] }; syncAll(); }),
      ...commonButtons("cathode", canvas, () => settings));
    syncers.push(addGroup(root, "Effects", FLOATS.map((key) => ({
      label: key, min: RANGES[key][0], max: RANGES[key][1], step: 0.01,
      get: () => settings[key], set: (v) => { settings[key] = v; },
    })), true));
    function syncAll() { phosphorSelect.value = settings.phosphor; syncers.forEach((fn) => fn()); }
    syncAll();

    return {
      useImage() {},
      draw(image, def, now) {
        const [w, h] = fitCanvas(canvas);
        gl.viewport(0, 0, w, h);
        if (uploaded !== image) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          uploaded = image;
        }
        const u = (n) => prog.u(`u_${n}`);
        const ph = PHOSPHORS[settings.phosphor] ?? PHOSPHORS.color;
        gl.uniform2f(u("resolution"), w, h);
        gl.uniform1f(u("time"), now / 1000);
        for (const key of FLOATS) gl.uniform1f(u(key), settings[key]);
        gl.uniform1f(u("video_aspect"), image.naturalWidth / image.naturalHeight);
        gl.uniform1f(u("output_aspect"), w / h);
        gl.uniform1f(u("phosphor"), ph.mono);
        gl.uniform3f(u("tint"), ...ph.tint);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        meta(`${w}×${h} out · single pass, ${image.naturalWidth}×${image.naturalHeight} source`);
      },
      dispose() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
    };
  },
};
