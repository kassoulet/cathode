# Cathode extension

Turns the YouTube player into a CRT using the shared `Cathode` core (`../src`). Pick a Complexity
(Simple / Detailed / Exhaustive) and a Tier (Clean / Enhance / Degrade), then fine-tune with sliders.
Alt+C toggles it. Settings live in `chrome.storage.sync`. Nothing is collected or sent anywhere.

## Build and install

```bash
node tools/build.mjs   # dist/chrome, dist/firefox, dist/cathode-{chrome,firefox}-vX.Y.Z.zip
```

- Chrome / Edge / Brave (102+): `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`.
- Firefox (140+): `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/firefox/manifest.json`.

Lint Firefox: `npx web-ext lint --source-dir dist/firefox`.

## Releasing

1. Bump `version` in `manifest.json`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`. CI builds, lints and attaches both zips to a GitHub release.
3. Upload manually: `cathode-chrome-*.zip` to the Chrome Web Store dashboard, `cathode-firefox-*.zip` to AMO.

Listing notes: icon `icons/icon128.png`; `storage` saves settings; the `*://*.youtube.com/*` host permission
draws over the player; no data collected. The Firefox add-on ID in the generated manifest must stay the
same across versions.

Credit: shaders and masks from [Toddler-Boy/CRTEmulation-Data](https://github.com/Toddler-Boy/CRTEmulation-Data).
