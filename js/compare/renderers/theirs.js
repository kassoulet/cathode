// crt-shader (npm, OutThisLife) — rendered synchronously every frame so its cost can be measured.
import { CRTRenderer, prepareInput, resolveSettings, PRESETS } from "crt-shader";
import { controlGroups } from "crt-shader/presets";
import { addGroup, select, button, commonButtons } from "./ui.js";

export default {
  id: "crt-shader",
  label: "crt-shader (npm)",
  async create({ canvas, top, root, meta }) {
    const renderer = new CRTRenderer();
    let preset = "reference";
    let settings = resolveSettings(preset);
    let inputMode = "pixel";
    let inputResolution = 96;
    const prepared = new Map();
    const syncers = [];

    const presetSelect = select(Object.keys(PRESETS), preset, (name) => {
      preset = name; settings = resolveSettings(name); syncAll();
    });
    const modeSelect = select(["pixel", "photo"], inputMode, (mode) => { inputMode = mode; });
    top.append(
      presetSelect, modeSelect,
      button("Reset", () => { settings = resolveSettings(preset); syncAll(); }),
      ...commonButtons("crt-shader", canvas, () => ({ preset, inputMode, inputResolution, settings })),
    );

    syncers.push(addGroup(root, "Input", [{
      label: "inputResolution (photo)", min: 16, max: 512, step: 1,
      get: () => inputResolution, set: (v) => { inputResolution = v; },
    }], true));
    controlGroups.forEach(([title, rows], index) => {
      syncers.push(addGroup(root, title, rows.map(([key, label, min, max, step]) => ({
        label, min, max, step, get: () => settings[key], set: (v) => { settings[key] = v; },
      })), index < 3));
    });
    function syncAll() { presetSelect.value = preset; syncers.forEach((fn) => fn()); }
    syncAll();

    let imageId = 0;
    let lastImage = null;
    return {
      gl: renderer.gl,
      useImage(def) { inputMode = def.mode; modeSelect.value = inputMode; },
      draw(image) {
        if (image !== lastImage) { lastImage = image; imageId++; }
        const rect = canvas.getBoundingClientRect();
        const key = `${imageId}:${inputMode}:${inputResolution}`;
        if (!prepared.has(key)) prepared.set(key, [prepareInput(image, { inputMode, inputResolution }), prepared.size + 1]);
        const [source, sourceVersion] = prepared.get(key);
        const width = Math.max(2, Math.round(rect.width * (Math.min(devicePixelRatio || 1, 2))));
        const height = Math.max(2, Math.round(rect.height * (Math.min(devicePixelRatio || 1, 2))));
        renderer.invalidate(source); // bypass the still-image cache; the pane is a benchmark
        renderer.render(source, canvas, resolveSettings(preset, settings), { width, height, sourceVersion });
        meta(`${width}×${height} out · mode ${inputMode}` +
          (inputMode === "photo" ? ` (${inputResolution}px longest edge)` : ` (${source.width}×${source.height})`));
      },
      dispose() { renderer.dispose(); },
    };
  },
};
