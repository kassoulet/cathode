//! ffmpeg decoding: one thread demuxes/decodes both streams, scales video to
//! the CRT's virtual resolution and queues PCM into the SDL audio ring, which
//! doubles as the master clock.

use crate::audio::{AudioOutput, Ring, CHANNELS, RATE};
use anyhow::{anyhow, Context, Result};
use ffmpeg::format::Pixel;
use ffmpeg::media::Type;
use ffmpeg::software::scaling;
use ffmpeg::util::frame;
use ffmpeg::Rational;
use ffmpeg_next as ffmpeg;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Decoded video frames that may sit between the decoder and the UI.
const VIDEO_QUEUE: usize = 8;
/// Audio buffered ahead of the sound card.
const AUDIO_MAX_BUFFER: f64 = 1.5;
/// Audio buffered before the sound card starts.
const AUDIO_PREBUFFER: f64 = 0.15;

#[derive(Clone, Debug)]
pub struct MediaInfo {
    pub width: u32,
    pub height: u32,
    pub display_aspect: f32,
    pub fps: f32,
    pub duration: f64,
    pub has_audio: bool,
}

pub struct VideoFrame {
    pub data: Vec<u8>,
    pub pts: f64,
    pub width: u32,
    pub height: u32,
}

enum Output {
    Frame(VideoFrame),
    Seeked,
    Eof,
    Error(String),
}

pub struct Player {
    rx: Receiver<Output>,
    seek_req: Arc<Mutex<Option<f64>>>,
    paused_flag: Arc<AtomicBool>,
    quit: Arc<AtomicBool>,

    pub audio: Option<AudioOutput>,

    pending: Option<VideoFrame>,
    pub current: Option<VideoFrame>,
    pub error: Option<String>,
    pub eof: bool,

    paused: bool,
    awaiting_seek: bool,
    step_frame: bool,
    started: bool,
    loop_playback: bool,
    duration: f64,

    // wall-clock fallback (no audio track / before audio starts)
    wall_origin: Instant,
    wall_pts: f64,

    volume: f32,
}

impl Player {
    /// Opens the media, sizes the video scaler to `native` and starts decoding.
    pub fn open(
        path: &Path,
        native: (u32, u32),
        start: f64,
        volume: f32,
        loop_playback: bool,
        audio_subsystem: &sdl2::AudioSubsystem,
    ) -> Result<Self> {
        let info = probe(path)?;

        let ring = Arc::new(Mutex::new(Ring::new(RATE, start)));
        let audio = if info.has_audio {
            let out = AudioOutput::new(audio_subsystem, ring.clone())
                .map_err(|e| anyhow!("audio: {e}"))?;
            out.set_volume(volume);
            Some(out)
        } else {
            None
        };

        let (tx, rx) = sync_channel::<Output>(VIDEO_QUEUE);
        let seek_req = Arc::new(Mutex::new(None));
        let paused_flag = Arc::new(AtomicBool::new(false));
        let quit = Arc::new(AtomicBool::new(false));

        let cfg = DecodeConfig {
            path: path.to_path_buf(),
            native,
            start,
            ring: ring.clone(),
            tx,
            seek_req: seek_req.clone(),
            paused: paused_flag.clone(),
            quit: quit.clone(),
            fps: info.fps as f64,
        };

        std::thread::Builder::new()
            .name("decode".to_string())
            .spawn(move || {
                if let Err(err) = decoder_loop(&cfg) {
                    let _ = cfg.tx.try_send(Output::Error(format!("{err:#}")));
                }
            })
            .context("spawning decoder thread")?;

        let duration = info.duration;
        Ok(Self {
            rx,
            seek_req,
            paused_flag,
            quit,
            audio,
            pending: None,
            current: None,
            error: None,
            eof: false,
            paused: false,
            awaiting_seek: false,
            step_frame: false,
            started: false,
            loop_playback,
            duration,
            wall_origin: Instant::now(),
            wall_pts: start,
            volume,
        })
    }

