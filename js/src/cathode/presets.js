// Presets = Complexity × Quality, composed from two small tables (specs.md "Core Preset Matrix").
import { DEFAULTS, merge } from "./settings.js";

// What each quality tier looks like (the monitor being emulated).
const QUALITY = {
  clean: { // studio monitor: sharp, perfect geometry
    geometry: { curvature: 0, cornerRadius: 0, vignette: 0.1 },
    beam: { scanlineIntensity: 0.3, focus: 1.6 },
    phosphor: { persistence: 0, bleed: 0, mask: 0.15 },
    signal: { chromaticAberration: 0, noise: 0 },
    glass: { bloom: 0.15, reflection: 0 },
  },
  enhance: { // arcade / 90s RGB monitor: warm glow, light mask, mild curve
    geometry: { curvature: 0.12, cornerRadius: 0.05, vignette: 0.35 },
    beam: { scanlineIntensity: 0.4, focus: 1.2 },
    phosphor: { persistence: 0.25, bleed: 0.08, mask: 0.3 },
    signal: { chromaticAberration: 0.002, noise: 0.02 },
    glass: { bloom: 0.45, reflection: 0.1 },
  },
  degrade: { // consumer RF/composite TV: artifacts, bleed, warp, hum
    geometry: { curvature: 0.25, cornerRadius: 0.08, vignette: 0.6 },
    beam: { scanlineIntensity: 0.55, focus: 0.8 },
    phosphor: { persistence: 0.6, bleed: 0.15, mask: 0.35 },
    signal: { chromaticAberration: 0.005, compositeArtifacts: 0.6, noise: 0.25, humBar: 0.2, analog: "ntsc" },
    glass: { bloom: 0.6, reflection: 0.3 },
  },
};

// Which parts of the quality tier the complexity level actually switches on.
const COMPLEXITY = {
  simple: (q) => ({ // 1 pass: scanlines, mild bloom, vignette
    geometry: { ...q.geometry, curvature: 0 },
    beam: q.beam,
    phosphor: { type: "aperture-grille", mask: 0, persistence: 0, bleed: 0 },
    signal: { chromaticAberration: 0, compositeArtifacts: 0, noise: 0, humBar: 0, analog: "off" },
    glass: { bloom: q.glass.bloom / 2, reflection: 0 },
  }),
  detailed: (q) => ({ // + triad mask, beam blur, barrel warp, aberration; no signal/temporal
    geometry: q.geometry,
    beam: q.beam,
    phosphor: { ...q.phosphor, persistence: 0 },
    signal: { chromaticAberration: q.signal.chromaticAberration, compositeArtifacts: 0, noise: 0, humBar: 0, analog: "off" },
    glass: { ...q.glass, reflection: 0 },
  }),
  exhaustive: (q) => q, // everything
};

export const Presets = {};
for (const [complexity, build] of Object.entries(COMPLEXITY)) {
  const group = (Presets[complexity[0].toUpperCase() + complexity.slice(1)] = {});
  for (const [quality, tier] of Object.entries(QUALITY)) {
    group[quality[0].toUpperCase() + quality.slice(1)] = Object.freeze(merge(DEFAULTS, build(tier)));
  }
}

/** Look a preset up by the spec's lowercase `{complexity, tier}` pair. */
export function presetFor({ complexity, tier }) {
  const cap = (v) => String(v)[0].toUpperCase() + String(v).slice(1);
  const preset = Presets[cap(complexity)]?.[cap(tier)];
  if (!preset) throw new Error(`cathode: unknown preset ${complexity}/${tier}`);
  return preset;
}
