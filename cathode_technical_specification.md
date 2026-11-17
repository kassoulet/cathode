# Cathode Architecture & Technical Specification

**Version:** 0.1.0-draft
**Scope:** `cathode-core`, `cathode-wgpu`, `cathode-player`, `@cathode/core`, `browser-extension`
**Distribution Targets:** Cargo (crates.io), npm, Chrome Web Store, Firefox Add-ons

---

## 1. System Overview

**Cathode** is a unified, multi-platform CRT emulation library and toolsuite. It provides real-time, customizable retro display filter effects across native Rust applications, WebGL/WebGPU web contexts, browser video players (via browser extension), and desktop media apps.

### 1.1 Key Architectural Principles

1. **GPU-First Design:** All standard rendering paths run as multi-pass shader chains (GLSL / WGSL). CPU operations are minimized to parameter uniform updates.
2. **Zero WASM Overhead for Web Graphics:** Web environments use native WebGL2/WebGPU implementations via JavaScript/TypeScript wrappers (`@cathode/core`). WASM (`cathode-wasm`) is strictly isolated as a fallback for pure software/CPU rendering contexts or Node.js image buffer manipulation.
3. **Canonical Shader Source:** Shader logic (WGSL / GLSL) and parameter schemas reside centrally within `cathode-core` to guarantee parity across native Rust apps (`wgpu`), Web applications (`WebGL2`), and desktop software.

---

## 2. Monorepo Structure & Package Manifests

```
cathode/
├── Cargo.toml                      # Monorepo Cargo Workspace Root
├── package.json                    # Monorepo pnpm Workspace Root
├── canonical-shaders/              # Single source of truth shader files
│   ├── stage0_composite.glsl
│   ├── stage1_geometry.glsl
│   ├── stage2_mask_bloom.glsl
│   └── stage3_temporal.glsl
├── crates/
│   ├── cathode-core/               # Pure Rust math, presets, software CPU renderer
│   ├── cathode-wgpu/               # Native Rust wgpu pipeline encoder
│   ├── cathode-wasm/               # WASM bindings for software rasterizer
│   └── cathode-player/             # GPUI + ffmpeg-next native CRT video player app
└── packages/
    ├── core/                       # @cathode/core npm package (TypeScript/WebGL2)
    └── browser-extension/          # Manifest V3 Chrome/Firefox YouTube shader extension
```

---

## 3. Presets & Parameter Matrix

Cathode organizes display states into two orthogonal axes: **Complexity Strategy** and **Quality Tier**.

### 3.1 Complexity Strategies

| Strategy | Passes | Pipeline Operations | Target Environments |
| :--- | :--- | :--- | :--- |
| **`simple`** | 1 Pass | Fast scanline pattern, chromatic aberration, basic vignette | Low-power mobile, multi-instance web galleries |
| **`detailed`** | 2 Passes | Sub-pixel triad mask, dynamic scanline spot sizing, barrel warp | Standard video web player, low-spec desktop |
| **`exhaustive`** | 3 Passes | NTSC phase fringing, dynamic phosphor persistence (afterglow), AC coupling hum bar, glass reflection | High-fidelity desktop player (`cathode-player`), high-spec gaming |

### 3.2 Quality Tiers

* **`clean`**: High-end broadcast monitor profile (Sony PVM style). Sharp focus, zero convergence drift, minimal glass curvature.
* **`enhance`**: Classic 90s RGB arcade monitor profile. Subtle glow, rich contrast, soft phosphor triad texture.
* **`degrade`**: Consumer composite TV (80s living room). Strong NTSC fringing, high frame persistence, visible AC hum ripple, geometric warp.

### 3.3 Dynamic Configuration Interface (JSON / Data Schema)

