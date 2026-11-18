export type Analog = "off" | "pal" | "ntsc";
export type Complexity = "simple" | "detailed" | "exhaustive";
export type Tier = "clean" | "enhance" | "degrade";
export type MaskType = "aperture-grille" | "shadow-mask" | "dot-triad";
export type Source = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap | OffscreenCanvas;

/** Grouped Cathode settings (all keys optional when passed to `configure`). */
export interface CathodeSettings {
  geometry: { curvature: number; cornerRadius: number; vignette: number; aspectRatio?: number };
  beam: { scanlineIntensity: number; scanlineCount: number; focus: number; beamSharpness?: number };
  phosphor: { type: MaskType; mask: number; persistence: number; bleed: number };
  signal: { chromaticAberration: number; compositeArtifacts: number; noise: number; humBar: number; analog: Analog };
  glass: { bloom: number; reflection: number };
}
export type CathodeSettingsPatch = { [G in keyof CathodeSettings]?: Partial<CathodeSettings[G]> };

export type PresetInput = Readonly<CathodeSettings> | ({ complexity: Complexity; tier: Tier } & CathodeSettingsPatch);

export interface CathodeOptions {
  canvas: HTMLCanvasElement;
  preset?: PresetInput;
  /** `sw` and `wgpu` throw: not implemented. `gl` falls back to `fast` without WebGL2. */
  backend?: "gl" | "fast" | "sw" | "wgpu";
  /** Extra options forwarded to crt-canvas, e.g. `{ dataUrl }`. */
  gl?: CreateCRTOptions;
}

export class Cathode {
  constructor(options: CathodeOptions);
  readonly ready: Promise<this>;
  settings: CathodeSettings;
  attachSource(source: Source): this;
  configure(patch: CathodeSettingsPatch): this;
  setPreset(preset: PresetInput): this;
  render(timeSeconds?: number): void;
  run(): this;
  stop(): this;
  play(): this;
  pause(): this;
  toJSON(): CathodeSettings;
  dispose(): void;
}

type PresetGroup = { Clean: Readonly<CathodeSettings>; Enhance: Readonly<CathodeSettings>; Degrade: Readonly<CathodeSettings> };
export const Presets: { Simple: PresetGroup; Detailed: PresetGroup; Exhaustive: PresetGroup };

export interface CreateCRTOptions {
  preset?: string | Record<string, number>;
  /** URL of the CRTEmulation-Data directory (shaders, masks, presets). Required when bundling. */
  dataUrl?: string;
  analog?: Analog;
  lines?: number;
  aspect?: number;
  autoResize?: boolean;
  reflection?: boolean;
  overrides?: Record<string, number>;
  gl?: WebGLContextAttributes;
}

export class CRT {
  render(source: Source, timeSeconds?: number): void;
  setPreset(name: string): void;
  setMask(name: string): void;
  setAnalog(mode: Analog): void;
  setReflection(on: boolean): void;
  setOptions(options: Record<string, number | string>): void;
  snapshot(): string;
  dispose(): void;
}

export function createCRT(canvas: HTMLCanvasElement, options?: CreateCRTOptions): Promise<CRT>;
export function attach(
  canvas: HTMLCanvasElement,
  source: Source | (() => Source),
  options?: CreateCRTOptions,
): Promise<{ crt: CRT; stop(): void }>;

export const PRESET_NAMES: string[];
export const MASKS: string[];
export const DEFAULT_SETTINGS: Record<string, number>;
export function maskFileName(name: string): string;
export function normalizeAnalog(value?: string): Analog;
export function parsePresetYaml(text: string): Record<string, number | string>;
export function plan(...args: unknown[]): unknown;
