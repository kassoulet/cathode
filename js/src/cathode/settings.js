// Grouped Cathode settings (see specs.md) and their mapping to crt-canvas' flat settings.

export const DEFAULTS = {
  // aspectRatio: undefined = follow the source (the spec's 4:3 default would distort 16:9 video)
  geometry: { curvature: 0.12, cornerRadius: 0.05, vignette: 0.3, aspectRatio: undefined },
  beam: { scanlineIntensity: 0.35, scanlineCount: 0, focus: 1.2 }, // scanlineCount 0 = auto
  phosphor: { type: "aperture-grille", mask: 0.25, persistence: 0.15, bleed: 0.08 },
  signal: { chromaticAberration: 0.003, compositeArtifacts: 0, noise: 0.02, humBar: 0, analog: "off" },
  // Extension to the spec: glass/bloom knobs the multi-pass pipeline exposes.
  glass: { bloom: 0.3, reflection: 0.1 },
};

/** Deep-merge `patch` into a copy of `base` (two levels: group → key). */
export function merge(base, patch = {}) {
  if (patch.beam?.beamSharpness !== undefined) { // pre-spec name
    patch = { ...patch, beam: { focus: patch.beam.beamSharpness, ...patch.beam } };
    delete patch.beam.beamSharpness;
  }
  const out = {};
  for (const group of Object.keys({ ...base, ...patch })) {
    out[group] = { ...base[group], ...patch[group] };
  }
  return out;
}

const MASK_FILES = {
  "aperture-grille": "Aperture Grille",
  "shadow-mask": "Shadow Mask",
  "dot-triad": "Shadow Mask EDP",
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Cathode settings → crt-canvas `setOptions` patch. `lines` is left to the backend when auto. */
export function toCrtCanvas(s) {
  const analog = s.signal.analog !== "off" ? s.signal.analog : s.signal.compositeArtifacts > 0 ? "ntsc" : "off";
  const patch = {
    curve: s.geometry.curvature,
    vignette: clamp01(s.geometry.vignette),
    scanlines: s.beam.scanlineIntensity,
    bleed: clamp01(0.5 / Math.max(s.beam.focus, 0.1) - 0.1),
    mask: s.phosphor.mask,
    maskBitmap: MASK_FILES[s.phosphor.type] ?? MASK_FILES["aperture-grille"],
    phosphorDecay: s.phosphor.persistence,
    adjacent: s.phosphor.bleed * 4,
    convergence: clamp01(s.signal.chromaticAberration * 60),
    crosstalk: s.signal.compositeArtifacts,
    rainbowing: s.signal.compositeArtifacts,
    noise: s.signal.noise,
    halation: s.glass.bloom,
    reflections: s.glass.reflection,
    reflection: s.glass.reflection > 0,
    hum: s.signal.humBar,
  };
  if (s.beam.scanlineCount) patch.lines = s.beam.scanlineCount;
  return { patch, analog };
}
