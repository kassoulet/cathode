# Cathode

A browser extension that turns the YouTube player into a CRT. A real-time WebGL
shader sits on top of the video and adds scanlines, barrel curvature, phosphor
glow, a shadow mask, chromatic aberration, vignette, and grain — with green and
amber monochrome modes.

```
┌───────────────────────────────┐
│  CATHODE             ● on     │
│  PRESET   Subtle Classic ...  │
│  PHOSPHOR Color Green Amber   │
│  SCREEN   Curvature     40 ▂▄ │
│  ...                          │
└───────────────────────────────┘
```

## Install

Prebuilt archives are attached to GitHub releases, or you can build them
locally (see [Build](#build)).

### Chrome / Edge / Brave

Requires Chromium 102+.

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `dist/chrome` (or this folder).
4. Open any YouTube video. The CRT effect is on by default.

### Firefox

Requires Firefox 140+ on desktop (142+ on Android).

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and choose `dist/firefox/manifest.json`.
3. Open any YouTube video.

Temporary add-ons are removed when Firefox restarts. A permanent install requires
a build signed by Mozilla (`web-ext sign` with AMO API credentials).

## Usage

| Action | Control |
| --- | --- |
| Toggle on/off | `Alt` + `C`, or the switch in the popup |
| Change look | Preset buttons in the popup |
| Fine-tune | Sliders (live preview while you drag) |
| Monochrome | Phosphor: Color / Green / Amber |
| Back to defaults | **Reset** |

Settings are stored in `chrome.storage.sync` and apply to every YouTube tab.

### Presets

- **Subtle** — a light scanline/curvature pass, easy to watch for hours.
- **Classic** — balanced consumer-CRT look (default).
- **Arcade** — heavy curvature, thick scanlines, strong mask and aberration.
- **Vapor** — flat screen, big bloom and chromatic shift, saturated color.
- **Terminal** — green phosphor, strong curvature and flicker.

## How it works

1. A content script finds the YouTube player (`video.html5-main-video` inside
   `.html5-video-player`) and watches for SPA navigations, fullscreen, and
   player resizes.
2. It creates a WebGL canvas layered over the player (`position: absolute`,
   `pointer-events: none`, `z-index: 5`), so YouTube's controls, captions, and
   menus stay on top and remain fully interactive.
3. The current video frame is uploaded as a texture each time a new frame is
   composited (`requestVideoFrameCallback`, falling back to `requestAnimationFrame`)
   and drawn through the fragment shader.
4. YouTube streams via Media Source Extensions, so the `<video>` is same-origin
   and safe to sample into WebGL.

The shader (`src/shaders.js`) is a single pass: barrel warp → aspect fit →
chromatic aberration → 8-tap bloom → brightness/contrast/saturation →
phosphor tint → screen edge → scanlines → shadow mask → vignette → grain/flicker.

If a frame cannot be sampled (e.g. protected content), the shader hides itself
and the plain video is shown with a short toast.

## Build

The root folder is the Chrome build; the Firefox manifest is generated from it
by the build script.

```bash
node tools/build.mjs     # or: npm run build
```

Outputs:

```
dist/chrome/                        unpacked Chrome build
dist/firefox/                       unpacked Firefox build
dist/cathode-chrome-v1.0.0.zip      Chrome package
dist/cathode-firefox-v1.0.0.zip     Firefox package
```

Requires Node 18+ and the `zip` utility. The Firefox manifest gets a Gecko
add-on ID (required for `storage.sync`), a minimum Firefox version, and
Mozilla's `data_collection_permissions: none` declaration.

Lint the Firefox package (after building) with:

```bash
npm run lint:firefox
```

## CI

`.github/workflows/build.yml` runs on every push and pull request:

- syntax-checks all scripts,
- builds both packages,
- runs `web-ext lint` on the Firefox build,
- runs the headless shader smoke test,
- uploads both archives as the `cathode-packages` artifact.

Pushing a version tag also creates a GitHub release with both archives attached:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Layout

```
manifest.json            Chrome MV3 manifest (Firefox manifest is generated)
src/shaders.js           settings schema, presets, WebGL shaders
src/renderer.js          WebGL renderer (texture upload, uniforms, frame loop)
src/content.js           YouTube integration, storage, hotkey, toasts
src/overlay.css          canvas + toast styles
popup/                   toolbar UI
icons/                   toolbar/store icons
tools/build.mjs          Chrome + Firefox packaging script
tools/make-icons.py      regenerates the icons
tools/test-harness.html  headless test for the shader/renderer
.github/workflows/build.yml  CI: build, lint, artifacts, tagged releases
```

## Development

The shader harness renders a test pattern through the real renderer and asserts
that the output is non-black, curved at the corners, scanlined, and green in
terminal mode. It runs headless:

```bash
google-chrome --headless=new --no-sandbox \
  --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader \
  --virtual-time-budget=4000 --dump-dom \
  "file://$PWD/tools/test-harness.html" | grep -o 'data-cathode-result="[^"]*"'
```

Regenerate icons with `python3 tools/make-icons.py` (requires Pillow).

## Notes and limitations

- Rendering cost scales with the player's on-screen size; the canvas renders at
  up to 1.5× device pixel ratio.
- Protected/DRM streams may block texture uploads; the extension falls back to
  the unmodified video for those.
- Picture-in-Picture windows are outside the page and are not filtered.
