use super::{
    super::{check_deadline, RenderNotice, TrackEvent},
    decoder::ResampledTrack,
    output::{self, OutputDevice, OutputPort, OutputSignals},
};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
    Arc, Weak,
};
use std::time::{Duration, Instant};

#[derive(Default)]
pub(crate) struct Revision(Arc<AtomicU64>);

impl Revision {
    pub fn advance(&self) -> Stamp {
        Stamp {
            value: self.0.fetch_add(1, Ordering::AcqRel) + 1,
            revision: self.0.clone(),
        }
    }
}

pub(crate) struct Stamp {
    revision: Arc<AtomicU64>,
    value: u64,
}

impl Stamp {
    pub fn is_current(&self) -> bool {
        self.revision.load(Ordering::Acquire) == self.value
    }

    pub fn check(&self, deadline: Instant) -> Result<(), String> {
        if !self.is_current() {
            return Err("A newer audio operation replaced this request.".into());
        }
        check_deadline(deadline)
    }
}

#[derive(Clone)]
pub(crate) struct Reply {
    pub sender: SyncSender<Result<(), String>>,
    pub deadline: Instant,
}

impl Reply {
    pub fn finish(self, result: Result<(), String>) {
        let _ = self.sender.send(result);
    }
}

#[derive(Clone, Copy)]
pub(crate) enum TrackAction {
    Play(Option<f64>),
    Seek(f64),
    Queue,
}

pub(crate) struct TrackJob {
    pub action: TrackAction,
    pub stamp: Stamp,
    pub generation: u64,
    pub path: String,
    pub queue_id: String,
    pub sample_rate: u32,
    pub speed: f32,
    pub reply: Reply,
}

pub(crate) struct DeviceJob {
    pub id: Option<String>,
    pub stamp: Stamp,
    pub generation: u64,
    pub resume: Option<TrackEvent>,
    pub speed: f32,
    pub reply: Option<Reply>,
}

pub(crate) enum Prepared {
    Track(TrackJob, Result<ResampledTrack, String>),
    Device(
        DeviceJob,
        Result<OutputPort, String>,
        Result<Option<ResampledTrack>, String>,
    ),
}

type Job<S> = Box<dyn FnOnce(&mut S) + Send>;
type Streams = Vec<(Weak<()>, cpal::Stream)>;

fn spawn<S: Default + 'static>(
    name: &str,
    prune: fn(&mut S),
) -> Result<SyncSender<Job<S>>, String> {
    let (sender, receiver) = mpsc::sync_channel::<Job<S>>(16);
    std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let mut state = S::default();
            loop {
                prune(&mut state);
                match receiver.recv_timeout(Duration::from_millis(100)) {
                    Ok(job) => job(&mut state),
                    Err(RecvTimeoutError::Timeout) => (),
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(sender)
}

pub(crate) struct Preparation {
    foreground: SyncSender<Job<()>>,
    preload: SyncSender<Job<()>>,
    output: SyncSender<Job<Streams>>,
    completed: mpsc::Sender<Prepared>,
    pub results: Receiver<Prepared>,
}

impl Preparation {
    pub fn new() -> Result<Self, String> {
        let (completed, results) = mpsc::channel();
        Ok(Self {
            foreground: spawn("rawh-decoder-open", |_| ())?,
            preload: spawn("rawh-decoder-preload", |_| ())?,
            output: spawn("rawh-output-device", |streams: &mut Streams| {
                streams.retain(|(lease, _)| lease.strong_count() != 0);
            })?,
            completed,
            results,
        })
    }

    pub fn track(&self, job: TrackJob) -> Result<(), String> {
        let worker = if matches!(job.action, TrackAction::Queue) {
            &self.preload
        } else {
            &self.foreground
        };
        let completed = self.completed.clone();
        worker
            .try_send(Box::new(move |_| {
                let result = (|| {
                    job.stamp.check(job.reply.deadline)?;
                    let mut track = ResampledTrack::new(&job.path, job.queue_id.clone())?;
                    match job.action {
                        TrackAction::Seek(position) => track.seek(position)?,
                        TrackAction::Play(Some(position))
                            if track.decoder.info.duration <= 0.0
                                || position < track.decoder.info.duration =>
                        {
                            track.seek(position)?;
                        }
                        _ => (),
                    }
                    track.prepare_output(job.sample_rate, job.speed)?;
                    Ok(track)
                })();
                let _ = completed.send(Prepared::Track(job, result));
            }))
            .map_err(|_| "Audio decoder preparation is busy or unavailable.".into())
    }

    pub fn device(
        &self,
        job: DeviceJob,
        signals: Arc<OutputSignals>,
        notices: SyncSender<RenderNotice>,
    ) -> Result<(), String> {
        let completed = self.completed.clone();
        let deadline = job.reply.as_ref().map_or_else(
            || Instant::now() + Duration::from_secs(15),
            |reply| reply.deadline,
        );
        self.output
            .try_send(Box::new(move |streams| {
                let output = (|| {
                    job.stamp.check(deadline)?;
                    let OutputDevice { stream, port } =
                        output::open(job.id.as_deref(), signals.clone(), notices, false)?;
                    // CPAL creates and drops streams on this thread. Rendering
                    // owns only the channel endpoint and its stream lease.
                    streams.push((Arc::downgrade(&port.lease), stream));
                    Ok(port)
                })();
                let resume = if let Ok(port) = &output {
                    job.resume
                        .as_ref()
                        .map(|event| {
                            job.stamp.check(deadline)?;
                            let position = f64::from_bits(signals.position.load(Ordering::Acquire));
                            let position = if event.duration > 0.0 {
                                position.min(event.duration)
                            } else {
                                position
                            };
                            let mut track =
                                ResampledTrack::new(&event.path, event.queue_id.clone())?;
                            track.seek(position)?;
                            track.prepare_output(port.sample_rate, job.speed)?;
                            Ok(track)
                        })
                        .transpose()
                } else {
                    Ok(None)
                };
                let _ = completed.send(Prepared::Device(job, output, resume));
            }))
            .map_err(|_| "Audio device preparation is busy or unavailable.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_work_invalidates_prepared_results_on_the_render_thread() {
        let revision = Revision::default();
        let old = revision.advance();
        let current = revision.advance();
        let deadline = Instant::now() + Duration::from_secs(1);
        assert!(old.check(deadline).is_err());
        assert!(current.check(deadline).is_ok());
    }
}
