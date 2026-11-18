// Settings defaults, the preset YAML subset and asset/mask resolution.
//
// The numbers mirror the `crt:` section of the presets shipped in
// Toddler-Boy/CRTEmulation-Data (0..100 sliders) and Lime's host defaults.

export const PRESET_NAMES = [
  "Default",
  "SX-64",
  "VICE",
  "Cheap and broken TV",
  "C64 Ultimate HDMI",
];

export const MASKS = [
  "Slot Mask",
  "Shadow Mask",
  "Shadow Mask EDP",
  "Aperture Grille",
  "SX-64",
];

/** Defaults from lime_CRTEmulation.h, expressed as 0..1 like the rest. */
export const DEFAULT_SETTINGS = {
  // analogue signal (decoder)
  jailbars: 0.5,
  noise: 0.15,
  sharpening: 0.3,
  lumaBlur: 0.5,
  chromaBlur: 0.5,
  crosstalk: 0.2,
  phase: 22.5,
  hannover: 0.9,
  rainbowing: 0.5,
  drift: 0.2,

  // CRT render
  curve: 0.2,
  rotation: 0,
  bleed: 0.2,
  bleedRed: [0.5, -0.1],
  bleedGreen: [0.5, -0.1],
  bleedBlue: [0.5, -0.1],
  convergence: 0.2,
  hWave: 0.5,
  expansion: 1,
  scanlines: 0.25,
  mask: 0.25,
  maskBitmap: "Slot Mask",
  phosphorDecay: 0.6,
  vignette: 0.6,
  adjacent: 0.5,
  halation: 0.5,
  ambient: 0.6,

  // not in the YAML presets, but exposed by the module
  reflections: 0.25,
  overscan: 0,
  hum: 0,
  brightness: 0.5,
  contrast: 0.8,
  saturation: 0.5,
  tint: 0,

  // renderer side
  lines: 270,
  analog: "off",
};

const KEY_MAP = {
  jailbars: "jailbars",
  noise: "noise",
  sharpening: "sharpening",
  "luma-blur": "lumaBlur",
  "chroma-blur": "chromaBlur",
  crosstalk: "crosstalk",
  phase: "phase",
  hannover: "hannover",
  rainbowing: "rainbowing",
  drift: "drift",
  curve: "curve",
  rotation: "rotation",
  bleed: "bleed",
  "bleed-red": "bleedRed",
  "bleed-green": "bleedGreen",
  "bleed-blue": "bleedBlue",
  convergence: "convergence",
  "h-wave": "hWave",
  expansion: "expansion",
  scanlines: "scanlines",
  mask: "mask",
  "mask-bitmap": "maskBitmap",
  "phosphor-decay": "phosphorDecay",
  vignette: "vignette",
  adjacent: "adjacent",
  halation: "halation",
  ambient: "ambient",
  reflections: "reflections",
  overscan: "overscan",
  brightness: "brightness",
  contrast: "contrast",
  saturation: "saturation",
  tint: "tint",
  lines: "lines",
  "scanlines-count": "lines",
};

const PAIR_KEYS = new Set(["bleedRed", "bleedGreen", "bleedBlue"]);
const RAW_KEYS = new Set(["phase", "rotation"]);
const INT_KEYS = new Set(["lines"]);

/**
 * Parse the tiny YAML subset used by the data repository: a top-level
 * `crt:` mapping of `key: scalar-or-pair`.
 */
export function parsePresetYaml(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line === "crt:") continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    const name = KEY_MAP[key];
    if (!name) continue;

    if (name === "maskBitmap") {
      out.maskBitmap = value.replace(/^\$DATA\$\//, "");
    } else if (PAIR_KEYS.has(name)) {
      const [a, b] = value.split(",");
      out[name] = [toPercent(a), toPercent(b)];
    } else if (RAW_KEYS.has(name)) {
      out[name] = Number(value);
    } else if (INT_KEYS.has(name)) {
      out[name] = Math.round(Number(value));
    } else if (value === "true" || value === "false") {
      out[name] = value === "true";
    } else {
      out[name] = toPercent(value);
    }
  }
  return out;
}

function toPercent(value) {
  return Number(value) / 100;
}

export function normalizeAnalog(value) {
  switch (String(value ?? "off").toLowerCase()) {
    case "off":
    case "none":
    case "rgb":
      return "off";
    case "pal":
      return "pal";
    case "ntsc":
    case "yiq":
      return "ntsc";
    default:
      throw new Error(`cathode-fx: analog must be off, pal or ntsc (got ${value})`);
  }
}

