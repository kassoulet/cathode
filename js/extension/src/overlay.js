// Overlay: finds the YouTube <video>, stacks a canvas over it and drives a Cathode filter.
import { Cathode } from '../core/cathode/cathode.js';
import { sanitize, toPreset, DEFAULTS } from './settings.js';

if (!window.__cathodeLoaded) {
  window.__cathodeLoaded = true;
  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 120;

  let settings = { ...DEFAULTS };
  let active = null; // { video, player, canvas, cathode, observer }
  let starting = false;
  let retryAt = 0;
  let toastEl = null;
  let toastTimer = null;

  function findPlayer() {
    const video = document.querySelector('video.html5-main-video') ||
      document.querySelector('.html5-video-player video');
    if (!video) return null;
    const player = video.closest('.html5-video-player') || video.closest('#movie_player') || video.parentElement;
    return player ? { video, player } : null;
  }

  function detach() {
    if (!active) return;
    try {
      active.observer.disconnect();
      active.cathode.dispose();
      active.canvas.remove();
    } catch (error) {
      console.warn('[Cathode] Cleanup failed:', error);
    }
    active = null;
  }

  async function attach({ video, player }) {
    starting = true;
    const canvas = document.createElement('canvas');
    canvas.className = 'cathode-canvas';
    player.appendChild(canvas);
    try {
      const cathode = new Cathode({
        canvas,
        preset: toPreset(settings),
        backend: 'gl', // falls back to 'fast' when WebGL2 / float targets are missing
        gl: { dataUrl: chrome.runtime.getURL('crt/') },
      });
      await cathode.ready;
      cathode.attachSource(video).run(); // run(), not play(): never touch YouTube's playback
      const observer = new ResizeObserver(() => cathode.render());
      observer.observe(player);
      active = { video, player, canvas, cathode, observer };
    } catch (error) {
      canvas.remove();
      retryAt = Date.now() + 30000;
      console.warn('[Cathode] Initialization failed:', error);
      showToast('CRT unavailable');
    } finally {
      starting = false;
    }
  }

  function scan() {
    if (starting) return;
    if (!settings.enabled) return detach();
    const found = findPlayer();
    if (!found) return detach();
    if (active && active.video === found.video && active.player === found.player && active.video.isConnected) return;
    detach();
    if (Date.now() < retryAt) return;
    const rect = found.player.getBoundingClientRect();
    if (!document.fullscreenElement && (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT)) return;
    attach(found);
  }

  function applySettings(next) {
    const wasEnabled = settings.enabled;
    settings = next;
    if (!settings.enabled) detach();
    else if (active) active.cathode.setPreset(toPreset(settings));
    else scan();
    return wasEnabled !== settings.enabled;
  }

  const persist = () => { try { chrome.storage.sync.set({ settings }); } catch (e) { console.warn('[Cathode] save failed:', e); } };

  function showToast(message) {
    const player = active?.player || document.querySelector('.html5-video-player');
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
    toastTimer = setTimeout(() => toastEl.classList.remove('cathode-toast--visible'), 1500);
  }

  const onNewSettings = (raw) => {
    const next = sanitize(raw);
    if (applySettings(next)) showToast(next.enabled ? 'Cathode on' : 'Cathode off');
  };

  document.addEventListener('keydown', (event) => {
    if (event.repeat || !event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyC') return;
    const t = event.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    event.preventDefault();
    event.stopPropagation();
    onNewSettings({ ...settings, enabled: !settings.enabled });
    persist();
  }, true);

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.settings) onNewSettings(changes.settings.newValue);
    });
    chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'cathode:settings') onNewSettings(m.settings); });
  } catch (error) {
    console.warn('[Cathode] Listeners unavailable:', error);
  }

  for (const type of ['yt-navigate-finish', 'yt-page-data-updated', 'fullscreenchange']) {
    document.addEventListener(type, () => setTimeout(scan, 250), true);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scan(); });

  new Promise((resolve) => {
    try {
      chrome.storage.sync.get('settings', (data) => resolve(chrome.runtime.lastError ? null : data?.settings));
    } catch { resolve(null); }
  }).then((raw) => {
    settings = sanitize(raw);
    scan();
    setInterval(scan, 1000);
  });
}
