// crt-shader (npm, OutThisLife) — a still-image renderer, redrawn only when dirty.
import { createRuntime, prepareInput, resolveSettings, PRESETS } from "crt-shader";
import { controlGroups } from "crt-shader/presets";
import { addGroup, select, button, commonButtons, fitCanvas } from "./ui.js";

export default {
  id: "crt-shader",
  label: "crt-shader (npm)",
  async create({ canvas, top, root, meta, error }) {
    const runtime = createRuntime();
    let preset = "reference";
    let settings = resolveSettings(preset);
    let inputMode = "pixel";
    let inputResolution = 96;
    const prepared = new Map();
    let dirty = true;
    let busy = false;
    let lastKey = "";
    let lastSize = "";
    const syncers = [];
    const touch = () => { dirty = true; };

    const presetSelect = select(Object.keys(PRESETS), preset, (name) => {
      preset = name; settings = resolveSettings(name); syncAll(); touch();
    });
    const modeSelect = select(["pixel", "photo"], inputMode, (mode) => { inputMode = mode; touch(); });
    top.append(
      presetSelect, modeSelect,
      button("Reset", () => { settings = resolveSettings(preset); syncAll(); touch(); }),
      ...commonButtons("crt-shader", canvas, () => ({ preset, inputMode, inputResolution, settings })),
    );

    syncers.push(addGroup(root, "Input", [{
      label: "inputResolution (photo)", min: 16, max: 512, step: 1,
      get: () => inputResolution, set: (v) => { inputResolution = v; touch(); },
    }], true));
    controlGroups.forEach(([title, rows], index) => {
      syncers.push(addGroup(root, title, rows.map(([key, label, min, max, step]) => ({
        label, min, max, step, get: () => settings[key], set: (v) => { settings[key] = v; touch(); },
      })), index < 3));
    });
    function syncAll() { presetSelect.value = preset; syncers.forEach((fn) => fn()); }
    syncAll();

    let imageId = 0;
    let lastImage = null;
    return {
      useImage(def) { inputMode = def.mode; modeSelect.value = inputMode; touch(); },
      draw(image) {
        if (image !== lastImage) { lastImage = image; imageId++; touch(); }
        const rect = canvas.getBoundingClientRect();
        const size = `${rect.width}x${rect.height}`;
        if (size !== lastSize) { lastSize = size; touch(); }
        if (!dirty || busy) return;
        dirty = false;
        busy = true;
        const key = `${imageId}:${inputMode}:${inputResolution}`;
        if (!prepared.has(key)) prepared.set(key, [prepareInput(image, { inputMode, inputResolution }), prepared.size + 1]);
        const [source, sourceVersion] = prepared.get(key);
        const width = Math.max(2, Math.round(rect.width * (Math.min(devicePixelRatio || 1, 2))));
        const height = Math.max(2, Math.round(rect.height * (Math.min(devicePixelRatio || 1, 2))));
        runtime.render({ source, output: canvas, width, height, preset, settings: { ...settings }, sourceVersion })
          .then(() => meta(`${width}×${height} out · mode ${inputMode}` +
            (inputMode === "photo" ? ` (${inputResolution}px longest edge)` : ` (${source.width}×${source.height})`)))
          .catch((e) => { if (e?.name !== "AbortError") error(e); })
          .finally(() => { busy = false; });
      },
      dispose() { runtime.dispose?.(); },
    };
  },
};
