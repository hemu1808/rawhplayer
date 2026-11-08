//! OS controls live on the application thread; the audio callback never accesses them.
use crate::{audio_engine::AudioInfo, library::NativeLibrary};
use souvlaki::{
    MediaControlEvent as Event, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
    PlatformConfig, SeekDirection,
};
use std::{
    cell::RefCell,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

thread_local! { static CONTROLS: RefCell<Option<Session>> = const { RefCell::new(None) }; }
struct Session {
    controls: MediaControls,
    path: Option<String>,
    refreshed: Instant,
}

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    let hwnd = Some(
        app.get_webview_window("main")
            .ok_or("Main window unavailable")?
            .hwnd()
            .map_err(|e| e.to_string())?
            .0,
    );
    #[cfg(not(windows))]
    let hwnd = None;
    let mut controls = MediaControls::new(PlatformConfig {
        display_name: "RawhPlayer",
        dbus_name: "rawhplayer",
        hwnd,
    })
    .map_err(|e| format!("{e:?}"))?;
    let handle = app.clone();
    controls
        .attach(move |event| {
            // Routing through the existing frontend transport preserves queue selection and resume behavior.
            match event {
                Event::Play => {
                    let _ = handle.emit("media_play", ());
                }
                Event::Pause => {
                    let _ = handle.emit("media_pause", ());
                }
                Event::Toggle => {
                    let _ = handle.emit("media_play_pause", ());
                }
                Event::Next => {
                    let _ = handle.emit("media_next", ());
                }
                Event::Previous => {
                    let _ = handle.emit("media_prev", ());
                }
                Event::Stop => {
                    let _ = handle.emit("media_stop", ());
                }
                Event::SetPosition(position) => {
                    let _ = handle.emit("media_position", position.0.as_secs_f64());
                }
                Event::Seek(direction) => {
                    let _ = handle.emit(
                        "media_seek",
                        if direction == SeekDirection::Forward {
                            10.0
                        } else {
                            -10.0
                        },
                    );
                }
                Event::SeekBy(direction, amount) => {
                    let _ = handle.emit(
                        "media_seek",
                        amount.as_secs_f64()
                            * if direction == SeekDirection::Forward {
                                1.0
                            } else {
                                -1.0
                            },
                    );
                }
                Event::SetVolume(volume) => {
                    let _ = handle.emit("media_volume", volume.clamp(0.0, 1.0));
                }
                Event::Raise => {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                Event::Quit => {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.close();
                    }
                }
                _ => (),
            }
        })
        .map_err(|e| format!("{e:?}"))?;
    CONTROLS.with(|slot| {
        *slot.borrow_mut() = Some(Session {
            controls,
            path: None,
            refreshed: Instant::now(),
        })
    });
    Ok(())
}

#[derive(Default)]
pub struct Publisher {
    last: Option<(Option<String>, bool)>,
    at: Option<Instant>,
}
impl Publisher {
    pub fn update(&mut self, app: &tauri::AppHandle, info: &AudioInfo) {
        let state = (info.path.clone(), info.is_playing);
        if self.last.as_ref() == Some(&state)
            && self
                .at
                .is_some_and(|at| at.elapsed() < Duration::from_secs(1))
        {
            return;
        }
        self.last = Some(state);
        self.at = Some(Instant::now());
        let info = info.clone();
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            CONTROLS.with(|slot| {
                let mut slot = slot.borrow_mut();
                let Some(session) = slot.as_mut() else {
                    return;
                };
                if session.path != info.path
                    || session.refreshed.elapsed() >= Duration::from_secs(5)
                {
                    let track = info.path.as_ref().and_then(|path| {
                        handle
                            .state::<NativeLibrary>()
                            .track_at_path(path)
                            .ok()
                            .flatten()
                    });
                    let fallback = info
                        .path
                        .as_ref()
                        .and_then(|path| std::path::Path::new(path).file_stem())
                        .and_then(|name| name.to_str());
                    let cover = track
                        .as_ref()
                        .and_then(|track| track.artwork_path.as_ref())
                        .and_then(|path| tauri::Url::from_file_path(path).ok());
                    let _ = session.controls.set_metadata(MediaMetadata {
                        title: track.as_ref().map(|track| track.name.as_str()).or(fallback),
                        artist: track.as_ref().map(|track| track.artist.as_str()),
                        album: track.as_ref().and_then(|track| track.album.as_deref()),
                        duration: Some(Duration::from_secs_f64(info.duration.max(0.0))),
                        cover_url: cover.as_ref().map(|url| url.as_str()),
                    });
                    session.path = info.path.clone();
                    session.refreshed = Instant::now();
                }
                let progress = Some(MediaPosition(Duration::from_secs_f64(
                    info.current_time.max(0.0),
                )));
                let state = if info.path.is_none() {
                    MediaPlayback::Stopped
                } else if info.is_playing {
                    MediaPlayback::Playing { progress }
                } else {
                    MediaPlayback::Paused { progress }
                };
                let _ = session.controls.set_playback(state);
                #[cfg(target_os = "linux")]
                let _ = session.controls.set_volume(f64::from(info.volume));
            })
        });
    }
}
