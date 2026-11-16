use crate::settings::Analog;
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

pub const HELP: &str = "\
crtplayer — an ffmpeg video player with CRT emulation

USAGE:
    crtplayer [OPTIONS] <FILE>

OPTIONS:
    -p, --preset <NAME>     CRT preset: Default, SX-64, VICE,
                            \"Cheap and broken TV\", \"C64 Ultimate HDMI\"
                            or a path to a custom .yml (default: Default)
        --set <KEY=VALUE>   Override one preset value, repeatable. Keys are the
                            ones used in the preset YAML, e.g.
                            --set scanlines=60 --set curve=35 --set bleed-red=100,6
                            Extra keys: reflections, overscan, brightness,
                            contrast, saturation, tint, lines, analog
    -m, --mask <NAME>       Override the shadow mask: Slot Mask, Shadow Mask,
                            Shadow Mask EDP, Aperture Grille, SX-64
        --analog <MODE>     off (default) | pal | ntsc. Adds the analogue
                            signal defects of the data repo (noise, rainbowing,
                            PAL delay line, vertical roll, ...)
        --lines <N>         Simulated CRT scanlines, default 270
        --no-reflection     Disable the glass reflection of reflections.png
        --no-vignette       Disable the vignette (shortcut for --set vignette=0)
        --data <DIR>        CRTEmulation-Data checkout (default: assets/crt)
        --size <WxH>        Window size (default: 1280x960)
    -f, --fullscreen        Start fullscreen
        --loop              Loop the file
        --start <SECONDS>   Start position
        --volume <0-100>    Volume (default: 80)
        --mute              Start muted
        --snapshot <FILE>   Save a PNG of the rendered frame and quit
        --snapshot-at <S>   When to take the snapshot (default: 1.5s)
    -h, --help              Show this help

PLAYBACK:
    Space / K   pause                    Left / Right   seek -/+ 5s
    Up / Down   volume +/- 5             J / L          seek -/+ 30s
    [ / ]       previous/next preset     M              cycle shadow mask
    R           toggle reflection        V              toggle vignette
    F / Enter   fullscreen               S              save screenshot
    Q / Esc     quit

KEYS:
    0..9        jump to 0%..90% of the file
";

#[derive(Debug, Clone)]
pub struct Args {
    pub input: PathBuf,
    pub preset: String,
    pub data: Option<PathBuf>,
    pub mask: Option<String>,
    pub overrides: Vec<(String, String)>,
    pub analog: Option<Analog>,
    pub lines: Option<u32>,
    pub no_reflection: bool,
    pub no_vignette: bool,
    pub fullscreen: bool,
    pub loop_playback: bool,
    pub start: f64,
    pub volume: f32,
    pub mute: bool,
    pub size: (u32, u32),
    pub snapshot: Option<PathBuf>,
    pub snapshot_at: f64,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            input: PathBuf::new(),
            preset: "Default".to_string(),
            data: None,
            mask: None,
            overrides: Vec::new(),
            analog: None,
            lines: None,
            no_reflection: false,
            no_vignette: false,
            fullscreen: false,
            loop_playback: false,
            start: 0.0,
            volume: 0.8,
            mute: false,
            size: (1280, 960),
            snapshot: None,
            snapshot_at: 1.5,
        }
    }
}

impl Args {
    pub fn parse() -> Result<Option<Self>> {
        let mut args = Args::default();
        let mut it = std::env::args().skip(1);

        while let Some(arg) = it.next() {
            let mut value = |name: &str| -> Result<String> {
                it.next()
                    .with_context(|| format!("{name} needs a value"))
            };

            match arg.as_str() {
                "-h" | "--help" => {
                    print!("{HELP}");
                    return Ok(None);
                }
                "-p" | "--preset" => args.preset = value("--preset")?,
                "--data" => args.data = Some(PathBuf::from(value("--data")?)),
                "-m" | "--mask" => args.mask = Some(value("--mask")?),
                "--set" => {
                    let kv = value("--set")?;
                    let (k, v) = kv
                        .split_once('=')
                        .with_context(|| format!("--set expects KEY=VALUE, got '{kv}'"))?;
                    args.overrides.push((k.to_string(), v.to_string()));
                }
                "--analog" => {
                    args.analog = Some(match value("--analog")?.to_ascii_lowercase().as_str() {
                        "off" | "none" | "rgb" => Analog::Off,
                        "pal" => Analog::Pal,
                        "ntsc" => Analog::Ntsc,
                        other => bail!("--analog must be off, pal or ntsc (got {other})"),
                    });
                }
                "--lines" => {
                    args.lines = Some(
                        value("--lines")?
                            .parse()
                            .context("--lines expects a number")?,
                    );
                }
                "--no-reflection" => args.no_reflection = true,
                "--no-vignette" => args.no_vignette = true,
                "-f" | "--fullscreen" => args.fullscreen = true,
                "--loop" => args.loop_playback = true,
                "--start" => {
                    args.start = value("--start")?
                        .parse()
                        .context("--start expects seconds")?;
                }
                "--volume" => {
                    let v: f32 = value("--volume")?
                        .parse()
                        .context("--volume expects 0-100")?;
                    args.volume = (v / 100.0).clamp(0.0, 1.0);
                }
                "--mute" => args.mute = true,
                "--size" => {
                    let v = value("--size")?;
                    let (w, h) = v
                        .split_once(['x', 'X'])
                        .context("--size expects WxH")?;
                    args.size = (
                        w.parse().context("--size width")?,
                        h.parse().context("--size height")?,
                    );
                }
                "--snapshot" => args.snapshot = Some(PathBuf::from(value("--snapshot")?)),
                "--snapshot-at" => {
                    args.snapshot_at = value("--snapshot-at")?
                        .parse()
                        .context("--snapshot-at expects seconds")?;
                }
                other if other.starts_with('-') && other != "-" => {
                    bail!("unknown option '{other}' (try --help)");
                }
                other => {
                    if args.input.as_os_str().is_empty() {
                        args.input = PathBuf::from(other);
                    } else {
                        bail!("unexpected extra argument '{other}'");
                    }
                }
            }
        }

        if args.input.as_os_str().is_empty() {
            print!("{HELP}");
            bail!("no input file");
        }
        if !args.input.is_file() {
            bail!("input file not found: {}", args.input.display());
        }

        Ok(Some(args))
    }

    /// Locate the CRT emulation data directory.
    pub fn resolve_data_dir(&self) -> Result<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(dir) = &self.data {
            candidates.push(dir.clone());
        }
        candidates.push(PathBuf::from("assets/crt"));
        candidates.push(PathBuf::from("../assets/crt"));
        candidates.push(PathBuf::from("../../assets/crt"));
        if let Ok(exe) = std::env::current_exe() {
            let dir = exe.parent().unwrap_or(Path::new(".")).to_path_buf();
            candidates.push(dir.join("assets/crt"));
            candidates.push(dir.join("../assets/crt"));
            candidates.push(dir.join("../share/crtplayer/assets/crt"));
        }

        for candidate in candidates {
            if candidate.join("Shaders").join("crt-simulation.glsl").is_file() {
                return Ok(candidate);
            }
        }

        bail!(
            "CRT emulation data not found. Pass --data <path> pointing at a \
             checkout of Toddler-Boy/CRTEmulation-Data (it must contain \
             Shaders/crt-simulation.glsl)."
        )
    }
}
