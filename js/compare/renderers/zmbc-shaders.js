// Extracted from zmbc (frontend/zmbc-web-player-shared/src/{shaders,crt-deluxe}.ts):
// the GLSL for the CRT tier ("CRT-Lite") and CRT Deluxe passes. Not hand-edited.

export const CRT_VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_pos * vec2(0.5, -0.5) + 0.5;
}
`;

export const NOFLIP_VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_pos * vec2(0.5, 0.5) + 0.5;
}
`;

export const CRT_LITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_texture;
uniform vec2 u_videoSize;   // source (texture) dimensions
uniform vec2 u_canvasSize;  // output dimensions
uniform vec3 u_scan;        // x: scanline strength, y: beam width dark, z: beam width bright (rows)
uniform vec2 u_mask;        // x: type (0 none, 1 aperture grille, 2 shadow mask, 3 slot mask), y: strength
uniform vec3 u_geom;        // x: curvature, y: vignette, z: brightness boost

const float GAMMA = 2.2;

/** Source row 'row', sharp-bilinear across columns, in linear light. */
vec3 rowSample(float x, float row, float sx) {
  float interW = u_videoSize.x * sx;
  float p = clamp(x * interW - 0.5, 0.0, interW - 1.0);
  float base = floor(p);
  float f = p - base;
  float b0 = floor(base / sx);
  float b1 = floor(min(base + 1.0, interW - 1.0) / sx);
  float t = (clamp(row, 0.0, u_videoSize.y - 1.0) + 0.5) / u_videoSize.y;
  vec3 c0 = pow(texture(u_texture, vec2((b0 + 0.5) / u_videoSize.x, t)).rgb, vec3(GAMMA));
  vec3 c1 = pow(texture(u_texture, vec2((b1 + 0.5) / u_videoSize.x, t)).rgb, vec3(GAMMA));
  return mix(c0, c1, f);
}

/** Gaussian beam weight at distance 'd' (in rows) from a row of colour 'c'. */
float beam(float d, vec3 c) {
  float w = mix(u_scan.y, u_scan.z, max(max(c.r, c.g), c.b));
  return exp(-0.5 * (d * d) / (w * w));
}

/** Brightness-neutral phosphor mask (each channel averages 1 across a triad). */
vec3 phosphorMask(vec2 pos, int type, float amt) {
  float dark = 1.0 - amt;
  float light = 1.0 + 2.0 * amt;
  float x = floor(pos.x);
  // Shadow mask: shift the triad one column every other row (delta layout).
  if (type == 2) x += mod(floor(pos.y), 2.0);
  vec3 m = vec3(dark);
  m[int(mod(x, 3.0))] = light;
  // Slot mask: a dark horizontal bar every 4 rows, staggered per triad.
  if (type == 3 && mod(floor(pos.y) + 2.0 * mod(floor(pos.x / 3.0), 2.0), 4.0) < 1.0) {
    m *= dark;
  }
  return m;
}

