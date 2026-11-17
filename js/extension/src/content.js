// Classic content script: the real code is an ES module (so it can import the shared
// Cathode core), which Chrome and Firefox only load via dynamic import().
import(chrome.runtime.getURL('src/overlay.js')).catch((error) =>
  console.warn('[Cathode] failed to load:', error));
