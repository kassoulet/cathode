//! The CRT emulation pipeline.
//!
//! Pass order (matching Lime's CRTEmulation module):
//!
//! ```text
//! video RGBA ──► [analogue encoder] ──► [PAL/NTSC decoder] ─┐
//!                                                           ▼
//!                                        crt-simulation (scanlines, mask,
//!                                        bleed, phosphor decay)  ──►
//!                                        crt-adjacent-excitation ──►
//!                                        crt-halation             ──►
//!                                        crt-curved (+ reflection) ──► screen
//! ```
//!
//! `crt-calc-bloom` is a 1×1 ping-pong pass that feeds the beam bloom
//! expansion of the simulation.

use crate::glutil::{self, bind_texture, Filter, Program, Quad, Target, Texture, Wrap};
use crate::settings::{Analog, Settings};
use anyhow::{bail, Context, Result};
use glow::HasContext;
use std::path::{Path, PathBuf};
use std::time::Instant;

const VERTEX: &str = r#"#version 330 core
layout(location = 0) in vec2 aPos;
out vec2 fragCoord;
void main() {
    fragCoord = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
"#;

/// Final pass: the tube quad is rotated by a fraction of a degree.
const VERTEX_ROTATED: &str = r#"#version 330 core
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
"#;

const FRAG_PRELUDE: &str = r#"#version 330 core
uniform vec2 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
in vec2 fragCoord;
out vec4 fragColor;
"#;

/// RGB (sRGB) -> YUV/YIQ, storing chroma with the +0.5 bias the decoders
/// expect. The inverse gamma undoes the 2.8 -> 2.2 PAL gamma applied by
/// `decoder-pal.glsl`, so ordinary sRGB video keeps its tone.
const ENCODER: &str = r#"
uniform int uYiq;

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
"#;

pub struct Plan {
    pub native: (i32, i32),
    pub crt: (i32, i32),
}

/// Pick the virtual resolutions: `lines` scanlines for the source, three
/// physical pixels per source line for the CRT pass.
pub fn plan(aspect: f32, lines: u32) -> Plan {
    let aspect = aspect.clamp(0.5, 4.0);
    let lines = lines.clamp(60, 1080) as f32;

    let nh = lines as i32;
    let nw = even(nh as f32 * aspect);

    let mut ch = (nh * 3).min(2160);
    let mut cw = even(ch as f32 * aspect);
    let max_w = 3840;
    if cw > max_w {
        cw = max_w;
        ch = even(cw as f32 / aspect);
    }

    Plan {
        native: (nw, nh),
        crt: (cw, ch),
    }
}

fn even(v: f32) -> i32 {
    let v = v.round() as i32;
    v + (v & 1)
}

pub struct CrtRenderer {
    pub settings: Settings,
    data_dir: PathBuf,

    sim: Program,
    curved: Program,
    adjacent: Program,
    halation: Program,
    bloom: Program,
    encoder: Program,
    dec_pal: Program,
    dec_ntsc: Program,
    quad: Quad,

    pub source: Texture,
    mask: Texture,
    reflection: Texture,
    reflection_on: bool,

    crt: [Target; 2],
    crt_index: usize,
    adjacent_tex: Target,
    halation_tex: Target,
    bloom_tex: [Target; 2],
    bloom_index: usize,
    yuv: Target,
    decoded: Target,

    pub native: (i32, i32),
    pub crt_size: (i32, i32),

    start: Instant,
    last: Instant,
    time: f32,
}

impl CrtRenderer {
    pub fn new(
        gl: &glow::Context,
        data_dir: &Path,
        settings: Settings,
        aspect: f32,
        reflection_on: bool,
    ) -> Result<Self> {
        let p = plan(aspect, settings.scanline_count);
        let (nw, nh) = p.native;
        let (cw, ch) = p.crt;

        let shader = |name: &str| -> Result<String> {
            let dir = data_dir.join("Shaders");
            let text = std::fs::read_to_string(dir.join(name))
                .with_context(|| format!("reading shader {name}"))?;
            Ok(format!("{FRAG_PRELUDE}{}", expand(&dir, &text)?))
        };

        let sim = Program::new(gl, VERTEX, &shader("crt-simulation.glsl")?, "crt-simulation")?;
        let curved = Program::new(gl, VERTEX_ROTATED, &shader("crt-curved.glsl")?, "crt-curved")?;
        let adjacent = Program::new(
            gl,
            VERTEX,
            &shader("crt-adjacent-excitation.glsl")?,
            "crt-adjacent-excitation",
        )?;
        let halation = Program::new(gl, VERTEX, &shader("crt-halation.glsl")?, "crt-halation")?;
        let bloom = Program::new(gl, VERTEX, &shader("crt-calc-bloom.glsl")?, "crt-calc-bloom")?;
        let dec_pal = Program::new(gl, VERTEX, &shader("decoder-pal.glsl")?, "decoder-pal")?;
        let dec_ntsc = Program::new(gl, VERTEX, &shader("decoder-ntsc.glsl")?, "decoder-ntsc")?;
        let encoder = Program::new(
            gl,
            VERTEX,
            &format!("{FRAG_PRELUDE}{ENCODER}"),
            "encoder-rgb",
        )?;

        let quad = Quad::new(gl)?;
        let source = glutil::texture(
            gl,
            nw,
            nh,
            glow::RGBA8,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            Filter::Linear,
            Wrap::ClampEdge,
            true,
            None,
        )?;

        let mask = load_mask(gl, &settings.mask_file(data_dir)?)?;
        let reflection = load_reflection(gl, &data_dir.join("reflections.png"))?;

        let crt = [
            Target::new(gl, cw, ch, glow::RGBA16F, glow::RGBA, glow::HALF_FLOAT, true)?,
            Target::new(gl, cw, ch, glow::RGBA16F, glow::RGBA, glow::HALF_FLOAT, true)?,
        ];
        let adjacent_tex = Target::new(gl, cw, ch, glow::RGBA16F, glow::RGBA, glow::HALF_FLOAT, true)?;
        let halation_tex = Target::new(gl, cw, ch, glow::RGBA16F, glow::RGBA, glow::HALF_FLOAT, true)?;
        let bloom_tex = [
            Target::new(gl, 1, 1, glow::R32F, glow::RED, glow::FLOAT, false)?,
            Target::new(gl, 1, 1, glow::R32F, glow::RED, glow::FLOAT, false)?,
        ];
        let yuv = Target::new(gl, nw, nh, glow::RGBA16F, glow::RGBA, glow::HALF_FLOAT, true)?;
        let decoded = Target::new(gl, nw, nh, glow::RGBA16F, glow::RGBA, glow::HALF_FLOAT, true)?;

        Ok(Self {
            settings,
            data_dir: data_dir.to_path_buf(),
            sim,
            curved,
            adjacent,
            halation,
            bloom,
            encoder,
            dec_pal,
            dec_ntsc,
            quad,
            source,
            native: (nw, nh),
            crt_size: (cw, ch),
            mask,
            reflection,
            reflection_on,
            crt,
            crt_index: 0,
            adjacent_tex,
            halation_tex,
            bloom_tex,
            bloom_index: 0,
            yuv,
            decoded,
            start: Instant::now(),
            last: Instant::now(),
            time: 0.0,
        })
    }

    pub fn upload(&self, gl: &glow::Context, frame: &crate::player::VideoFrame) -> Result<()> {
        if (frame.width, frame.height) != (self.source.w as u32, self.source.h as u32) {
            bail!(
                "frame is {}x{} but the CRT expects {}x{}",
                frame.width,
                frame.height,
                self.source.w,
                self.source.h
            );
        }
        glutil::upload_rgba(gl, &self.source, &frame.data)
    }

    pub fn apply_settings(&mut self, gl: &glow::Context, settings: Settings) -> Result<()> {
        if !settings
            .mask_bitmap
            .eq_ignore_ascii_case(&self.settings.mask_bitmap)
        {
            self.mask = load_mask(gl, &settings.mask_file(&self.data_dir)?)?;
        }
        if settings.scanline_count != self.settings.scanline_count {
            // The virtual resolution is baked into the framebuffers.
            bail!("scanline count can only be changed on the command line");
        }
        self.settings = settings;
        Ok(())
    }

    pub fn set_reflection(&mut self, on: bool) {
        self.reflection_on = on;
    }

    pub fn reflection_on(&self) -> bool {
        self.reflection_on
    }

    fn tick(&mut self) -> f32 {
        let now = Instant::now();
        let dt = (now - self.last).as_secs_f32().clamp(0.001, 0.1);
        self.last = now;
        self.time = (now - self.start).as_secs_f32();
        dt
    }

    /// Render one frame into the default framebuffer.
    pub fn render(&mut self, gl: &glow::Context, win_w: i32, win_h: i32) {
        let dt = self.tick();
        let s = self.settings.clone();
        let t = self.time;

        // ---- analogue signal path -------------------------------------
        let source_tex = if s.analog == Analog::Off {
            self.source.handle()
        } else {
            // encode RGB -> YUV/YIQ
            self.encoder.bind(gl);
            self.encoder.resolution(gl, self.native.0, self.native.1);
            self.encoder.f32(gl, "iTime", t);
            bind_texture(gl, &self.encoder, "iChannel0", 0, self.source.handle());
            self.yuv.bind(gl);
            self.encoder.i32(gl, "uYiq", i32::from(s.analog == Analog::Ntsc));
            self.quad.draw(gl);

            // decode, with all the analogue defects
            let dec = if s.analog == Analog::Ntsc {
                &self.dec_ntsc
            } else {
                &self.dec_pal
            };
            dec.bind(gl);
            dec.resolution(gl, self.native.0, self.native.1);
            dec.f32(gl, "iTime", t);
            dec.f32(gl, "crtRefreshRate", self.refresh_rate());
            dec.f32(gl, "decSharpening", s.sharpening);
            dec.f32(gl, "decLumablur", s.luma_blur);
            dec.f32(gl, "decChromablur", s.chroma_blur);
            dec.f32(gl, "decCrosstalk", s.crosstalk);
            dec.f32(gl, "decPhase", s.phase);
            dec.f32(gl, "decPALDelayLine", s.hannover);
            dec.f32(gl, "decCrossColor", s.rainbowing);
            dec.f32(gl, "decDrift", s.drift);
            dec.f32(gl, "decNoise", s.noise);
            dec.f32(gl, "decJailbars", s.jailbars);
            let is_ntsc = s.analog == Analog::Ntsc;
            let brightness = s.brightness - if is_ntsc { 0.70 } else { 0.50 };
            let contrast = 0.4 + (1.2 - 0.4) * s.contrast;
            let saturation = (if is_ntsc { 0.8 } else { 0.9 }) * s.saturation;
            dec.vec3(
                gl,
                "encBrightnessContrastSaturation",
                brightness * 0.5,
                contrast,
                saturation,
            );
            let tint_linear = s.tint;
            let tint = tint_linear.abs().powf(2.5) * tint_linear.signum();
            dec.vec3(
                gl,
                "encTintGains",
                1.0 + tint,
                1.0 - tint * (0.299 - 0.114) / 0.587,
                1.0 - tint,
            );
            bind_texture(gl, dec, "iChannel0", 0, self.yuv.tex.handle());
            self.decoded.bind(gl);
            self.quad.draw(gl);
            self.decoded.generate_mips(gl);
            self.decoded.tex.handle()
        };

        // ---- beam bloom level (1x1 ping-pong) -------------------------
        let bloom_read = &self.bloom_tex[self.bloom_index];
        let bloom_write = &self.bloom_tex[self.bloom_index ^ 1];
        bloom_write.bind(gl);
        self.bloom.bind(gl);
        self.bloom.resolution(gl, 1, 1);
        self.bloom.f32(gl, "deltaTime", dt);
        bind_texture(gl, &self.bloom, "iChannel0", 0, bloom_read.tex.handle());
        bind_texture(gl, &self.bloom, "iChannel1", 1, source_tex);
        self.quad.draw(gl);
        let bloom_tex = bloom_write.tex.handle();

        // ---- CRT simulation -------------------------------------------
        let read = self.crt_index;
        let write = read ^ 1;
        self.crt[write].bind(gl);
        self.sim.bind(gl);
        self.sim.resolution(gl, self.crt_size.0, self.crt_size.1);
        self.sim.f32(gl, "iTime", t);
        self.sim.f32(gl, "crtRefreshRate", self.refresh_rate());
        self.sim.f32(gl, "crtBleed", s.bleed);
        self.sim.vec2(gl, "crtRedOffset", s.bleed_red[0], s.bleed_red[1]);
        self.sim.vec2(gl, "crtGreenOffset", s.bleed_green[0], s.bleed_green[1]);
        self.sim.vec2(gl, "crtBlueOffset", s.bleed_blue[0], s.bleed_blue[1]);
        self.sim.f32(gl, "crtHoffset", s.h_wave);
        self.sim.f32(gl, "crtConvergence", s.convergence);
        self.sim.f32(gl, "crtScanlines", s.scanlines);
        self.sim.f32(gl, "crtMask", s.mask);
        self.sim.f32(gl, "crtBloomExpansion", s.expansion);
        self.sim.f32(gl, "u_deltaTime", dt);
        self.sim.f32(gl, "u_phosphorFlicker", self.flicker());
        let (dr, dg, db) = self.decay(dt);
        self.sim.vec3(gl, "u_decayFactor", dr, dg, db);
        let over = 1.0 + (0.86 - 1.0) * s.overscan;
        let y_over = over * if s.analog == Analog::Ntsc { 0.8825 } else { 1.0 };
        self.sim.vec2(gl, "crtOverscan", over, y_over);
        bind_texture(gl, &self.sim, "iChannel0", 0, source_tex);
        bind_texture(gl, &self.sim, "iChannel1", 1, self.mask.id);
        bind_texture(gl, &self.sim, "iChannel2", 2, self.crt[read].tex.handle());
        bind_texture(gl, &self.sim, "iChannel3", 3, bloom_tex);
        self.quad.draw(gl);
        self.crt[write].generate_mips(gl);

        // ---- phosphor spill -------------------------------------------
        self.adjacent_tex.bind(gl);
        self.adjacent.bind(gl);
        self.adjacent.resolution(gl, self.crt_size.0, self.crt_size.1);
        self.adjacent.f32(gl, "iTime", t);
        self.adjacent.f32(gl, "crtAdjacent", s.adjacent);
        bind_texture(
            gl,
            &self.adjacent,
            "iChannel0",
            0,
            self.crt[write].tex.handle(),
        );
        self.quad.draw(gl);
        self.adjacent_tex.generate_mips(gl);

        self.halation_tex.bind(gl);
        self.halation.bind(gl);
        self.halation.resolution(gl, self.crt_size.0, self.crt_size.1);
        self.halation.f32(gl, "iTime", t);
        self.halation.f32(gl, "crtHalation", s.halation);
        bind_texture(
            gl,
            &self.halation,
            "iChannel0",
            0,
            self.adjacent_tex.tex.handle(),
        );
        self.quad.draw(gl);
        self.halation_tex.generate_mips(gl);

        // ---- tube geometry, vignette, glass reflection ----------------
        let (tw, th) = tube_rect(win_w, win_h, self.display_aspect(), 0.96);
        let (tw, th) = (tw.max(2), th.max(2));
        let aspect = tw as f32 / th as f32;
        let rot = (s.rotation * 0.005).to_radians();
        let (sin, cos) = rot.sin_cos();

        unsafe {
            gl.bind_framebuffer(glow::FRAMEBUFFER, None);
            gl.viewport(0, 0, win_w, win_h);
            gl.disable(glow::BLEND);
            gl.clear_color(0.0, 0.0, 0.0, 1.0);
            gl.clear(glow::COLOR_BUFFER_BIT);
        }

        self.curved.bind(gl);
        self.curved.resolution(gl, tw, th);
        self.curved.f32(gl, "iTime", t);
        self.curved.f32(gl, "crtCurve", s.curve);
        self.curved.f32(gl, "crtVignette", s.vignette);
        self.curved.f32(gl, "crtAmbient", s.ambient);
        self.curved.f32(gl, "crtDistortion", 0.3);
        self.curved.f32(gl, "crtRotation", rot);
        self.curved.f32(gl, "crtAspect", aspect);
        self.curved.bool(gl, "crtSource", false);
        self.curved.f32(
            gl,
            "crtReflection",
            if self.reflection_on { s.reflections } else { 0.0 },
        );
        self.curved.vec3(gl, "backCol", 0.0, 0.0, 0.0);
        bind_texture(gl, &self.curved, "iChannel0", 0, self.halation_tex.tex.handle());
        bind_texture(gl, &self.curved, "iChannel1", 1, self.reflection.id);
        bind_texture(gl, &self.curved, "iChannel2", 2, self.halation_tex.tex.handle());
        bind_texture(gl, &self.curved, "iChannel3", 3, self.halation_tex.tex.handle());

        let scale_x = tw as f32 / win_w.max(1) as f32;
        let scale_y = th as f32 / win_h.max(1) as f32;
        self.curved.vec2(gl, "uScale", scale_x, scale_y);
        self.curved
            .f32(gl, "uWindowAspect", win_w.max(1) as f32 / win_h.max(1) as f32);
        self.curved
            .mat2(gl, "uRot", &[cos, sin, -sin, cos]);
        self.quad.draw(gl);

        // Ping-pong indices advance only after the frame has been consumed.
        self.crt_index = write;
        self.bloom_index ^= 1;
    }

    fn refresh_rate(&self) -> f32 {
        if self.settings.analog == Analog::Pal {
            50.125
        } else {
            59.826
        }
    }

    fn flicker(&self) -> f32 {
        let decay = self.settings.phosphor_decay;
        let threshold = 0.7;
        let flicker = (decay - threshold).max(0.0) / (1.0 - threshold);
        flicker.powf(2.0 / 3.0) * 0.05
    }

    fn decay(&self, dt: f32) -> (f32, f32, f32) {
        let crt_decay = self.settings.phosphor_decay;
        let decay = 1.0 + (10.0 - 1.0) * crt_decay;
        let factors = [18.0_f32, 17.0, 20.0];

        let t = ((crt_decay - 0.6) * 10.0).clamp(0.0, 1.0);
        let off = 1.0 - t * t * (3.0 - 2.0 * t);
        let f = |factor: f32| (-(factor * decay) * dt).exp2() * off;
        (f(factors[0]), f(factors[1]), f(factors[2]))
    }

    fn display_aspect(&self) -> f32 {
        self.crt_size.0 as f32 / self.crt_size.1 as f32
    }
}

fn tube_rect(win_w: i32, win_h: i32, aspect: f32, margin: f32) -> (i32, i32) {
    let win_w = win_w.max(1) as f32;
    let win_h = win_h.max(1) as f32;
    let (w, h) = if win_w / win_h > aspect {
        (win_h * aspect, win_h)
    } else {
        (win_w, win_w / aspect)
    };
    ((w * margin) as i32, (h * margin) as i32)
}

/// Resolve `#include "..."` relative to the Shaders directory.
fn expand(dir: &Path, text: &str) -> Result<String> {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("#include") {
            let name = rest.trim().trim_matches('"');
            let path = dir.join(name);
            let included = std::fs::read_to_string(&path)
                .with_context(|| format!("reading include {}", path.display()))?;
            out.push_str(&expand(dir, &included)?);
            out.push('\n');
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    Ok(out)
}

fn load_reflection(gl: &glow::Context, path: &Path) -> Result<Texture> {
    let img = image::open(path)
        .with_context(|| format!("loading reflection {}", path.display()))?
        .to_rgba8();
    let (w, h) = img.dimensions();
    glutil::texture(
        gl,
        w as i32,
        h as i32,
        glow::RGBA8,
        glow::RGBA,
        glow::UNSIGNED_BYTE,
        Filter::Linear,
        Wrap::ClampEdge,
        true,
        Some(img.as_raw()),
    )
}

/// Load a mask and tile it up to 512×512.
///
/// The repository ships 64 px masks; `crt-simulation.glsl` fades masks smaller
/// than ~128 px out at normal display sizes (`detailFade`). Tiling preserves
/// the pattern scale while keeping the feature visible.
fn load_mask(gl: &glow::Context, path: &Path) -> Result<Texture> {
    let img = image::open(path)
        .with_context(|| format!("loading mask {}", path.display()))?
        .to_rgb8();
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        bail!("empty CRT mask {}", path.display());
    }

    const TARGET: u32 = 512;
    let scale = (TARGET / w.max(1)).max(1);
    let tw = w * scale;
    let th = h * scale;
    let src = img.as_raw();
    let mut data = Vec::with_capacity((tw * th * 3) as usize);
    for y in 0..th {
        let sy = y / scale % h;
        for x in 0..tw {
            let sx = x / scale % w;
            let i = ((sy * w + sx) * 3) as usize;
            data.extend_from_slice(&src[i..i + 3]);
        }
    }

    glutil::texture(
        gl,
        tw as i32,
        th as i32,
        glow::RGB8,
        glow::RGB,
        glow::UNSIGNED_BYTE,
        Filter::Linear,
        Wrap::Repeat,
        true,
        Some(&data),
    )
}
