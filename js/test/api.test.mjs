import test from "node:test";
import assert from "node:assert/strict";
import { Presets, Cathode, PRESET_NAMES, MASKS, normalizeAnalog, maskFileName, parsePresetYaml } from "../src/index.js";
import { presetFor } from "../src/cathode/presets.js";
import { merge, DEFAULTS, toCrtCanvas } from "../src/cathode/settings.js";

test("exports", () => {
  assert.equal(typeof Cathode, "function");
  assert.ok(PRESET_NAMES.includes("Default"));
  assert.ok(MASKS.includes("Aperture Grille"));
});

test("preset matrix has 9 frozen presets", () => {
  for (const c of ["Simple", "Detailed", "Exhaustive"]) {
    for (const t of ["Clean", "Enhance", "Degrade"]) assert.ok(Object.isFrozen(Presets[c][t]), `${c}.${t}`);
  }
  assert.equal(presetFor({ complexity: "detailed", tier: "enhance" }), Presets.Detailed.Enhance);
  assert.throws(() => presetFor({ complexity: "x", tier: "enhance" }), /unknown preset/);
});

test("simple has no mask or persistence, exhaustive has hum", () => {
  assert.equal(Presets.Simple.Degrade.phosphor.mask, 0);
  assert.equal(Presets.Simple.Degrade.phosphor.persistence, 0);
  assert.ok(Presets.Exhaustive.Degrade.signal.humBar > 0 || Presets.Exhaustive.Degrade.phosphor.persistence > 0);
});

test("merge keeps other keys and aliases beamSharpness", () => {
  const m = merge(DEFAULTS, { beam: { beamSharpness: 2 }, signal: { noise: 0.5 } });
  assert.equal(m.beam.focus, 2);
  assert.equal(m.beam.scanlineIntensity, DEFAULTS.beam.scanlineIntensity);
  assert.equal(m.signal.noise, 0.5);
});

test("toCrtCanvas maps settings", () => {
  const { patch, analog } = toCrtCanvas(merge(DEFAULTS, { signal: { humBar: 0.4, compositeArtifacts: 0.2 } }));
  assert.equal(patch.hum, 0.4);
  assert.equal(analog, "ntsc");
  assert.equal(patch.lines, undefined); // scanlineCount 0 = auto
});

test("unsupported backends throw before touching the DOM", () => {
  assert.throws(() => new Cathode({ backend: "sw" }), /not implemented/);
  assert.throws(() => new Cathode({ backend: "wgpu" }), /not implemented/);
});

test("analog, mask names and preset yaml", () => {
  assert.equal(normalizeAnalog("RGB"), "off");
  assert.equal(normalizeAnalog("yiq"), "ntsc");
  assert.throws(() => normalizeAnalog("secam"), /analog must be/);
  assert.equal(maskFileName("aperture-grille"), "Aperture Grille.png");
  assert.equal(typeof parsePresetYaml("crt:\n  noise: 0.5\n"), "object");
});
