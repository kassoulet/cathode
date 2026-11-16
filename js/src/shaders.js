// Shader loading and GLSL ES 3.00 adaptation for the CRTEmulation-Data files.

const INCLUDE_RE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/;
// GLSL ES 3.00 does not allow initializers on uniform declarations. The data
// repo relies on desktop GLSL defaults, so strip them and set the values from
// JavaScript instead.
const UNIFORM_INIT_RE =
  /^([ \t]*)uniform([ \t]+)([A-Za-z_]\w*)([ \t]+)([A-Za-z_]\w*)[ \t]*=[^;]*;/gm;

const FRAGMENT_PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
in vec2 fragCoord;
out vec4 fragColor;
`;

export const VERTEX = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 fragCoord;
void main() {
    fragCoord = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** Final pass: the tube quad is rotated by a fraction of a degree. */
export const VERTEX_ROTATED = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uScale;
uniform float uWindowAspect;
uniform mat2 uRot;
out vec2 fragCoord;
void main() {
    vec2 p = aPos * uScale;
    vec2 q = p * vec2(uWindowAspect, 1.0);
    q = uRot * q;
    p = q / vec2(uWindowAspect, 1.0);
    fragCoord = aPos * 0.5 + 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
}
`;

/**
 * Resolve `#include "..."` recursively against `baseUrl`.
 * Returns the expanded GLSL source.
 */
export async function loadShader(baseUrl, name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name);

  const pending = (async () => {
    const url = new URL(name, baseUrl);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `crt-canvas: cannot load shader ${url} (HTTP ${response.status})`,
      );
    }
    let text = await response.text();
    text = text.replace(/^[ \t]*#version[^\n]*\n?/gm, "");

    const out = [];
    for (const line of text.split("\n")) {
      const match = line.match(INCLUDE_RE);
      if (match) {
        out.push(await loadShader(baseUrl, match[1], cache));
      } else {
        out.push(line);
      }
    }
    return out.join("\n");
  })();

  cache.set(name, pending);
  return pending;
}

/** Turn a raw data-repo shader body into a WebGL2 fragment shader. */
export function fragmentShader(body) {
  const adapted = body.replace(UNIFORM_INIT_RE, "$1uniform$2$3$4$5;");
  return FRAGMENT_PRELUDE + adapted;
}

export const SHADER_FILES = {
  simulation: "crt-simulation.glsl",
  curved: "crt-curved.glsl",
  adjacent: "crt-adjacent-excitation.glsl",
  halation: "crt-halation.glsl",
  bloom: "crt-calc-bloom.glsl",
  decoderPal: "decoder-pal.glsl",
  decoderNtsc: "decoder-ntsc.glsl",
};

/** RGB (sRGB) -> YUV/YIQ with the +0.5 chroma bias the decoders expect. */
export const ENCODER_SHADER = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform int uYiq;
in vec2 fragCoord;
out vec4 fragColor;

void main() {
    vec3 rgb = clamp(texture(iChannel0, fragCoord).rgb, 0.0, 1.0);
    rgb = pow(rgb, vec3(2.2 / 2.8));

    float y;
    vec2 c;
    if (uYiq == 1) {
        y = dot(rgb, vec3(0.23485876, 0.63350074, 0.13164050));
        c = vec2(dot(rgb, vec3(0.44095948, -0.27984363, -0.16111585)),
                 dot(rgb, vec3(0.14630060, -0.55948148, 0.41318088)));
    } else {
        y = dot(rgb, vec3(0.29914638, 0.58687783, 0.11397579));
        c = vec2(dot(rgb, vec3(-0.14720974, -0.28880220, 0.43601193)),
                 dot(rgb, vec3(0.61487557, -0.51488190, -0.09999367)));
    }

    fragColor = vec4(y, c + 0.5, 1.0);
}
`;
