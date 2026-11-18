# Cathode

CRT emulation for the web. Shaders from [Toddler-Boy/CRTEmulation-Data](https://github.com/Toddler-Boy/CRTEmulation-Data) (`assets/crt/`).

| Path | What |
| --- | --- |
| `js/src/` | The WebGL2 CRT library, published as [`cathode-fx`](js/README.md) |
| `js/compare/` | Side-by-side comparison app (ours, crt-shader, libretro shaders...) |
| `js/benchmark/` | Benchmark page for all renderers |
| `js/examples/` | Small usage examples (image, video, presets) and an interactive demo |
| `js/extension/` | Chrome/Firefox YouTube extension built on the library, see [its README](js/extension/README.md) |

Run everything locally with `cd js && npm install && npm run demo` (<http://localhost:8080/js/compare/>).
Docs: [Cathode API](docs/cathode-api.md), [shader families](docs/shader-families.md).
