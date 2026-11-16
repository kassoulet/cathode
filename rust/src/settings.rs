//! CRT emulation settings and preset loading.
//!
//! The numeric ranges mirror the `crt:` section of the presets shipped in
//! Toddler-Boy/CRTEmulation-Data (0..100 sliders) and the host defaults used by
//! Lime's CRTEmulation module.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

/// Presets shipped with the data repository (in display order).
pub const BUILTIN_PRESETS: [&str; 5] = [
    "Default",
    "SX-64",
    "VICE",
    "Cheap and broken TV",
    "C64 Ultimate HDMI",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Analog {
    /// Feed RGB straight into the CRT simulation (clean, colour-accurate).
    Off,
    /// Encode to YUV and run the PAL signal decoder (Hannover bars, drift...).
    Pal,
    /// Encode to YIQ and run the NTSC signal decoder (rainbowing, dot crawl...).
    Ntsc,
}

#[derive(Clone, Debug)]
pub struct Settings {
    // -- analogue signal (decoder) --
    pub jailbars: f32,
    pub noise: f32,
    pub sharpening: f32,
    pub luma_blur: f32,
    pub chroma_blur: f32,
    pub crosstalk: f32,
    pub phase: f32, // degrees, PAL V-switch angle
    pub hannover: f32,
    pub rainbowing: f32,
    pub drift: f32,

    // -- CRT render --
    pub curve: f32,
    pub rotation: f32, // degrees (-0.5 .. 0.5 at -100 .. 100 in the presets)
    pub bleed: f32,
    pub bleed_red: [f32; 2],
    pub bleed_green: [f32; 2],
    pub bleed_blue: [f32; 2],
    pub convergence: f32,
    pub h_wave: f32,
    pub expansion: f32,
    pub scanlines: f32,
    pub mask: f32,
    pub mask_bitmap: String,
    pub phosphor_decay: f32,
    pub vignette: f32,
    pub adjacent: f32,
    pub halation: f32,
    pub ambient: f32,

    // -- not in the YAML presets, but exposed by the module --
    pub reflections: f32,
    pub overscan: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub tint: f32,

    // -- player side --
    pub analog: Analog,
    pub scanline_count: u32,
}

impl Default for Settings {
    fn default() -> Self {
        // Defaults from lime_CRTEmulation.h (quoted as 0..1 here).
        Self {
            jailbars: 0.50,
            noise: 0.15,
            sharpening: 0.30,
            luma_blur: 0.50,
            chroma_blur: 0.50,
            crosstalk: 0.20,
            phase: 22.5,
            hannover: 0.90,
            rainbowing: 0.50,
            drift: 0.20,

            curve: 0.20,
            rotation: 0.0,
            bleed: 0.20,
            bleed_red: [0.50, -0.10],
            bleed_green: [0.50, -0.10],
            bleed_blue: [0.50, -0.10],
            convergence: 0.20,
            h_wave: 0.50,
            expansion: 1.0,
            scanlines: 0.25,
            mask: 0.25,
            mask_bitmap: "Slot Mask".to_string(),
            phosphor_decay: 0.60,
            vignette: 0.60,
            adjacent: 0.50,
            halation: 0.50,
            ambient: 0.60,

            reflections: 0.25,
            overscan: 0.0,
            brightness: 0.50,
            contrast: 0.80,
            saturation: 0.50,
            tint: 0.0,

            analog: Analog::Off,
            scanline_count: 270,
        }
    }
}

impl Settings {
    pub fn load_preset(data_dir: &Path, name: &str) -> Result<Self> {
        let mut s = Self::default();

        // Accept either a builtin name or a path to a custom .yml file.
        let path = preset_path(data_dir, name);
        if let Some(path) = path {
            let text = std::fs::read_to_string(&path)
                .with_context(|| format!("reading preset {}", path.display()))?;
            s.apply_yaml(&text)
                .with_context(|| format!("parsing preset {}", path.display()))?;
        } else {
            bail!(
                "unknown preset '{name}' (have: {})",
                BUILTIN_PRESETS.join(", ")
            );
        }

        Ok(s)
    }

    /// Parse the tiny YAML subset used by the data repository:
    /// a top-level `crt:` mapping of `key: scalar-or-pair`.
    pub fn apply_yaml(&mut self, text: &str) -> Result<()> {
        for (line_no, raw) in text.lines().enumerate() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') || line == "crt:" {
                continue;
            }
            let (key, value) = line
                .split_once(':')
                .with_context(|| format!("line {}: expected 'key: value'", line_no + 1))?;
            self.set_key(key.trim(), value.trim())
                .with_context(|| format!("line {}", line_no + 1))?;
        }
        Ok(())
    }

    /// Set one preset key. Values use the same 0..100 / pair syntax as the YAML,
    /// except `mask-bitmap`, which is a name.
    pub fn set_key(&mut self, key: &str, value: &str) -> Result<()> {
        let key = key.trim().to_ascii_lowercase();
        let v = value.trim();

        if key == "mask-bitmap" {
            self.mask_bitmap = value.trim().trim_start_matches("$DATA$/").to_string();
            if self.mask_bitmap.is_empty() {
                bail!("mask-bitmap cannot be empty");
            }
            return Ok(());
        }
        if key == "analog" {
            self.analog = match v.to_ascii_lowercase().as_str() {
                "off" | "none" | "rgb" => Analog::Off,
                "pal" => Analog::Pal,
                "ntsc" | "yiq" => Analog::Ntsc,
                other => bail!("analog must be off, pal or ntsc (got {other})"),
            };
            return Ok(());
        }
        if key == "scanlines-count" || key == "lines" {
            self.scanline_count = v.parse::<u32>().context("expected a line count")?.clamp(60, 1080);
            return Ok(());
        }

        // Pair (bleed offsets): "100, 6"
        if let Some(field) = match key.as_str() {
            "bleed-red" => Some(&mut self.bleed_red),
            "bleed-green" => Some(&mut self.bleed_green),
            "bleed-blue" => Some(&mut self.bleed_blue),
            _ => None,
        } {
            let (a, b) = v
                .split_once(',')
                .context("expected a pair, e.g. \"100, 6\"")?;
            *field = [parse_pct(a)?, parse_pct(b)?];
            return Ok(());
        }

        let pct = parse_pct(v)?;
        match key.as_str() {
            "jailbars" => self.jailbars = pct,
            "noise" => self.noise = pct,
            "sharpening" => self.sharpening = pct,
            "luma-blur" => self.luma_blur = pct,
            "chroma-blur" => self.chroma_blur = pct,
            "crosstalk" => self.crosstalk = pct,
            "phase" => self.phase = v.parse().context("expected degrees")?,
            "hannover" => self.hannover = pct,
            "rainbowing" => self.rainbowing = pct,
            "drift" => self.drift = pct,

            "curve" => self.curve = pct,
            "rotation" => self.rotation = v.parse().context("expected degrees")?,
            "bleed" => self.bleed = pct,
            "convergence" => self.convergence = pct,
            "h-wave" => self.h_wave = pct,
            "expansion" => self.expansion = pct,
            "scanlines" => self.scanlines = pct,
            "mask" => self.mask = pct,
            "phosphor-decay" => self.phosphor_decay = pct,
            "vignette" => self.vignette = pct,
            "adjacent" => self.adjacent = pct,
            "halation" => self.halation = pct,
            "ambient" => self.ambient = pct,

            "reflections" => self.reflections = pct,
            "overscan" => self.overscan = pct,
            "brightness" => self.brightness = pct,
            "contrast" => self.contrast = pct,
            "saturation" => self.saturation = pct,
            "tint" => self.tint = pct,

            other => bail!("unknown setting '{other}'"),
        }
        Ok(())
    }

    /// Resolve a user-supplied mask name to a file in the data directory.
    pub fn mask_file(&self, data_dir: &Path) -> Result<PathBuf> {
        let dir = data_dir.join("CRT Masks");
        let wanted = mask_alias(&self.mask_bitmap);
        let entries = std::fs::read_dir(&dir)
            .with_context(|| format!("reading mask directory {}", dir.display()))?;

        let mut available = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("png") {
                continue;
            }
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            available.push(name.to_string());
            if mask_alias(name).eq_ignore_ascii_case(&wanted) {
                return Ok(path);
            }
        }
        available.sort();
        bail!(
            "CRT mask '{}' not found in {} (have: {})",
            self.mask_bitmap,
            dir.display(),
            available.join(", ")
        );
    }

    /// Human readable list of masks, for cycling at runtime.
    pub fn list_masks(data_dir: &Path) -> Vec<String> {
        let mut names = Vec::new();
        if let Ok(entries) = std::fs::read_dir(data_dir.join("CRT Masks")) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("png") {
                    if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                        names.push(name.to_string());
                    }
                }
            }
        }
        names.sort();
        names
    }
}