/** Directory holding `Shaders/`, `CRT Masks/`, `Presets/` and `reflections.png`. */
export function resolveDataUrl(dataUrl) {
  if (dataUrl) {
    return new URL(dataUrl, document.baseURI).href;
  }
  // js/src -> repository root -> assets/crt
  return new URL("../../assets/crt/", import.meta.url).href;
}

/**
 * Locate the data directory. In the monorepo it lives at `assets/crt`; the
 * published package carries a copy at `js/assets/crt`.
 */
export async function detectDataUrl(dataUrl) {
  if (dataUrl) return resolveDataUrl(dataUrl);
  const candidates = [
    new URL("../assets/crt/", import.meta.url),
    new URL("../../assets/crt/", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const response = await fetch(
        new URL("Shaders/crt-simulation.glsl", candidate),
        { method: "HEAD" },
      );
      if (response.ok) return candidate.href;
    } catch {
      // Try the next candidate.
    }
  }
  return candidates[candidates.length - 1].href;
}

export async function loadPreset(dataUrl, name) {
  const url = new URL(`Presets/${encodeURIComponent(name)}.yml`, dataUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `cathode-fx: unknown preset '${name}' (HTTP ${response.status}); ` +
        `available: ${PRESET_NAMES.join(", ")}`,
    );
  }
  return parsePresetYaml(await response.text());
}

/**
 * Build the effective settings from a preset name and option overrides.
 * Overrides use the camelCase keys of DEFAULT_SETTINGS; kebab-case preset keys
 * are accepted too, and percentage values are given as 0..1.
 */
export async function resolveSettings(dataUrl, options = {}) {
  const settings = { ...DEFAULT_SETTINGS };

  const preset = options.preset ?? "Default";
  if (preset && typeof preset === "object") {
    for (const [key, value] of Object.entries(preset)) {
      applySetting(settings, key, value);
    }
  } else {
    Object.assign(settings, await loadPreset(dataUrl, String(preset)));
  }

  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    applySetting(settings, key, value);
  }

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in options) || key === "analog") continue;
    if (key === "mask" && typeof options.mask === "string") continue;
    if (options[key] === undefined) continue;
    applySetting(settings, key, options[key]);
  }
  if (typeof options.mask === "string") {
    settings.maskBitmap = options.mask;
  }
  if ("analog" in options) {
    settings.analog = normalizeAnalog(options.analog);
  }

  return settings;
}

export function applySetting(settings, key, value) {
  let name;
  if (key in DEFAULT_SETTINGS) {
    name = key;
  } else {
    const normalized = String(key).replace(/_/g, "-").toLowerCase();
    name = KEY_MAP[normalized] ?? normalized;
  }
  if (!(name in DEFAULT_SETTINGS)) {
    throw new Error(`cathode-fx: unknown setting '${key}'`);
  }
  if (name === "analog") {
    settings.analog = normalizeAnalog(value);
  } else if (name === "maskBitmap") {
    settings.maskBitmap = String(value);
  } else if (name === "lines") {
    settings.lines = Math.max(60, Math.min(1080, Math.round(Number(value))));
  } else if (PAIR_KEYS.has(name)) {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(`cathode-fx: ${key} expects [x, y]`);
    }
    settings[name] = [Number(value[0]), Number(value[1])];
  } else if (RAW_KEYS.has(name)) {
    settings[name] = Number(value);
  } else {
    settings[name] = Number(value);
  }
}

/** Resolve a mask name (or alias) to the PNG filename shipped by the data repo. */
export function maskFileName(name) {
  const wanted = String(name).trim().toLowerCase().replace(/_/g, " ");
  const aliases = {
    "aperture-grille": "Aperture Grille",
    "shadow-mask": "Shadow Mask",
    "shadow-mask-edp": "Shadow Mask EDP",
    "slot-mask": "Slot Mask",
    sx64: "SX-64",
  };
  const canonical = MASKS.find((mask) => mask.toLowerCase() === wanted);
  if (canonical) return `${canonical}.png`;
  if (aliases[wanted]) return `${aliases[wanted]}.png`;
  throw new Error(
    `cathode-fx: CRT mask '${name}' not found (have: ${MASKS.join(", ")})`,
  );
}
