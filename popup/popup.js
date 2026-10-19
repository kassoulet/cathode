(() => {
  const Cathode = globalThis.Cathode;
  if (!Cathode) return;

  const CONTROLS = [
    { key: 'curvature', label: 'Curvature', group: 'Screen', min: 0, max: 100, scale: 0.01 },
    { key: 'scanlines', label: 'Scanlines', group: 'Screen', min: 0, max: 100, scale: 0.01 },
    { key: 'grille', label: 'Shadow mask', group: 'Screen', min: 0, max: 100, scale: 0.01 },
    { key: 'vignette', label: 'Vignette', group: 'Screen', min: 0, max: 100, scale: 0.01 },
    { key: 'glow', label: 'Glow', group: 'Optics', min: 0, max: 100, scale: 0.01 },
    { key: 'aberration', label: 'Aberration', group: 'Optics', min: 0, max: 100, scale: 0.01 },
    { key: 'noise', label: 'Noise', group: 'Optics', min: 0, max: 50, scale: 0.01 },
    { key: 'flicker', label: 'Flicker', group: 'Optics', min: 0, max: 50, scale: 0.01 },
    { key: 'brightness', label: 'Brightness', group: 'Picture', min: 50, max: 150, scale: 0.01, suffix: '%' },
    { key: 'contrast', label: 'Contrast', group: 'Picture', min: 50, max: 150, scale: 0.01, suffix: '%' },
    { key: 'saturation', label: 'Saturation', group: 'Picture', min: 0, max: 200, scale: 0.01, suffix: '%' }
  ];

  const SAVE_DELAY = 900;

  const elements = {
    app: document.getElementById('app'),
    enabled: document.getElementById('enabled'),
    presets: document.getElementById('presets'),
    phosphor: document.getElementById('phosphor'),
    controls: document.getElementById('controls'),
    reset: document.getElementById('reset'),
    version: document.getElementById('version')
  };

  const sliders = new Map();
  const presetButtons = Array.from(elements.presets.querySelectorAll('button[data-preset]'));
  const phosphorButtons = Array.from(elements.phosphor.querySelectorAll('button[data-phosphor]'));

  let settings = { ...Cathode.DEFAULTS };
  let saveTimer = null;

  function displayValue(control, raw) {
    return raw + (control.suffix || '');
  }

  function setFill(input, control) {
    const value = Number(input.value);
    const percent = ((value - control.min) / (control.max - control.min)) * 100;
    input.style.setProperty('--fill', percent + '%');
  }

  function buildControls() {
    let group = '';

    for (const control of CONTROLS) {
      if (control.group !== group) {
        group = control.group;
        const heading = document.createElement('div');
        heading.className = 'section-label';
        heading.textContent = group;
        elements.controls.appendChild(heading);
      }

      const row = document.createElement('label');
      row.className = 'control';

      const head = document.createElement('div');
      head.className = 'control-head';

      const name = document.createElement('span');
      name.className = 'control-name';
      name.textContent = control.label;

      const value = document.createElement('span');
      value.className = 'control-value';

      head.append(name, value);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(control.min);
      input.max = String(control.max);
      input.step = '1';
      input.setAttribute('aria-label', control.label);

      input.addEventListener('input', () => {
        const next = Number(input.value) * control.scale;
        settings[control.key] = next;
        settings.preset = 'custom';
        value.textContent = displayValue(control, input.value);
        setFill(input, control);
        updateActiveStates();
        sendToActiveTab();
        scheduleSave();
      });

      input.addEventListener('change', () => {
        saveNow();
      });

      row.append(head, input);
      elements.controls.appendChild(row);

      sliders.set(control.key, { input, value, control });
    }
  }

  function syncUI() {
    elements.enabled.checked = settings.enabled;
    elements.app.classList.toggle('is-off', !settings.enabled);

    for (const [key, slider] of sliders) {
      const raw = Math.round(settings[key] / slider.control.scale);
      slider.input.value = String(raw);
      slider.value.textContent = displayValue(slider.control, raw);
      setFill(slider.input, slider.control);
    }

    updateActiveStates();
  }

  function updateActiveStates() {
    for (const button of presetButtons) {
      button.classList.toggle('is-active', button.dataset.preset === settings.preset);
    }
    for (const button of phosphorButtons) {
      button.classList.toggle('is-active', button.dataset.phosphor === settings.phosphor);
    }
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      chrome.storage.sync.set({ settings });
    } catch (error) {
      console.warn('[Cathode] Could not save settings:', error);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }

  let livePending = false;
  function sendToActiveTab() {
    if (livePending) return;
    livePending = true;
    requestAnimationFrame(() => {
      livePending = false;
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime.lastError) return;
          const tab = tabs && tabs[0];
          if (!tab || tab.id == null) return;
          chrome.tabs.sendMessage(
            tab.id,
            { type: 'cathode:settings', settings },
            () => void chrome.runtime.lastError
          );
        });
      } catch (error) {
        /* no reachable content script */
      }
    });
  }

  elements.enabled.addEventListener('change', () => {
    settings.enabled = elements.enabled.checked;
    elements.app.classList.toggle('is-off', !settings.enabled);
    sendToActiveTab();
    saveNow();
  });

  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      const preset = Cathode.PRESETS[button.dataset.preset];
      if (!preset) return;
      settings = Cathode.sanitize({
        ...settings,
        ...preset,
        preset: button.dataset.preset
      });
      syncUI();
      sendToActiveTab();
      saveNow();
    });
  }

  for (const button of phosphorButtons) {
    button.addEventListener('click', () => {
      const phosphor = button.dataset.phosphor;
      if (settings.phosphor === phosphor) return;
      settings.phosphor = phosphor;
      settings.preset = 'custom';
      syncUI();
      sendToActiveTab();
      saveNow();
    });
  }

  elements.reset.addEventListener('click', () => {
    settings = Cathode.sanitize({ ...Cathode.DEFAULTS, enabled: settings.enabled });
    syncUI();
    sendToActiveTab();
    saveNow();
  });

  try {
    elements.version.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (error) {
    /* version is optional */
  }

  buildControls();

  try {
    chrome.storage.sync.get('settings', (data) => {
      if (chrome.runtime.lastError) {
        syncUI();
        return;
      }
      settings = Cathode.sanitize(data && data.settings);
      syncUI();
    });
  } catch (error) {
    syncUI();
  }
})();
