# Cathode API reference

`Cathode` (in `js/src/cathode/`) is a facade over the cathode-fx WebGL2 pipeline. It follows
`cathode_technical_specification.md` and `specs.md`.

```js
import { Cathode, Presets } from "cathode-fx";

const cathode = new Cathode({
  canvas,                                 // required
  preset: Presets.Detailed.Enhance,       // or { complexity: "detailed", tier: "enhance", ...overrides }
  backend: "gl",                          // "gl" | "fast"; "sw" and "wgpu" throw (not implemented)
  gl: { dataUrl: "/crt/" },               // optional: where shaders/masks are loaded from
});
await cathode.ready;
cathode.attachSource(video);              // video, canvas, img, ImageBitmap, OffscreenCanvas
cathode.run();                            // render loop only (requestVideoFrameCallback for videos, else rAF)
```

## Methods

| Method | Effect |
| --- | --- |
| `ready` | Promise: backend initialised. If WebGL2 is unavailable, `gl` falls back to `fast`. |
| `attachSource(src)` | Choose the picture to filter. |
| `configure(patch)` | Merge grouped settings (see below), keep the rest. |
| `setPreset(preset)` | Replace the settings with a preset (same forms as the constructor). |
| `render(timeSeconds?)` | Draw one frame now. |
| `run()` / `stop()` | Start/stop the render loop; the video is left alone. |
| `play()` / `pause()` | Same, and also play/pause the `<video>`. |
| `toJSON()` | Current settings, round-trippable through `configure`. |
| `dispose()` | Stops the loop and frees the backend. |

Use `run()` when the page owns the video (the YouTube extension does), `play()` when Cathode should drive it.

## Settings

| Group | Key | Default | Notes |
| --- | --- | --- | --- |
| `geometry` | `curvature` | 0.12 | 0 to 0.5, barrel distortion |
| | `cornerRadius` | 0.05 | 0 to 0.2, bezel rounding |
| | `vignette` | 0.3 | 0 to 1, corner darkening |
| | `aspectRatio` | source | The spec's 4:3 default would stretch 16:9 video, so it follows the source unless set |
| `beam` | `scanlineIntensity` | 0.35 | 0 to 1 |
| | `scanlineCount` | 0 | 0 = auto-scale |
| | `focus` | 1.2 | Sharpness (`beamSharpness` is accepted as an alias) |
| `phosphor` | `type` | `aperture-grille` | `aperture-grille`, `shadow-mask`, `dot-triad` |
| | `mask` | 0.25 | Mask strength |
| | `persistence` | 0.15 | 0 to 0.95, afterglow |
| | `bleed` | 0.08 | Colour crosstalk |
| `signal` | `chromaticAberration` | 0.003 | |
| | `compositeArtifacts` | 0 | NTSC fringing; above 0 turns the analog path on |
| | `noise` | 0.02 | RF noise |
| | `humBar` | 0 | Slow rolling AC-hum bands (`crtHum` uniform in `crt-simulation.glsl`) |
| | `analog` | `off` | `off`, `pal`, `ntsc` |
| `glass` | `bloom`, `reflection` | 0.3, 0.1 | Extension to the spec |

Settings are mapped to cathode-fx' flat settings by `toCrtCanvas` in `settings.js`.

## Preset matrix

`Presets.{Simple,Detailed,Exhaustive}.{Clean,Enhance,Degrade}`, or `{ complexity, tier }` in lowercase.

- **Complexity:** `simple` = scanlines, mild bloom and vignette; `detailed` adds the triad mask, barrel warp and
  aberration; `exhaustive` adds NTSC fringing, persistence, hum and glass reflection.
- **Tier:** `clean` = studio monitor (sharp, flat); `enhance` = 90s RGB arcade monitor (glow, light mask, mild
  curve); `degrade` = consumer composite TV (fringing, persistence, hum, strong warp).

## Backends

- `gl`: the multi-pass cathode-fx pipeline. Needs WebGL2 and `EXT_color_buffer_float`.
- `fast`: Canvas2D. Scanlines, vignette, chromatic aberration, rounded bezel and hum bar only; for low-power
  or many-instance use.