fn parse_pct(v: &str) -> Result<f32> {
    let n: f32 = v.trim().parse().context("expected a number")?;
    Ok(n / 100.0)
}

fn preset_path(data_dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = Path::new(name);
    if direct.is_file() {
        return Some(direct.to_path_buf());
    }
    for candidate in [
        data_dir.join("Presets").join(format!("{name}.yml")),
        data_dir.join("Presets").join(name),
    ] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // Case-insensitive match, handy for names with spaces/casing.
    let dir = data_dir.join("Presets");
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let stem = path.file_stem()?.to_str()?;
        if stem.eq_ignore_ascii_case(name) {
            return Some(path);
        }
    }
    None
}

fn mask_alias(name: &str) -> String {
    let lower = name.trim().to_ascii_lowercase().replace('_', " ");
    match lower.as_str() {
        "aperture-grille" | "aperture grille" => "Aperture Grille".to_lowercase(),
        "shadow-mask" | "shadow mask" => "Shadow Mask".to_lowercase(),
        "shadow-mask-edp" | "shadow mask edp" => "Shadow Mask EDP".to_lowercase(),
        "slot-mask" | "slot mask" => "Slot Mask".to_lowercase(),
        "sx-64" | "sx64" => "SX-64".to_lowercase(),
        _ => lower,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_repo_preset() {
        let mut s = Settings::default();
        s.apply_yaml(
            "crt:\n  noise: 10\n  phase: 22.5\n  bleed-red: -100, 0\n  mask-bitmap: $DATA$/Slot Mask\n  mask: 25\n",
        )
        .unwrap();
        assert!((s.noise - 0.10).abs() < 1e-6);
        assert!((s.bleed_red[0] + 1.0).abs() < 1e-6);
        assert_eq!(s.mask_bitmap, "Slot Mask");
        assert!((s.mask - 0.25).abs() < 1e-6);
    }

    #[test]
    fn rejects_unknown_key() {
        let mut s = Settings::default();
        assert!(s.set_key("bogus", "1").is_err());
    }
}
