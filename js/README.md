# crt-canvas

WebGL2 CRT emulation for any `<canvas>`, using the shaders from
[Toddler-Boy/CRTEmulation-Data](https://github.com/Toddler-Boy/CRTEmulation-Data)
(curvature, scanlines, shadow masks, bloom, halation, phosphor decay, glass
reflection, optional PAL/NTSC signal path).

Needs WebGL2 with `EXT_color_buffer_float`.

```js
import { createCRT } from "crt-canvas";

const crt = await createCRT(document.querySelector("canvas"), {
  preset: "Default", // see PRESET_NAMES
  lines: 270,        // simulated scanlines
  analog: "off",     // "off" | "pal" | "ntsc"
});

function frame(now) {
  crt.render(videoOrCanvasOrImage, now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Or let the library drive the loop: `const { crt, stop } = await attach(canvas, video)`.

## API

- `createCRT(canvas, options)` → `CRT`. Options: `preset`, `lines`, `analog`,
  `aspect`, `autoResize`, `reflection`, `overrides`, `dataUrl`.
- `crt.render(source, timeSeconds)`: draw one frame.
- `crt.setPreset(name)`, `setMask(name)`, `setAnalog(mode)`, `setReflection(bool)`,
  `setOptions({ curve, scanlines, mask, vignette, noise, phosphorDecay, ... })`
  (values 0..1).
- `crt.snapshot()` → PNG data URL, `crt.dispose()`.
- Exports `PRESET_NAMES`, `MASKS`, `DEFAULT_SETTINGS`.

## Data files

Shaders, masks and presets are loaded at runtime from `assets/crt/`
(`dataUrl` overrides the location). In the monorepo they are found at
`../../assets/crt`; `npm run sync-assets` (run by `prepack`) copies them into
the package.

## Demo

`npm run demo`, then open <http://localhost:8080/js/demo/>.

## Comparison app

`npm install && npm run demo`, then open <http://localhost:8080/js/compare/>.
It renders the same example image (or an uploaded one) in two panes; each pane
picks its renderer: `crt-canvas`, the
[`crt-shader`](https://www.npmjs.com/package/crt-shader) npm package, `cathode`
(YouTube CRT overlay) or zmbc's `CRT-Lite` / `CRT Deluxe`. The cathode and zmbc
shaders and presets are extracted into `compare/renderers/` (`*-data.js`,
`zmbc-shaders.js`). Every setting of each renderer is exposed, plus PNG export and
"copy settings" as JSON. `crt-shader` is a still-image renderer, so it is not
re-rendered per frame and has no video input. The example images are generated
by `compare/images/generate.py`.

## Cathode API (`src/cathode/`)

A facade implementing `specs.md`: a preset matrix, grouped settings and swappable backends.

```js
import { Cathode, Presets } from "crt-canvas";
const filter = new Cathode({ canvas, preset: Presets.Detailed.Enhance, backend: "gl" });
filter.attachSource(video);   // video, canvas, img, ImageBitmap, OffscreenCanvas
filter.play();
filter.configure({ beam: { scanlineIntensity: 0.4 }, phosphor: { type: "shadow-mask" } });
filter.setPreset(Presets.Exhaustive.Degrade);
```

`Presets.{Simple,Detailed,Exhaustive}.{Clean,Enhance,Degrade}`. Backends: `gl` (the crt-canvas
pipeline; falls back to `fast` without WebGL2) and `fast` (Canvas2D: scanlines, vignette,
chromatic aberration, rounded bezel, hum bar only). `sw` throws: not implemented, nor is the
Rust crate. `signal.humBar` has no effect on `gl` (no matching shader knob).
Both backends are selectable in the comparison app.
