mod args;
mod audio;
mod crt;
mod glutil;
mod player;
mod settings;

use anyhow::{Context, Result};
use sdl2::event::Event;
use sdl2::keyboard::Keycode;
use sdl2::video::FullscreenType;
use settings::{BUILTIN_PRESETS, Settings};
use std::time::{Duration, Instant};

fn main() {
    if let Err(err) = run() {
        eprintln!("crtplayer: {err:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let Some(args) = args::Args::parse()? else {
        return Ok(());
    };
    let data_dir = args.resolve_data_dir()?;

    let settings = build_settings(&data_dir, &args, &args.preset)?;
    let info = player::probe(&args.input)?;
    let plan = crt::plan(info.display_aspect, settings.scanline_count);

    // ---- SDL / OpenGL -----------------------------------------------
    let sdl = sdl2::init().map_err(anyhow::Error::msg)?;
    let video = sdl.video().map_err(anyhow::Error::msg)?;
    let audio_subsystem = sdl.audio().map_err(anyhow::Error::msg)?;

    {
        let gl_attr = video.gl_attr();
        gl_attr.set_context_profile(sdl2::video::GLProfile::Core);
        gl_attr.set_context_version(3, 3);
        gl_attr.set_double_buffer(true);
        gl_attr.set_multisample_samples(0);
    }

    let title = format!("crtplayer — {}", file_name(&args.input));
    let mut window = video
        .window(&title, args.size.0, args.size.1)
        .position_centered()
        .opengl()
        .resizable()
        .build()
        .context("creating the window")?;

    let _gl_context = window
        .gl_create_context()
        .map_err(anyhow::Error::msg)
        .context("creating a GL context")?;
    video
        .gl_set_swap_interval(sdl2::video::SwapInterval::VSync)
        .ok();

    if args.fullscreen {
        window
            .set_fullscreen(FullscreenType::Desktop)
            .map_err(anyhow::Error::msg)?;
    }

    let gl = unsafe {
        glow::Context::from_loader_function(|name| video.gl_get_proc_address(name) as *const _)
    };

    let mut renderer = crt::CrtRenderer::new(
        &gl,
        &data_dir,
        settings.clone(),
        info.display_aspect,
        !args.no_reflection,
    )?;

    let mut player = player::Player::open(
        &args.input,
        (plan.native.0 as u32, plan.native.1 as u32),
        args.start,
        if args.mute { 0.0 } else { args.volume },
        args.loop_playback,
        &audio_subsystem,
    )?;

    println!(
        "{}  {}x{} @ {:.2} fps  {:.1}s  audio: {}  CRT: {}x{}",
        file_name(&args.input),
        info.width,
        info.height,
        info.fps,
        info.duration,
        if info.has_audio { "yes" } else { "no" },
        plan.native.0,
        plan.native.1
    );

    let mut event_pump = sdl.event_pump().map_err(anyhow::Error::msg)?;
    let mut preset_index = BUILTIN_PRESETS
        .iter()
        .position(|p| p.eq_ignore_ascii_case(&args.preset));
    let mut preset_name = args.preset.clone();
    let masks = Settings::list_masks(&data_dir);
    let mut last_title = String::new();
    let mut last_title_at = Instant::now() - Duration::from_secs(2);
    let mut vertical_blank = false;
    let boot = Instant::now();

    'main: loop {
        for event in event_pump.poll_iter() {
            match event {
                Event::Quit { .. } => break 'main,
                Event::KeyDown {
                    keycode: Some(key), ..
                } => {
                    let mut changed = true;
                    match key {
                        Keycode::Escape | Keycode::Q => break 'main,
                        Keycode::Space | Keycode::K => player.toggle_pause(),
                        Keycode::Left => player.seek_relative(-5.0),
                        Keycode::Right => player.seek_relative(5.0),
                        Keycode::J => player.seek_relative(-30.0),
                        Keycode::L => player.seek_relative(30.0),
                        Keycode::Up => {
                            let v = (player.volume() + 0.05).min(1.0);
                            player.set_volume(v);
                        }
                        Keycode::Down => {
                            let v = (player.volume() - 0.05).max(0.0);
                            player.set_volume(v);
                        }
                        Keycode::LeftBracket => {
                            if let Some(i) = preset_index {
                                preset_index = Some((i + BUILTIN_PRESETS.len() - 1) % BUILTIN_PRESETS.len());
                                preset_name = BUILTIN_PRESETS[preset_index.unwrap()].to_string();
                                apply_preset(&mut renderer, &gl, &data_dir, &args, &preset_name)?;
                            }
                        }
                        Keycode::RightBracket => {
                            if let Some(i) = preset_index {
                                preset_index = Some((i + 1) % BUILTIN_PRESETS.len());
                                preset_name = BUILTIN_PRESETS[preset_index.unwrap()].to_string();
                                apply_preset(&mut renderer, &gl, &data_dir, &args, &preset_name)?;
                            }
                        }
                        Keycode::M => {
                            if !masks.is_empty() {
                                let current = renderer
                                    .settings
                                    .mask_bitmap
                                    .to_ascii_lowercase();
                                let pos = masks
                                    .iter()
                                    .position(|m| m.to_ascii_lowercase() == current)
                                    .map(|i| (i + 1) % masks.len())
                                    .unwrap_or(0);
                                let mut s = renderer.settings.clone();
                                s.mask_bitmap = masks[pos].clone();
                                renderer.apply_settings(&gl, s)?;
                            }
                        }
                        Keycode::R => {
                            let on = !renderer.reflection_on();
                            renderer.set_reflection(on);
                        }
                        Keycode::V => {
                            let mut s = renderer.settings.clone();
                            s.vignette = if s.vignette > 0.0 { 0.0 } else { 0.6 };
                            renderer.apply_settings(&gl, s)?;
                        }
                        Keycode::F | Keycode::Return => {
                            vertical_blank = !vertical_blank;
                            window
                                .set_fullscreen(if vertical_blank {
                                    FullscreenType::Desktop
                                } else {
                                    FullscreenType::Off
                                })
                                .map_err(anyhow::Error::msg)?;
                        }
                        Keycode::S => {
                            let (w, h) = window.drawable_size();
                            let pixels = glutil::read_pixels(&gl, w as i32, h as i32);
                            let name = format!("screenshot-{}.png", unix_time());
                            glutil::save_png(std::path::Path::new(&name), w as i32, h as i32, &pixels)?;
                            println!("saved {name}");
                        }
                        Keycode::Num0
                        | Keycode::Num1
                        | Keycode::Num2
                        | Keycode::Num3
                        | Keycode::Num4
                        | Keycode::Num5
                        | Keycode::Num6
                        | Keycode::Num7
                        | Keycode::Num8
                        | Keycode::Num9 => {
                            let digit = match key {
                                Keycode::Num0 => 0,
                                Keycode::Num1 => 1,
                                Keycode::Num2 => 2,
                                Keycode::Num3 => 3,
                                Keycode::Num4 => 4,
                                Keycode::Num5 => 5,
                                Keycode::Num6 => 6,
                                Keycode::Num7 => 7,
                                Keycode::Num8 => 8,
                                _ => 9,
                            };
                            let d = player.duration();
                            if d > 0.0 {
                                player.seek(d * digit as f64 / 10.0);
                            }
                        }
                        _ => changed = false,
                    }
                    if changed {
                        last_title.clear();
                    }
                }
                _ => {}
            }
        }

        if let Some(err) = player.error.take() {
            anyhow::bail!("decoder: {err}");
        }

        if player.update() {
            if let Some(frame) = &player.current {
                renderer.upload(&gl, frame)?;
            }
        }

        let (w, h) = window.drawable_size();
        renderer.render(&gl, w as i32, h as i32);
        window.gl_swap_window();

        if args.snapshot.is_some()
            && boot.elapsed().as_secs_f64() >= args.snapshot_at
            && player.current.is_some()
        {
            let path = args.snapshot.as_ref().unwrap();
            let pixels = glutil::read_pixels(&gl, w as i32, h as i32);
            glutil::save_png(path, w as i32, h as i32, &pixels)?;
            println!("wrote {}", path.display());
            break 'main;
        }

        if last_title_at.elapsed() > Duration::from_millis(200) {
            let pos = player.position();
            let dur = player.duration();
            let new_title = format!(
                "crtplayer — {}  [{}/{}]  {}{}{}",
                file_name(&args.input),
                clock(pos),
                if dur > 0.0 { clock(dur) } else { "--:--".into() },
                preset_name,
                if player.is_paused() { "  ❚❚" } else { "" },
                if renderer.reflection_on() { "" } else { "  no-glass" },
            );
            if new_title != last_title {
                window.set_title(&new_title).ok();
                last_title = new_title;
            }
            last_title_at = Instant::now();
        }
    }

    player.shutdown();
    Ok(())
}

