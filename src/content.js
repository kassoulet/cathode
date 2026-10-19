(() => {
  const Cathode = globalThis.Cathode;
  if (!Cathode || !Cathode.Renderer || window.__cathodeLoaded) return;
  window.__cathodeLoaded = true;

  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 120;

  let settings = { ...Cathode.DEFAULTS };
  let renderer = null;
  let retryAt = 0;
  let toastEl = null;
  let toastTimer = null;

  function findPlayer() {
    const video =
      document.querySelector('video.html5-main-video') ||
      document.querySelector('.html5-video-player video');
    if (!video) return null;

    const player =
      video.closest('.html5-video-player') ||
      video.closest('#movie_player') ||
      video.parentElement;
    if (!player) return null;

    return { video, player };
  }

  function detachRenderer() {
    if (!renderer) return;
    try {
      renderer.destroy();
    } catch (error) {
      console.warn('[Cathode] Cleanup failed:', error);
    }
    renderer = null;
  }

  function scan() {
    if (!settings.enabled) {
      detachRenderer();
      return;
    }

    const found = findPlayer();
    if (!found) {
      detachRenderer();
      return;
    }

    if (
      renderer &&
      renderer.video === found.video &&
      renderer.player === found.player &&
      renderer.video.isConnected
    ) {
      return;
    }

    detachRenderer();

    if (Date.now() < retryAt) return;

    const rect = found.player.getBoundingClientRect();
    const fullscreen = Boolean(document.fullscreenElement);
    if (!fullscreen && (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT)) return;

    const next = new Cathode.Renderer(found.video, found.player, settings);
    next.onError = (error) => {
      console.warn('[Cathode] Shader disabled for this video:', error.message);
      showToast('CRT unavailable on this video');
    };

    try {
      next.init();
      renderer = next;
    } catch (error) {
      retryAt = Date.now() + 30000;
      console.warn('[Cathode] Initialization failed:', error);
      showToast('WebGL unavailable');
    }
  }

  function applySettings(next) {
    const wasEnabled = settings.enabled;
    settings = next;

    if (!settings.enabled) {
      detachRenderer();
    } else if (renderer) {
      renderer.setSettings(settings);
    } else {
      scan();
    }

    return wasEnabled !== settings.enabled;
  }

  function persist() {
    try {
      chrome.storage.sync.set({ settings });
    } catch (error) {
      console.warn('[Cathode] Could not save settings:', error);
    }
  }

  function toggleEnabled() {
    const next = Cathode.sanitize({ ...settings, enabled: !settings.enabled });
    const changed = applySettings(next);
    persist();
    if (changed) showToast(next.enabled ? 'Cathode on' : 'Cathode off');
  }

  function showToast(message) {
    const player =
      (renderer && renderer.player) || document.querySelector('.html5-video-player');
    if (!player) return;

    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'cathode-toast';
      toastEl.setAttribute('role', 'status');
    }

    if (toastEl.parentNode !== player) player.appendChild(toastEl);
    toastEl.textContent = message;

    requestAnimationFrame(() => toastEl.classList.add('cathode-toast--visible'));

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('cathode-toast--visible');
    }, 1500);
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get('settings', (data) => {
          if (chrome.runtime.lastError) {
            resolve({ ...Cathode.DEFAULTS });
            return;
          }
          resolve(Cathode.sanitize(data && data.settings));
        });
      } catch (error) {
        resolve({ ...Cathode.DEFAULTS });
      }
    });
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.repeat || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code !== 'KeyC') return;

      const target = event.target;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ''))
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      toggleEnabled();
    },
    true
  );

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.settings) return;
      const next = Cathode.sanitize(changes.settings.newValue);
      const changed = applySettings(next);
      if (changed) showToast(next.enabled ? 'Cathode on' : 'Cathode off');
    });
  } catch (error) {
    console.warn('[Cathode] Storage listener unavailable:', error);
  }

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== 'cathode:settings') return;
      const next = Cathode.sanitize(message.settings);
      const changed = applySettings(next);
      if (changed) showToast(next.enabled ? 'Cathode on' : 'Cathode off');
    });
  } catch (error) {
    console.warn('[Cathode] Message listener unavailable:', error);
  }

  document.addEventListener(
    'yt-navigate-finish',
    () => setTimeout(scan, 250),
    true
  );
  document.addEventListener(
    'yt-page-data-updated',
    () => setTimeout(scan, 250),
    true
  );
  document.addEventListener(
    'fullscreenchange',
    () => setTimeout(scan, 250),
    true
  );
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scan();
  });

  loadSettings().then((loaded) => {
    settings = loaded;
    scan();
    setInterval(scan, 1000);
  });
})();
