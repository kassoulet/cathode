Here is a architectural design for **Cathode**, focusing on API ergonomics, rendering pipelines, and preset composition.

---

## Architecture Overview

Cathode exposes a unified API across Rust (`cathode-rs`) and JavaScript/TypeScript (`cathode-js` / `@cathode/core`), wrapping three rendering backends behind a common interface:

1. **`fast` (2D Canvas Context / Software-Light)**: Scanlines, chromatic aberration, basic curvature via SVG filters or simple 2D operations. Ultra-low overhead for low-power mobile devices or hundreds of simultaneous video thumbnails.
2. **`gl` (WebGL2 / WebGPU)**: Multi-pass shader pipeline (geometry warp, aperture grille/shadow mask, bloom, phosphor decay, AC coupling, NTSC composite artifacting, ambient reflection).
3. **`sw` (Pure Software Pixel Shader / Rust-Native)**: Cpu-bound frame-buffer processor operating directly on `&mut [u8]` or `ImageData`. Designed for headless rendering, server-side frame extraction, or non-WebGL canvas contexts.

---

## Core Preset Matrix

Presets are built by composing a **Complexity Strategy** with a **Quality Tier**.

### Complexity Strategies

* **`simple`**: 1-pass pass-through. Fast scanline overlay, mild bloom, slight edge vignetting.
* **`detailed`**: 2-pass WebGL pipeline. Phosphor triad mask, separate horizontal/vertical beam blur, dynamic barrel distortion, chromatic aberration, color warmth.
* **`exhaustive`**: Multi-pass physical CRT emulation. Sub-pixel shadow mask alignment, beam spot-size variation relative to beam luminance, frame-to-frame phosphor persistence (afterglow), RF/composite signal decoding (chroma crosstalk), glass reflection, dynamic magnetic interference (hum bar).

### Quality Tiers

* **`clean`**: Studio monitor profile (e.g., Sony PVM/BVM style). Razor-sharp scanlines, zero convergence error, perfect geometry, rich contrast.
* **`enhance`**: Classic arcade / 90s RGB monitor profile. Warm glow, subtle scanline bloom, light aperture mask texture, mild barrel curvature.
* **`degrade`**: Consumer RF/Composite TV profile (e.g., cheap 80s living room set). Heavy NTSC artifacts, color bleeding, high phosphor persistence, geometric warp, corner glow, faint 50/60Hz hum bar drift.

---

## Technical Architecture & Rendering Pipelines

```
                                +-------------------+
                                |   Input Source    |
                                | (Video/Canvas/Img)|
                                +---------+---------+
                                          |
                                    [ Cathode ]
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
  +-----v-------+                  +------v------+                   +------v------+
  | Backend: GL |                  | Backend: SW |                   | Backend: 2D |
  | (WebGL/WebGPU)                 | (Rust / CPU)|                   | (Fast Canvas)
  +-----+-------+                  +------+------+                   +------+------+
        |                                 |                                 |
  +-----v-------------------+      +------v-------------------+      +------v-------------------+
  | Pass 1: Signal & Warp   |      | In-place CPU buffer transform  | Lightweight composite overlay
  | Pass 2: Mask & Glow     |      | (HEADLESS / Node / Native) |      | (Low CPU/GPU footprint)   |
  | Pass 3: Glass & Bloom   |      +--------------------------+      +--------------------------+
  +-----+-------------------+
        |
  +-----v-------+
  | Output Frame|
  +-------------+

```

---

## TypeScript API Design

```typescript
import { Cathode, Presets } from 'cathode-js';

// 1. Quick Setup using preset shortcuts
const filter = new Cathode({
  canvas: document.getElementById('screen') as HTMLCanvasElement,
  preset: Presets.Detailed.Enhance,
  backend: 'gl' // 'gl' | 'fast' | 'sw'
});

// Bind source (HTMLVideoElement, HTMLCanvasElement, ImageBitmap, or OffscreenCanvas)
filter.attachSource(videoElement);
filter.play();

// 2. Granular Tweakable Settings
filter.configure({
  geometry: {
    curvature: 0.12,     // Sphere distortion factor [0.0 - 1.0]
    cornerRadius: 0.05,  // Bezel rounding
    aspectRatio: 4 / 3,
  },
  beam: {
    scanlineIntensity: 0.35,
    scanlineCount: 240,     // Auto-scales if undefined
    beamSharpness: 1.2,     // Dynamic focus based on brightness
  },
  phosphor: {
    type: 'aperture-grille', // 'aperture-grille' | 'shadow-mask' | 'dot-triad'
    persistence: 0.15,      // Afterglow tail (0.0 = none)
    bleed: 0.08,            // Color crosstalk
  },
  signal: {
    chromaticAberration: 0.003,
    compositeArtifacts: 0.0,   // NTSC fringing
    noise: 0.02,
    humBar: 0.01,              // AC ripple speed/intensity
  }
});

// Dynamic Preset Switching on the fly
filter.setPreset(Presets.Exhaustive.Degrade);

```

---

## Rust API Design (`cathode-rs`)

For native Rust apps, WASM bindings, or CPU rendering pipelines:

```rust
use cathode::{CathodeBuilder, Preset, Backend, Options};

let mut cathode = CathodeBuilder::new()
    .backend(Backend::Software) // Fast CPU renderer for raw buffers
    .preset(Preset::Exhaustive(Degrade))
    .resolution(320, 240)
    .build()?;

// Processing frame in-place or returning a new buffer
cathode.process_frame(&input_rgba_pixels, &mut output_rgba_pixels)?;

// Fine-tuning via builder/setter pattern
cathode.update_options(|opts| {
    opts.geometry.curvature = 0.08;
    opts.phosphor.persistence = 0.20;
});

```

---

## Package Distribution Strategy

| Target | Package Name | Target Audience / Use Cases |
| --- | --- | --- |
| **npm** | `cathode-js` | Web video galleries, emulators, custom web components, browser extensions |
| **Cargo** | `cathode` | Native games (wgpu/pixels), desktop demoscene, WASM runtimes, ffmpeg pipelines |
| **C-ABI / System** | `libcathode` | C/C++ bindings, native media players (mpv plugins, OBS filters) |

---

## Implementation Phases

### Phase 1: Core Engine & Shader Pipeline

* Define the central configuration struct/JSON model.
* Implement the WebGL2 multi-pass pipeline (`gl` backend):
* **Pass 0**: NTSC/Composite phase modulation + RF noise simulation.
* **Pass 1**: Geometric barrel warp, chromatic aberration, convergence offset.
* **Pass 2**: Scanlines, sub-pixel shadow mask / aperture grille, phosphor blooming.
* **Pass 3**: Temporal phosphor decay (afterglow) via feedback framebuffers, vignetting, and ambient glass reflection.



### Phase 2: Software & Fast Backends

* Implement `cathode-rs` software rasterizer operating on SIMD-accelerated slice chunks (`u8`/`f32`).
* Build `fast` Canvas2D fallback leveraging hardware-accelerated CSS/SVG filter pipelines for minimalist embeds.

### Phase 3: Presets & Developer Tooling

* Ship pre-compiled binary presets (`Presets.Simple.Clean`, `Presets.Detailed.Enhance`, `Presets.Exhaustive.Degrade`).
* Provide a live interactive playground web app for real-time parameter tweaking and exporting presets to JSON/code configs.
