// Extracted from crt/cathode (src/shaders.js): the YouTube CRT overlay's shader,
// presets and parameter ranges, as an ES module. Not hand-edited.

export const DEFAULTS = {
  enabled: true,
  preset: 'classic',
  phosphor: 'color',
  curvature: 0.4,
  scanlines: 0.5,
  grille: 0.3,
  glow: 0.42,
  aberration: 0.35,
  vignette: 0.35,
  noise: 0.06,
  flicker: 0.12,
  brightness: 1.06,
  contrast: 1.05,
  saturation: 1.06
};

export const PRESETS = {
  subtle: {
    curvature: 0.14,
    scanlines: 0.2,
    grille: 0.1,
    glow: 0.18,
    aberration: 0.1,
    vignette: 0.16,
    noise: 0.02,
    flicker: 0.04,
    brightness: 1.02,
    contrast: 1.0,
    saturation: 1.02,
    phosphor: 'color'
  },
  classic: {
    curvature: 0.4,
    scanlines: 0.5,
    grille: 0.3,
    glow: 0.42,
    aberration: 0.35,
    vignette: 0.35,
    noise: 0.06,
    flicker: 0.12,
    brightness: 1.06,
    contrast: 1.05,
    saturation: 1.06,
    phosphor: 'color'
  },
  arcade: {
    curvature: 0.62,
    scanlines: 0.72,
    grille: 0.46,
    glow: 0.58,
    aberration: 0.52,
    vignette: 0.46,
    noise: 0.08,
    flicker: 0.18,
    brightness: 1.1,
    contrast: 1.12,
    saturation: 1.16,
    phosphor: 'color'
  },
  vapor: {
    curvature: 0.08,
    scanlines: 0.3,
    grille: 0.18,
    glow: 0.72,
    aberration: 0.72,
    vignette: 0.4,
    noise: 0.05,
    flicker: 0.08,
    brightness: 1.04,
    contrast: 1.0,
    saturation: 1.28,
    phosphor: 'color'
  },
  terminal: {
    curvature: 0.52,
    scanlines: 0.62,
    grille: 0.0,
    glow: 0.5,
    aberration: 0.16,
    vignette: 0.42,
    noise: 0.08,
    flicker: 0.2,
    brightness: 1.05,
    contrast: 1.08,
    saturation: 1.0,
    phosphor: 'green'
  }
};

export const PHOSPHORS = {
  color: { mono: 0.0, tint: [0.0, 0.0, 0.0] },
  green: { mono: 1.0, tint: [0.34, 1.02, 0.52] },
  amber: { mono: 1.0, tint: [1.05, 0.66, 0.24] }
};

export const RANGES = {
  curvature: [0, 1],
  scanlines: [0, 1],
  grille: [0, 1],
  glow: [0, 1.5],
  aberration: [0, 1.5],
  vignette: [0, 1],
  noise: [0, 0.5],
  flicker: [0, 0.5],
  brightness: [0.4, 2],
  contrast: [0.4, 2],
  saturation: [0, 2]
};

export const VERTEX = `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

export const FRAGMENT = `
    precision highp float;

    varying vec2 v_uv;

    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_curvature;
    uniform float u_scanlines;
    uniform float u_grille;
    uniform float u_glow;
    uniform float u_aberration;
    uniform float u_vignette;
    uniform float u_noise;
    uniform float u_flicker;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_saturation;
    uniform float u_video_aspect;
    uniform float u_output_aspect;
    uniform float u_phosphor;
    uniform vec3 u_tint;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    vec2 warp(vec2 uv) {
      uv = uv * 2.0 - 1.0;
      vec2 offset = abs(uv.yx) / vec2(5.0, 4.2);
      uv += uv * offset * offset * u_curvature;
      return uv * 0.5 + 0.5;
    }

    vec2 fitAspect(vec2 uv) {
      if (u_output_aspect > u_video_aspect) {
        float s = u_video_aspect / u_output_aspect;
        uv.x = (uv.x - 0.5) / s + 0.5;
      } else {
        float s = u_output_aspect / u_video_aspect;
        uv.y = (uv.y - 0.5) / s + 0.5;
      }
      return uv;
    }

    bool inside(vec2 uv) {
      return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
    }

    vec3 fetch(vec2 uv) {
      if (!inside(uv)) return vec3(0.0);
      return texture2D(u_texture, uv).rgb;
    }

    vec3 bloom8(vec2 uv, float radius) {
      vec2 pixel = vec2(radius) / u_resolution;
      vec2 d = pixel * 0.70710678;
      vec3 c = vec3(0.0);
      c += fetch(uv + vec2(pixel.x, 0.0));
      c += fetch(uv + vec2(-pixel.x, 0.0));
      c += fetch(uv + vec2(0.0, pixel.y));
      c += fetch(uv + vec2(0.0, -pixel.y));
      c += fetch(uv + vec2(d.x, d.y));
      c += fetch(uv + vec2(-d.x, d.y));
      c += fetch(uv + vec2(d.x, -d.y));
      c += fetch(uv + vec2(-d.x, -d.y));
      return c * 0.125;
    }

    void main() {
      vec2 src = fitAspect(warp(v_uv));

      vec2 dir = src - 0.5;
      vec2 offset = dir * u_aberration * 0.0022;

      vec3 color;
      color.r = fetch(src + offset).r;
      color.g = fetch(src).g;
      color.b = fetch(src - offset).b;

      if (u_glow > 0.001) {
        vec3 bloom = bloom8(src, 4.0);
        float luma = dot(bloom, vec3(0.2126, 0.7152, 0.0722));
        bloom *= smoothstep(0.4, 0.9, luma);
        color += bloom * u_glow * 1.15;
      }

      color *= u_brightness;
      color = (color - 0.5) * u_contrast + 0.5;

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, u_saturation);

      if (u_phosphor > 0.0) {
        color = mix(color, luma * u_tint, u_phosphor);
      }

      float edgeX = smoothstep(0.0, 0.004, src.x) * (1.0 - smoothstep(0.996, 1.0, src.x));
      float edgeY = smoothstep(0.0, 0.004, src.y) * (1.0 - smoothstep(0.996, 1.0, src.y));
      color *= edgeX * edgeY;

      float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 6.2831853 / 3.0);
      color *= mix(1.0, 0.45 + 0.55 * scan, u_scanlines);

      float slot = mod(floor(gl_FragCoord.x), 3.0);
      vec3 mask = vec3(1.0, 0.84, 0.84);
      if (slot >= 1.0) mask = vec3(0.84, 1.0, 0.84);
      if (slot >= 2.0) mask = vec3(0.84, 0.84, 1.0);
      color *= mix(vec3(1.0), mask, u_grille * (1.0 - u_phosphor));

      vec2 vd = v_uv - 0.5;
      float vig = clamp(1.0 - dot(vd, vd) * 1.35, 0.0, 1.0);
      color *= mix(1.0, vig * vig, u_vignette);

      float grain = hash(gl_FragCoord.xy + fract(u_time) * 431.0);
      color += (grain - 0.5) * u_noise * 0.16;

      float flick = hash(vec2(floor(u_time * 30.0), 7.0));
      color *= 1.0 - u_flicker * 0.035 * flick;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;
