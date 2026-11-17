// Stored extension settings: { enabled, complexity, tier, overrides } where `overrides` is a
// partial Cathode config (group → key → value) layered on top of the preset.
export const COMPLEXITY = ['simple', 'detailed', 'exhaustive'];
export const TIER = ['clean', 'enhance', 'degrade'];
export const DEFAULTS = { enabled: true, complexity: 'detailed', tier: 'enhance', overrides: {} };

export function sanitize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: s.enabled !== false,
    complexity: COMPLEXITY.includes(s.complexity) ? s.complexity : DEFAULTS.complexity,
    tier: TIER.includes(s.tier) ? s.tier : DEFAULTS.tier,
    overrides: s.overrides && typeof s.overrides === 'object' ? s.overrides : {},
  };
}

/** Settings → Cathode `preset` option. */
export const toPreset = (s) => ({ complexity: s.complexity, tier: s.tier, ...s.overrides });
