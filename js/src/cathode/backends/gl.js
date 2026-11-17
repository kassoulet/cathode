// `gl` backend: the crt-canvas WebGL2 multi-pass pipeline.
import { createCRT } from "../../index.js";
import { toCrtCanvas } from "../settings.js";

/** True when WebGL2 + float render targets (needed by crt-canvas) are available. */
export function glSupported() {
  const gl = document.createElement("canvas").getContext("webgl2");
  return Boolean(gl?.getExtension("EXT_color_buffer_float"));
}

export async function createGl(canvas, options = {}) {
  const crt = await createCRT(canvas, { preset: "Default", ...options });
  let settings;
  let autoLines = true;
  return {
    name: "gl",
    apply(s) {
      settings = s;
      const { patch, analog } = toCrtCanvas(s);
      autoLines = !s.beam.scanlineCount;
      if (s.geometry.aspectRatio) crt.options.aspect = s.geometry.aspectRatio;
      else delete crt.options.aspect;
      crt.setAnalog(analog).setOptions(patch);
    },
    render(source, time) {
      if (autoLines) { // follow the source height, within a sensible CRT range
        const h = source.videoHeight ?? source.naturalHeight ?? source.height;
        const lines = Math.min(480, Math.max(120, h));
        if (lines !== crt.settings.lines) crt.setOptions({ lines });
      }
      crt.render(source, time);
    },
    dispose: () => crt.dispose(),
  };
}