fn build_settings(
    data_dir: &std::path::Path,
    args: &args::Args,
    preset: &str,
) -> Result<Settings> {
    let mut settings = Settings::load_preset(data_dir, preset)?;
    for (key, value) in &args.overrides {
        settings
            .set_key(key, value)
            .with_context(|| format!("--set {key}={value}"))?;
    }
    if let Some(mask) = &args.mask {
        settings.mask_bitmap = mask.clone();
    }
    if let Some(analog) = args.analog {
        settings.analog = analog;
    }
    if let Some(lines) = args.lines {
        settings.scanline_count = lines.clamp(60, 1080);
    }
    if args.no_vignette {
        settings.vignette = 0.0;
    }
    // Resolve the mask now so an unknown name fails before the window opens.
    settings.mask_file(data_dir)?;
    Ok(settings)
}

fn apply_preset(
    renderer: &mut crt::CrtRenderer,
    gl: &glow::Context,
    data_dir: &std::path::Path,
    args: &args::Args,
    name: &str,
) -> Result<()> {
    let mut settings = build_settings(data_dir, args, name)?;
    // The scanline count sizes the framebuffers, so it cannot change live.
    settings.scanline_count = renderer.settings.scanline_count;
    renderer.apply_settings(gl, settings)?;
    Ok(())
}

fn file_name(path: &std::path::Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("video")
        .to_string()
}

fn clock(seconds: f64) -> String {
    let s = seconds.max(0.0) as u64;
    let (h, m, s) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

fn unix_time() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
