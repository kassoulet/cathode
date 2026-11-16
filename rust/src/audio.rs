//! A lock-free-ish audio queue fed by the decoder and drained by SDL.
//!
//! The queue is also the master clock: `head_pts` is the presentation time of
//! the sample at the head of the queue, so the video thread can pace itself
//! against what the sound card is actually playing.

use sdl2::audio::{AudioCallback, AudioDevice, AudioSpecDesired};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub const RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;

pub struct Ring {
    pub buf: VecDeque<f32>,
    pub head_pts: f64,
    pub rate: u32,
    pub volume: f32,
}

impl Ring {
    pub fn new(rate: u32, head_pts: f64) -> Self {
        Self {
            buf: VecDeque::new(),
            head_pts,
            rate,
            volume: 1.0,
        }
    }

    /// Queue interleaved stereo f32 samples whose first frame is at `pts`.
    pub fn push(&mut self, samples: &[f32], pts: f64) {
        if self.buf.is_empty() {
            self.head_pts = pts;
        }
        self.buf.extend(samples.iter().copied());
    }

    pub fn clear(&mut self, pts: f64) {
        self.buf.clear();
        self.head_pts = pts;
    }

    pub fn buffered_seconds(&self) -> f64 {
        self.buf.len() as f64 / (CHANNELS as f64 * self.rate as f64)
    }

    fn pull(&mut self, out: &mut [f32]) {
        let frames = out.len() / CHANNELS;
        let vol = self.volume;
        for frame in 0..frames {
            for ch in 0..CHANNELS {
                let sample = self.buf.pop_front().unwrap_or(0.0);
                out[frame * CHANNELS + ch] = sample * vol;
            }
        }
        self.head_pts += frames as f64 / self.rate as f64;
    }
}

pub struct Sink {
    ring: Arc<Mutex<Ring>>,
}

impl AudioCallback for Sink {
    type Channel = f32;

    fn callback(&mut self, out: &mut [f32]) {
        if let Ok(mut ring) = self.ring.lock() {
            ring.pull(out);
        } else {
            out.fill(0.0);
        }
    }
}

pub struct AudioOutput {
    device: AudioDevice<Sink>,
    ring: Arc<Mutex<Ring>>,
    running: bool,
}

impl AudioOutput {
    pub fn new(
        subsystem: &sdl2::AudioSubsystem,
        ring: Arc<Mutex<Ring>>,
    ) -> Result<Self, String> {
        let desired = AudioSpecDesired {
            freq: Some(RATE as i32),
            channels: Some(CHANNELS as u8),
            samples: Some(1024),
        };
        let sink_ring = ring.clone();
        let device = subsystem.open_playback::<Sink, _, _>(None, &desired, move |_spec| Sink {
            ring: sink_ring,
        })?;

        let spec = device.spec();
        if spec.freq != RATE as i32 || spec.channels as usize != CHANNELS {
            return Err(format!(
                "audio device opened as {} Hz / {} ch, need {} Hz / {} ch",
                spec.freq, spec.channels, RATE, CHANNELS
            ));
        }

        device.pause();
        Ok(Self {
            device,
            ring,
            running: false,
        })
    }

    pub fn resume(&mut self) {
        if !self.running {
            self.device.resume();
            self.running = true;
        }
    }

    pub fn pause(&mut self) {
        if self.running {
            self.device.pause();
            self.running = false;
        }
    }

    pub fn set_volume(&self, volume: f32) {
        if let Ok(mut ring) = self.ring.lock() {
            ring.volume = volume.clamp(0.0, 1.0);
        }
    }

    pub fn buffered_seconds(&self) -> f64 {
        self.ring.lock().map(|r| r.buffered_seconds()).unwrap_or(0.0)
    }

    pub fn position(&self) -> f64 {
        self.ring.lock().map(|r| r.head_pts).unwrap_or(0.0)
    }

    pub fn clear(&self, pts: f64) {
        if let Ok(mut ring) = self.ring.lock() {
            ring.clear(pts);
        }
    }
}
