// cathode-js (js/src/cathode): preset matrix + grouped settings, `gl` or `fast` backend.
import { Cathode, Presets } from "../../src/index.js";
import { addGroup, select, button, commonButtons } from "./ui.js";

const RANGES = {
  geometry: [["curvature", 0, 0.5, 0.01], ["cornerRadius", 0, 0.2, 0.005], ["vignette", 0, 1, 0.01]],
  beam: [["scanlineIntensity", 0, 1, 0.01], ["scanlineCount", 60, 1080, 1], ["focus", 0.2, 3, 0.05]],
  phosphor: [["mask", 0, 1, 0.01], ["persistence", 0, 0.95, 0.01], ["bleed", 0, 0.5, 0.005]],
  signal: [["chromaticAberration", 0, 0.02, 0.0005], ["compositeArtifacts", 0, 1, 0.01],
    ["noise", 0, 1, 0.01], ["humBar", 0, 1, 0.01]],
  glass: [["bloom", 0, 1, 0.01], ["reflection", 0, 1, 0.01]],
};

const make = (backend) => ({
  id: `cathode-js-${backend}`,
  label: `cathode-js (${backend})`,
  async create({ canvas, top, root, meta }) {
    let complexity = "Detailed", quality = "Enhance";
    const cathode = new Cathode({ canvas, preset: Presets[complexity][quality], backend });
    await cathode.ready;
    const syncers = [];
    const load = () => { cathode.setPreset(Presets[complexity][quality]); syncAll(); };
    top.append(
      select(Object.keys(Presets), complexity, (v) => { complexity = v; load(); }),
      select(Object.keys(Presets.Simple), quality, (v) => { quality = v; load(); }),
      select(["aperture-grille", "shadow-mask", "dot-triad"], cathode.settings.phosphor.type,
        (v) => cathode.configure({ phosphor: { type: v } })),
      button("Reset", load),
      ...commonButtons("cathode-js", canvas, () => cathode.toJSON()),
    );
    for (const [group, rows] of Object.entries(RANGES)) {
      syncers.push(addGroup(root, group, rows.map(([key, min, max, step]) => ({
        label: key, min, max, step,
        get: () => cathode.settings[group][key] ?? min,
        set: (v) => cathode.configure({ [group]: { [key]: v } }),
      })), group !== "glass"));
    }
    function syncAll() { syncers.forEach((fn) => fn()); }
    return {
      useImage() {},
      draw(image, def, now) {
        cathode.source = image; // re-render each frame (animated noise / hum)
        cathode.render(now / 1000);
        meta(`backend ${cathode.backend.name} · ${canvas.width}×${canvas.height} out`);
      },
      dispose() { cathode.dispose(); },
    };
  },
});

export const cathodeGl = make("gl");
export const cathodeFast = make("fast");