void main() {
  vec2 uv = v_uv;
  if (u_geom.x > 0.0) {
    vec2 cc = uv * 2.0 - 1.0;
    cc *= 1.0 + u_geom.x * (cc.yx * cc.yx);
    uv = cc * 0.5 + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  vec2 ratio = u_canvasSize / u_videoSize;  // output px per source px
  float sx = max(floor(ratio.x), 1.0);
  float y = uv.y * u_videoSize.y - 0.5;
  float r0 = floor(y);
  float dy = y - r0;
  vec3 c0 = rowSample(uv.x, r0, sx);
  vec3 c1 = rowSample(uv.x, r0 + 1.0, sx);

  // Without scanlines: sharp step between rows (1 output px wide seam).
  vec3 flatRgb = mix(c0, c1, clamp((dy - 0.5) * ratio.y + 0.5, 0.0, 1.0));
  vec3 scanRgb = c0 * beam(dy, c0) + c1 * beam(1.0 - dy, c1);
  float scanAmt = u_scan.x * smoothstep(1.5, 3.0, ratio.y);
  vec3 rgb = mix(flatRgb, scanRgb, scanAmt);

  float maskAmt = u_mask.y * smoothstep(2.0, 3.0, ratio.x);
  int maskType = int(u_mask.x + 0.5);
  if (maskType > 0 && maskAmt > 0.0) {
    rgb *= phosphorMask(gl_FragCoord.xy, maskType, maskAmt);
  }

  // Boost only as far as the effects above actually removed light.
  float effect = clamp(max(scanAmt, u_mask.y > 0.0 ? maskAmt / u_mask.y : 0.0), 0.0, 1.0);
  rgb = clamp(rgb * (1.0 + (u_geom.z - 1.0) * effect), 0.0, 1.0);

  // After the clamp, so a boosted highlight cannot saturate through it.
  if (u_geom.y > 0.0) {
    rgb *= 1.0 - u_geom.y * smoothstep(0.25, 0.7, length(uv - 0.5));
  }

  outColor = vec4(pow(rgb, vec3(1.0 / GAMMA)), 1.0);
}
`;

export const CRT_DELUXE_BLEND_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_accum;
uniform sampler2D u_current;
uniform float u_ghost_factor;
void main() {
  outColor = mix(texture(u_accum, v_uv), texture(u_current, v_uv), u_ghost_factor);
}
`;

export const CRT_DELUXE_POST_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_details;
uniform float u_destruction;
uniform vec4 u_fx0;          // bloom, noise, flicker, vignette
uniform vec4 u_fx1;          // chromatic, warp, colour drift, composite artifacts
uniform float u_blur_px;     // bloom tap spacing, in output px (~half a source pixel)
uniform float u_flicker_hz;

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 geometryWarp(vec2 uv, float strength) {
  vec2 center = uv - 0.5;
  float dist = dot(center, center);
  return uv + center * dist * strength * 0.3;
}

vec3 chromatic(vec2 uv, float strength) {
  float offset = strength * 0.003;
  return vec3(
    texture(u_texture, uv + vec2(offset, 0.0)).r,
    texture(u_texture, uv).g,
    texture(u_texture, uv - vec2(offset, 0.0)).b
  );
}

vec3 bloom(vec3 color, vec2 uv, float strength) {
  vec2 stepPx = u_blur_px / u_resolution;
  vec3 blur = vec3(0.0);
  float total = 0.0;
  for (float x = -2.0; x <= 2.0; x += 1.0) {
    for (float y = -2.0; y <= 2.0; y += 1.0) {
      float w = 1.0 / (1.0 + x * x + y * y);
      blur += texture(u_texture, uv + vec2(x, y) * stepPx).rgb * w;
      total += w;
    }
  }
  blur /= total;
  // Glow is additive around bright areas (the CRT-tier image already has
  // dark scanline gaps, so a plain mix would only smear them grey).
  float luma = dot(blur, vec3(0.299, 0.587, 0.114));
  return color + blur * smoothstep(0.35, 1.0, luma) * strength * 0.5;
}

void main() {
  float bloomS = u_fx0.x, noiseS = u_fx0.y, flickerS = u_fx0.z, vignetteS = u_fx0.w;
  float chromaS = u_fx1.x, warpS = u_fx1.y, driftS = u_fx1.z, artifactS = u_fx1.w;

  vec2 uv = v_uv;
  if (warpS > 0.001) {
    uv = geometryWarp(v_uv, warpS);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  vec3 color = chromaS > 0.001
    ? chromatic(uv, u_details * chromaS)
    : texture(u_texture, uv).rgb;

  if (bloomS > 0.001) color = bloom(color, uv, u_details * bloomS);

  if (artifactS > 0.001) {
    // Composite chroma subcarrier interference.
    vec2 pos = gl_FragCoord.xy;
    float sub = sin(pos.x * 0.3 + pos.y * 0.1 + u_time * 2.0) * 0.5 + 0.5;
    float a = sub * u_details * artifactS * 0.3;
    color += vec3(a * 0.1, a * 0.05, -a * 0.1);
  }

  if (driftS > 0.001) {
    float d = u_destruction * driftS;
    color *= vec3(1.0 + d * 0.1, 1.0 - d * 0.05, 1.0 - d * 0.08);
  }

  if (noiseS > 0.001) {
    color += rand(gl_FragCoord.xy + floor(u_time * 24.0)) * u_destruction * noiseS * 0.3 - 0.05 * u_destruction * noiseS;
  }

  if (flickerS > 0.001) {
    color *= 1.0 + sin(u_time * u_flicker_hz * 6.2832) * u_destruction * flickerS * 0.08;
  }

  if (vignetteS > 0.001) {
    float v = smoothstep(0.25, 0.75, length(uv - 0.5));
    color *= mix(1.0, 0.6, v * u_destruction * vignetteS * 2.0);
  }

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
