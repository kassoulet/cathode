# Shader families in the comparison app

| Family | Source | Passes | Approach |
| --- | --- | --- | --- |
| crt-canvas / cathode | [Toddler-Boy/CRTEmulation-Data](https://github.com/Toddler-Boy/CRTEmulation-Data) (`assets/crt/`) | multi | Float pipeline: analog PAL/NTSC, mask, halation, persistence, glass reflection |
| crt-shader | npm `crt-shader` | 1+ | Parametric image filter with pixel and photo input modes |
| lowres CRT-Lite / Deluxe | extracted from the author's zmbc web player | 1 / 3 | Source-space scanlines and mask; Deluxe adds ghosting, bloom, noise, warp |
| Lottes | libretro, public domain | 1 | Gaussian beams in linear light, procedural masks, bloom |
| crt-geom | libretro, GPL-2+ | 1 | Accurate screen geometry, dot mask |
| crt-easymode | libretro, GPL-2+ | 1 | Lightweight, easy to tune; halation variant |
| crt-royale | libretro, GPL-2+ | 12 | Physical model: mask LUT resizing, bloom, halation, beam spot size |

## How they differ

- **Single vs multi-pass:** single-pass shaders do everything in one fragment shader and are cheap. Multi-pass
  ones separate signal, mask, bloom and temporal effects for better bloom and halation at a higher GPU cost.
- **Masks:** Lottes and lowres compute the mask from the pixel position. Royale and crt-canvas sample mask
  images, which look more realistic but depend on output resolution. Royale tints colours at about 700 px and is
  neutral at about 1400 px, because it is designed for 1080p or larger.
- **Beam model:** a brightness-dependent Gaussian (Lottes, Lite) versus a physical spot-size model (royale).
- **Signal realism:** only crt-canvas, cathode and Deluxe simulate composite artifacts, hum, noise and
  persistence; the libretro shaders assume clean RGB.

Rules of thumb: pixel art at low cost, Lottes or Lite; maximum authenticity with a GPU budget, royale;
signal and temporal effects, crt-canvas, cathode or Deluxe.

## libretro shaders

`js/compare/renderers/libretro.js` is a small `.glslp` runner (WebGL2). It fetches presets, shaders and mask
images at runtime from `libretro/glsl-shaders` at a pinned commit, so no GPL code is vendored. It does not
support `mipmap_input` or float framebuffers. Adding another preset is one line
(`create("crt-xyz.glslp", id, label)`).
Credits: Timothy Lottes (public domain), cgwg and Themaister (crt-geom), EasyMode, TroggleMonkey (crt-royale).
