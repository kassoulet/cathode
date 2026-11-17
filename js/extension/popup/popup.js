import { COMPLEXITY, TIER, DEFAULTS, sanitize } from '../src/settings.js';

// [group, key, label, min, max, step]
const CONTROLS = [
  ['geometry', 'curvature', 'Curvature', 0, 0.5, 0.01],
  ['geometry', 'vignette', 'Vignette', 0, 1, 0.01],
  ['beam', 'scanlineIntensity', 'Scanlines', 0, 1, 0.01],
  ['beam', 'focus', 'Focus', 0.2, 3, 0.05],
  ['phosphor', 'mask', 'Phosphor mask', 0, 1, 0.01],
  ['phosphor', 'persistence', 'Afterglow', 0, 0.95, 0.01],
  ['glass', 'bloom', 'Bloom', 0, 1, 0.01],
  ['glass', 'reflection', 'Glass reflection', 0, 1, 0.01],
  ['signal', 'chromaticAberration', 'Aberration', 0, 0.02, 0.0005],
  ['signal', 'compositeArtifacts', 'NTSC fringing', 0, 1, 0.01],
  ['signal', 'noise', 'Noise', 0, 1, 0.01],
  ['signal', 'humBar', 'AC hum', 0, 1, 0.01],
];

const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };
let saveTimer = 0;

function buttons(container, values, key) {
  for (const value of values) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = value;
    b.textContent = value[0].toUpperCase() + value.slice(1);
    b.addEventListener('click', () => { settings = { ...settings, [key]: value, overrides: {} }; update(true); });
    container.append(b);
  }
}

const sliders = CONTROLS.map(([group, key, label, min, max, step]) => {
  const row = document.createElement('label');
  row.className = 'control';
  const head = Object.assign(document.createElement('div'), { className: 'control-head' });
  head.append(Object.assign(document.createElement('span'), { className: 'control-name', textContent: label }),
    Object.assign(document.createElement('span'), { className: 'control-value' }));
  row.append(head);
  const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step });
  input.addEventListener('input', () => {
    settings.overrides = { ...settings.overrides, [group]: { ...settings.overrides[group], [key]: Number(input.value) } };
    update(true, false);
    show(input, row, Number(input.value));
  });
  input.addEventListener('change', save);
  row.append(input);
  $('controls').append(row);
  return { group, key, input, row };
});

const show = (input, row, v) => {
  row.querySelector('.control-value').textContent = String(Number(v.toFixed(4)));
  input.style.setProperty('--fill', `${((v - input.min) / (input.max - input.min)) * 100}%`);
};

// Slider positions come from the preset the content script would build; the popup only
// knows overrides, so unset sliders show the preset's value via the shared core.
async function presetValues() {
  const { presetFor } = await import('../core/cathode/presets.js');
  return presetFor(settings);
}

async function update(persist, redrawSliders = true) {
  $('enabled').checked = settings.enabled;
  $('app').classList.toggle('is-off', !settings.enabled);
  for (const b of $('complexity').children) b.classList.toggle('is-active', b.dataset.value === settings.complexity);
  for (const b of $('tier').children) b.classList.toggle('is-active', b.dataset.value === settings.tier);
  if (redrawSliders) {
    const base = await presetValues();
    for (const { group, key, input, row } of sliders) {
      const v = settings.overrides[group]?.[key] ?? base[group][key] ?? 0;
      input.value = v;
      show(input, row, Number(input.value));
    }
  }
  if (persist) { send(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 900); }
}

function save() { clearTimeout(saveTimer); try { chrome.storage.sync.set({ settings }); } catch {} }

function send() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs?.[0]?.id != null) chrome.tabs.sendMessage(tabs[0].id, { type: 'cathode:settings', settings }, () => void chrome.runtime.lastError);
    });
  } catch {}
}

buttons($('complexity'), COMPLEXITY, 'complexity');
buttons($('tier'), TIER, 'tier');
$('enabled').addEventListener('change', (e) => { settings = { ...settings, enabled: e.target.checked }; update(true); save(); });
$('reset').addEventListener('click', () => { settings = { ...DEFAULTS, enabled: settings.enabled }; update(true); save(); });
$('version').textContent = `v${chrome.runtime.getManifest().version}`;
chrome.storage.sync.get('settings', (data) => { settings = sanitize(data?.settings); update(false); });