```typescript
interface CathodeConfig {
  backend: 'gl' | 'wgpu' | 'sw';
  preset?: {
    complexity: 'simple' | 'detailed' | 'exhaustive';
    tier: 'clean' | 'enhance' | 'degrade';
  };
  geometry: {
    curvature: number;     // Range: [0.0 - 0.5] - Sphere distortion factor
    cornerRadius: number;  // Range: [0.0 - 0.2] - Bezel rounding mask
    aspectRatio: number;   // Default: 1.333 (4:3)
    vignette: number;      // Range: [0.0 - 1.0] - Corner darkening
  };
  beam: {
    scanlineIntensity: number; // Range: [0.0 - 1.0]
    scanlineCount: number;     // Default: 240 (auto-scales if 0)
    focus: number;             // Dynamic sharpness relative to brightness
  };
  phosphor: {
    type: 'aperture-grille' | 'shadow-mask' | 'dot-triad';
    persistence: number;       // Range: [0.0 - 0.95] - Afterglow feedback tail
    bleed: number;             // Color crosstalk factor
  };
  signal: {
    chromaticAberration: number;
    compositeArtifacts: number; // NTSC color fringing
    noise: number;              // High-frequency RF noise
    humBar: number;             // AC ripple intensity & speed offset
  };
}
```

---

## 4. Render Pipeline Architecture

### 4.1 Shader Pipeline Flow (Exhaustive Strategy)

```
[ Input Texture: Video / Image / Canvas ]
                  │
                  ▼
   ┌──────────────────────────────┐
   │ Pass 0: Composite Signal     │ ── NTSC Chroma/Luma decoding phase simulation
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │ Pass 1: Signal & Geometry    │ ── Barrel distortion, chromatic aberration, convergence offset
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │ Pass 2: Phosphor & Bloom     │ ── Aperture mask, scanlines, sub-pixel spot enlargement
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │ Pass 3: Temporal & Glass     │ ── Frame feedback buffer (afterglow), ambient glass reflection, AC hum
   └──────────────┬───────────────┘
                  │
                  ▼
[ Frame Output / Canvas Overlay ]
```

---

## 5. Subsystem Specs

### 5.1 JS / TS Web Engine (`packages/core` - `@cathode/core`)
* **Core Technology:** WebGL2 context wrapper with direct HTML5 `<video>` / `<canvas>` texture upload (`gl.texImage2D`).
* **Frame Loop:** Synchronized via `requestAnimationFrame` or `video.requestVideoFrameCallback()` for stutter-free playback.
* **Footprint:** Zero external runtime dependencies. Mini-shader builder size `< 12KB` gzipped.

### 5.2 Browser Extension (`packages/browser-extension`)
* **Targets:** Chrome Manifest V3 & Firefox WebExtensions.
* **Injection Strategy:**
  1. Content script observes YouTube SPA page transitions (`yt-navigate-finish`).
  2. Finds `<video class="html5-main-video">`.
  3. Spawns an overlay HTML5 `<canvas>` matching the player element dimensions.
  4. Extends YouTube player control bar with a customizable overlay menu (using Shadow DOM to isolate styles).
  5. Syncs playback state (play/pause/seek) directly with the hardware-accelerated WebGL pass.

### 5.3 Desktop Video Player (`crates/cathode-player`)
* **UI Framework:** GPUI (Rust native high-performance UI toolkit).
* **Video Backend:** `ffmpeg-next` (C-bindings to FFmpeg libraries).
* **Render Pipeline:** Custom `wgpu` pass integrated into GPUI's rendering context.
* **Video Threading:** Separate hardware video decoding thread feeding a thread-safe ring buffer (`crossbeam-channel`) of GPU textures, avoiding main UI frame drops.

---

## 6. Distribution Matrix

| Target Registry | Package Identifier | Artifact Description |
| :--- | :--- | :--- |
| **crates.io** | `cathode-core` | Core Rust types, math algorithms, software CPU filter |
| **crates.io** | `cathode-wgpu` | `wgpu` render pass encoder for Rust games and apps |
| **crates.io** | `cathode-player` | Native binary desktop CRT player executable |
| **npm** | `@cathode/core` | WebGL2/WebGPU JavaScript library for web video integration |
| **Chrome Web Store** | *Cathode CRT Overlay* | YouTube & Web Video Shader Extension |
