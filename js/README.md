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
It renders the same example image (or an uploaded one) with `crt-canvas` and the
[`crt-shader`](https://www.npmjs.com/package/crt-shader) npm package side by
side, with every setting of both libraries exposed, plus PNG export and
"copy settings" as JSON. `crt-shader` is a still-image renderer, so it is not
re-rendered per frame and has no video input. The example images are generated
by `compare/images/generate.py`.
