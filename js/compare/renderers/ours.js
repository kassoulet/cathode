// crt-canvas (this repo, CRTEmulation-Data shaders).
import { createCRT, MASKS, PRESET_NAMES } from "../../src/index.js";
import { addGroup, select, button } from "./ui.js";

const GROUPS = [
  ["Signal (needs PAL/NTSC)", [
    ["jailbars"], ["noise"], ["sharpening"], ["lumaBlur"], ["chromaBlur"],
    ["crosstalk"], ["phase", 0, 45, 0.5], ["hannover"], ["rainbowing"], ["drift"],
  ]],
  ["Geometry & beam", [
    ["curve"], ["rotation", -100, 100, 1], ["bleed"], ["convergence"], ["hWave"],
    ["expansion", 0, 2], ["scanlines"],
  ]],
  ["Phosphor & glass", [
    ["mask"], ["phosphorDecay"], ["vignette"], ["adjacent"], ["halation"],
    ["ambient"], ["reflections"], ["overscan"],
  ]],
  ["Picture", [["brightness"], ["contrast"], ["saturation"], ["tint", -1, 1]]],
];

export default {
  id: "crt-canvas",
  label: "crt-canvas (this repo)",
  async create({ canvas, top, root, meta }) {
    const crt = await createCRT(canvas, { preset: "Default", lines: 270 });
    let preset = "Default";
    const syncers = [];

    const presetSelect = select(PRESET_NAMES, preset, async (name) => {
      preset = name;
      await crt.setPreset(name);
      syncAll();
    });
    const maskSelect = select(MASKS, crt.settings.maskBitmap, (name) => crt.setMask(name));
    const analogSelect = select(
      [["off", "RGB (clean)"], ["pal", "PAL"], ["ntsc", "NTSC"]],
      crt.settings.analog, (mode) => crt.setAnalog(mode),
    );
    const reflection = document.createElement("label");
    reflection.innerHTML = `<input type="checkbox" checked> glass reflection`;
    reflection.firstChild.addEventListener("change", (e) => crt.setReflection(e.target.checked));
    let save = false; // snapshot on next frame (drawing buffer is cleared after compositing)
    top.append(
      presetSelect, maskSelect, analogSelect, reflection,
      button("Reset", async () => { await crt.setPreset(preset); syncAll(); }),
      button("Save PNG", () => { save = true; }),
      button("Copy settings", () => navigator.clipboard.writeText(JSON.stringify(crt.settings, null, 2))),
    );

    syncers.push(addGroup(root, "Scanlines", [{
      label: "lines", min: 60, max: 1080, step: 1,
      get: () => crt.settings.lines, set: (v) => crt.setOptions({ lines: v }),
    }], true));
    for (const [title, keys] of GROUPS) {
      syncers.push(addGroup(root, title, keys.map(([key, min = 0, max = 1, step = 0.01]) => ({
        label: key, min, max, step,
        get: () => crt.settings[key], set: (v) => crt.setOptions({ [key]: v }),
      })), title === "Geometry & beam"));
    }
    syncers.push(addGroup(root, "Colour fringing (x, y)", ["bleedRed", "bleedGreen", "bleedBlue"].flatMap((key) =>
      [0, 1].map((i) => ({
        label: `${key} ${i ? "y" : "x"}`, min: -1, max: 1, step: 0.01,
        get: () => crt.settings[key][i],
        set: (v) => { const pair = [...crt.settings[key]]; pair[i] = v; crt.setOptions({ [key]: pair }); },
      })))));

    function syncAll() {
      maskSelect.value = crt.settings.maskBitmap;
      analogSelect.value = crt.settings.analog;
      syncers.forEach((fn) => fn());
    }
    syncAll();

    return {
      useImage(def) { crt.setOptions({ lines: def.lines }); syncAll(); },
      draw(image, def, now) {
        crt.render(image, now / 1000);
        if (save) {
          save = false;
          const a = document.createElement("a");
          a.href = canvas.toDataURL("image/png");
          a.download = `crt-canvas-${Date.now()}.png`;
          a.click();
        }
        meta(`${crt.width}×${crt.height} CRT · ${crt.nativeWidth}×${crt.nativeHeight} source · ${canvas.width}×${canvas.height} out`);
      },
      dispose() { crt.dispose?.(); },
    };
  },
};