    pub fn duration(&self) -> f64 {
        self.duration
    }

    /// Playback position in seconds. Audio is the master clock when present.
    pub fn position(&self) -> f64 {
        if self.paused || !self.started {
            return self.wall_pts;
        }
        if let Some(audio) = &self.audio {
            return audio.position();
        }
        let pos = self.wall_pts + self.wall_origin.elapsed().as_secs_f64();
        if self.duration > 0.0 {
            pos.min(self.duration)
        } else {
            pos
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn set_paused(&mut self, paused: bool) {
        if paused == self.paused {
            return;
        }
        if paused {
            self.wall_pts = self.position();
            if let Some(audio) = &mut self.audio {
                audio.pause();
            }
        } else {
            self.wall_origin = Instant::now();
            if let Some(audio) = &mut self.audio {
                if self.started {
                    audio.resume();
                }
            }
        }
        self.paused = paused;
        self.paused_flag.store(paused, Ordering::Relaxed);
    }

    pub fn toggle_pause(&mut self) {
        self.set_paused(!self.paused);
    }

    pub fn seek(&mut self, seconds: f64) {
        let target = if self.duration > 0.0 {
            seconds.clamp(0.0, self.duration)
        } else {
            seconds.max(0.0)
        };
        *self.seek_req.lock().unwrap() = Some(target);

        // Drop everything queued and re-anchor clocks immediately; the decoder
        // acknowledges with Seeked once it has actually repositioned.
        self.pending = None;
        self.eof = false;
        self.awaiting_seek = true;
        self.step_frame = self.paused;
        self.wall_pts = target;
        self.wall_origin = Instant::now();
        if let Some(audio) = &self.audio {
            audio.clear(target);
        }
    }

    pub fn seek_relative(&mut self, delta: f64) {
        self.seek(self.position() + delta);
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        if let Some(audio) = &self.audio {
            audio.set_volume(self.volume);
        }
    }

    pub fn volume(&self) -> f32 {
        self.volume
    }

    /// Service decoder events. Returns true when a new video frame is ready to
    /// be uploaded to the GPU.
    pub fn update(&mut self) -> bool {
        if self.paused {
            return self.update_paused();
        }

        // Drain control events until we have a frame, or nothing left.
        loop {
            match self.rx.try_recv() {
                Ok(Output::Frame(frame)) => {
                    if !self.awaiting_seek {
                        self.pending = Some(frame);
                        break;
                    }
                }
                Ok(Output::Seeked) => self.awaiting_seek = false,
                Ok(Output::Eof) => {
                    self.eof = true;
                    self.started = true;
                }
                Ok(Output::Error(err)) => {
                    self.error = Some(err);
                    break;
                }
                Err(_) => break,
            }
        }

        // Start the sound card once enough audio has been pre-buffered.
        if let Some(audio) = &mut self.audio {
            if !self.started && !self.awaiting_seek && audio.buffered_seconds() >= AUDIO_PREBUFFER {
                audio.resume();
                self.started = true;
                self.wall_pts = audio.position();
                self.wall_origin = Instant::now();
            }
        } else if !self.started && !self.awaiting_seek {
            self.started = true;
            self.wall_origin = Instant::now();
        }

        if self.eof && self.pending.is_none() {
            if self.loop_playback && self.duration > 0.0 {
                self.seek(0.0);
            }
            return false;
        }

        // Pick the next frame whose timestamp is due.
        let pos = self.position();
        while let Some(frame) = self.pending.take() {
            if frame.pts + 0.100 < pos {
                continue; // too late, drop it
            }
            if frame.pts > pos + 0.004 {
                self.pending = Some(frame);
                break;
            }
            if self.current.as_ref().is_some_and(|prev| frame.pts <= prev.pts) {
                continue;
            }
            self.current = Some(frame);
            return true;
        }
        false
    }

    fn update_paused(&mut self) -> bool {
        // While paused the decoder only produces a frame after a seek (a
        // "step"), so anything else still in the queue is stale.
        let mut stepped = None;
        loop {
            match self.rx.try_recv() {
                Ok(Output::Frame(frame)) => {
                    if self.step_frame && !self.awaiting_seek {
                        stepped = Some(frame);
                        self.step_frame = false;
                    }
                }
                Ok(Output::Seeked) => self.awaiting_seek = false,
                Ok(Output::Eof) => self.eof = true,
                Ok(Output::Error(err)) => {
                    self.error = Some(err);
                    break;
                }
                Err(_) => break,
            }
            if stepped.is_some() {
                break;
            }
        }
        self.pending = None;
        if let Some(frame) = stepped {
            self.current = Some(frame);
            true
        } else {
            false
        }
    }

    pub fn shutdown(&mut self) {
        self.quit.store(true, Ordering::Relaxed);
        if let Some(audio) = &mut self.audio {
            audio.pause();
        }
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.quit.store(true, Ordering::Relaxed);
    }
}

//-----------------------------------------------------------------------------
// Probing

pub fn probe(path: &Path) -> Result<MediaInfo> {
    ffmpeg::init().context("initialising ffmpeg")?;
    let ictx =
        ffmpeg::format::input(path).with_context(|| format!("opening {}", path.display()))?;

    let stream = ictx
        .streams()
        .best(Type::Video)
        .ok_or_else(|| anyhow!("{} has no video stream", path.display()))?;

    let params = stream.parameters();
    let mut fps = rational_to_f64(stream.avg_frame_rate());
    if fps <= 0.0 {
        fps = rational_to_f64(stream.rate());
    }

    let decoder = ffmpeg::codec::context::Context::from_parameters(params)
        .with_context(|| format!("opening video decoder for {}", path.display()))?
        .decoder()
        .video()
        .context("video decoder")?;

    let sar = rational_to_f64(decoder.aspect_ratio());
    let sar = if sar.is_finite() && sar > 0.0 { sar } else { 1.0 };
    let width = decoder.width();
    let height = decoder.height();

    let d = ictx.duration() as f64 / 1_000_000.0;
    let duration = if d.is_finite() && d > 0.0 { d } else { 0.0 };

    Ok(MediaInfo {
        width,
        height,
        display_aspect: (width as f64 / height as f64 * sar) as f32,
        fps: if fps > 0.0 { fps as f32 } else { 25.0 },
        duration,
        has_audio: ictx.streams().best(Type::Audio).is_some(),
    })
}

fn rational_to_f64(r: Rational) -> f64 {
    if r.1 == 0 {
        return 0.0;
    }
    r.0 as f64 / r.1 as f64
}

//-----------------------------------------------------------------------------
// Decoder thread

struct DecodeConfig {
    path: PathBuf,
    native: (u32, u32),
    start: f64,
    ring: Arc<Mutex<Ring>>,
    tx: SyncSender<Output>,
    seek_req: Arc<Mutex<Option<f64>>>,
    paused: Arc<AtomicBool>,
    quit: Arc<AtomicBool>,
    fps: f64,
}

fn decoder_loop(cfg: &DecodeConfig) -> Result<()> {
    ffmpeg::init().context("initialising ffmpeg")?;
    let mut ictx =
        ffmpeg::format::input(&cfg.path).with_context(|| format!("opening {}", cfg.path.display()))?;

    let (video_index, video_tb, fps) = {
        let stream = ictx
            .streams()
            .best(Type::Video)
            .ok_or_else(|| anyhow!("no video stream"))?;
        let fps = {
            let r = stream.avg_frame_rate();
            if r.1 > 0 && r.0 > 0 {
                r.0 as f64 / r.1 as f64
            } else {
                cfg.fps
            }
        };
        (stream.index(), stream.time_base(), fps)
    };

    let mut vdec = {
        let stream = ictx.stream(video_index).unwrap();
        ffmpeg::codec::context::Context::from_parameters(stream.parameters())
            .context("video decoder parameters")?
            .decoder()
            .video()
            .context("video decoder")?
    };

    let audio_index = ictx.streams().best(Type::Audio).map(|s| s.index());
    let (mut adec, audio_tb) = if let Some(index) = audio_index {
        let stream = ictx.stream(index).unwrap();
        let tb = stream.time_base();
        let dec = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
            .context("audio decoder parameters")?
            .decoder()
            .audio()
            .context("audio decoder")?;
        (Some(dec), Some(tb))
    } else {
        (None, None)
    };

    let (nw, nh) = cfg.native;
    let mut scaler = scaling::Context::get(
        vdec.format(),
        vdec.width(),
        vdec.height(),
        Pixel::RGBA,
        nw,
        nh,
        scaling::Flags::BILINEAR,
    )
    .context("creating video scaler")?;

    let mut resampler: Option<ffmpeg::software::resampling::Context> = None;
    let mut decoded = frame::Video::empty();
    let mut rgb = frame::Video::new(Pixel::RGBA, nw, nh);

    let mut last_pts = cfg.start;
    let mut at_eof = false;
    let mut pending_seek = Some(cfg.start);
    let mut step = false;

    loop {
        if cfg.quit.load(Ordering::Relaxed) {
            return Ok(());
        }

        if pending_seek.is_none() {
            if let Some(target) = cfg.seek_req.lock().unwrap().take() {
                pending_seek = Some(target);
                step = cfg.paused.load(Ordering::Relaxed);
            }
        }

        if let Some(target) = pending_seek.take() {
            ictx.seek((target * 1_000_000.0) as i64, ..)
                .with_context(|| format!("seeking to {target:.2}s"))?;
            vdec.flush();
            if let Some(dec) = adec.as_mut() {
                dec.flush();
            }
            resampler = None;
            last_pts = target;
            at_eof = false;
            if let Ok(mut ring) = cfg.ring.lock() {
                ring.clear(target);
            }
            if cfg.tx.send(Output::Seeked).is_err() {
                return Ok(());
            }
        }

        if at_eof {
            if let Some(target) = cfg.seek_req.lock().unwrap().take() {
                pending_seek = Some(target);
                continue;
            }
            std::thread::sleep(Duration::from_millis(20));
            continue;
        }

        if cfg.paused.load(Ordering::Relaxed) && !step {
            std::thread::sleep(Duration::from_millis(20));
            continue;
        }

        // Back-pressure from the audio queue: decode at most a little ahead of
        // what the sound card is playing.
        if adec.is_some() {
            loop {
                let buffered = cfg
                    .ring
                    .lock()
                    .map(|r| r.buffered_seconds())
                    .unwrap_or(0.0);
                if buffered <= AUDIO_MAX_BUFFER
                    || cfg.quit.load(Ordering::Relaxed)
                    || cfg.seek_req.lock().unwrap().is_some()
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        let next = ictx.packets().next();
        let (stream_index, packet) = match next {
            Some((stream, packet)) => (stream.index(), packet),
            None => {
                let _ = vdec.send_eof();
                drain_video(
                    &mut vdec,
                    &mut decoded,
                    &mut rgb,
                    &mut scaler,
                    cfg,
                    video_tb,
                    fps,
                    &mut last_pts,
                    &mut step,
                )?;
                if let Some(dec) = adec.as_mut() {
                    let _ = dec.send_eof();
                    drain_audio(dec, &mut resampler, cfg, audio_tb)?;
                }
                at_eof = true;
                if cfg.tx.send(Output::Eof).is_err() {
                    return Ok(());
                }
                continue;
            }
        };

        if stream_index == video_index {
            if vdec.send_packet(&packet).is_err() {
                continue;
            }
            drain_video(
                &mut vdec,
                &mut decoded,
                &mut rgb,
                &mut scaler,
                cfg,
                video_tb,
                fps,
                &mut last_pts,
                &mut step,
            )?;
        } else if Some(stream_index) == audio_index {
            if let Some(dec) = adec.as_mut() {
                if dec.send_packet(&packet).is_err() {
                    continue;
                }
                drain_audio(dec, &mut resampler, cfg, audio_tb)?;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn drain_video(
    dec: &mut ffmpeg::codec::decoder::Video,
    decoded: &mut frame::Video,
    rgb: &mut frame::Video,
    scaler: &mut scaling::Context,
    cfg: &DecodeConfig,
    time_base: Rational,
    fps: f64,
    last_pts: &mut f64,
    step: &mut bool,
) -> Result<()> {
    while dec.receive_frame(decoded).is_ok() {
        let pts = decoded
            .pts()
            .map(|p| timestamp(p, time_base))
            .unwrap_or(*last_pts + 1.0 / fps.max(1.0));
        *last_pts = pts;

        scaler
            .run(decoded, rgb)
            .context("scaling video frame")?;

        let (nw, nh) = cfg.native;
        let stride = rgb.stride(0);
        let src = rgb.data(0);
        let row = (nw * 4) as usize;
        let mut data = vec![0u8; row * nh as usize];
        // Frames arrive top-down, OpenGL wants the first row at v = 0.
        for y in 0..nh as usize {
            let sy = nh as usize - 1 - y;
            let start = sy * stride;
            data[y * row..y * row + row].copy_from_slice(&src[start..start + row]);
        }

        let msg = Output::Frame(VideoFrame {
            data,
            pts,
            width: nw,
            height: nh,
        });
        if !send_interruptible(&cfg.tx, msg, cfg) {
            return Ok(());
        }

        if *step {
            *step = false;
            return Ok(());
        }
    }
    Ok(())
}

fn drain_audio(
    dec: &mut ffmpeg::codec::decoder::Audio,
    resampler: &mut Option<ffmpeg::software::resampling::Context>,
    cfg: &DecodeConfig,
    time_base: Option<Rational>,
) -> Result<()> {
    let mut decoded = frame::Audio::empty();
    while dec.receive_frame(&mut decoded).is_ok() {
        let pts = decoded
            .pts()
            .and_then(|p| time_base.map(|tb| timestamp(p, tb)))
            .unwrap_or(0.0);

        if resampler.is_none() {
            let layout = {
                let l = decoded.channel_layout();
                if l.bits() == 0 {
                    ffmpeg::ChannelLayout::STEREO
                } else {
                    l
                }
            };
            let ctx = ffmpeg::software::resampling::Context::get(
                decoded.format(),
                layout,
                decoded.rate(),
                ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Packed),
                ffmpeg::ChannelLayout::STEREO,
                RATE,
            )
            .context("creating audio resampler")?;
            *resampler = Some(ctx);
        }

        let mut out = frame::Audio::empty();
        resampler
            .as_mut()
            .unwrap()
            .run(&decoded, &mut out)
            .context("resampling audio")?;

        let samples = out.samples();
        if samples == 0 {
            continue;
        }
        let plane = out.plane::<f32>(0);
        let n = (samples * CHANNELS).min(plane.len());
        if n == 0 || cfg.paused.load(Ordering::Relaxed) {
            continue;
        }
        if let Ok(mut ring) = cfg.ring.lock() {
            if ring.buffered_seconds() <= AUDIO_MAX_BUFFER {
                ring.push(&plane[..n], pts);
            }
        }
    }
    Ok(())
}

fn timestamp(ts: i64, tb: Rational) -> f64 {
    ts as f64 * rational_to_f64(tb)
}

/// Send without ever blocking on pause/seek/quit.
fn send_interruptible(tx: &SyncSender<Output>, mut msg: Output, cfg: &DecodeConfig) -> bool {
    loop {
        if cfg.quit.load(Ordering::Relaxed) {
            return false;
        }
        if cfg.seek_req.lock().unwrap().is_some() {
            return false;
        }
        match tx.try_send(msg) {
            Ok(()) => return true,
            Err(TrySendError::Full(returned)) => {
                msg = returned;
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(TrySendError::Disconnected(_)) => return false,
        }
    }
}
