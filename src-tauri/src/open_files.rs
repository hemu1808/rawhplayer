//! Only native launch arguments and OS file-open events can create these grants.
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

const MAX_PENDING: usize = 1000;

#[derive(Default)]
pub struct OpenFiles(Mutex<Vec<String>>);

fn audio_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<String> {
    let mut selected = Vec::new();
    for path in paths.into_iter().take(MAX_PENDING) {
        let supported = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                ["mp3", "flac", "wav", "ogg", "aac", "m4a", "aiff"]
                    .contains(&value.to_ascii_lowercase().as_str())
            });
        if !supported {
            continue;
        }
        let Ok(path) = std::fs::canonicalize(path) else {
            continue;
        };
        if !path.is_file() {
            continue;
        }
        let path = path.to_string_lossy().into_owned();
        if !selected.contains(&path) {
            selected.push(path);
        }
    }
    selected
}

pub fn queue_paths(app: &tauri::AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let paths = audio_paths(paths);
    if paths.is_empty() {
        return;
    }
    let state = app.state::<OpenFiles>();
    let mut pending = state.0.lock();
    for path in paths {
        if pending.len() >= MAX_PENDING {
            break;
        }
        if !pending.contains(&path) {
            pending.push(path);
        }
    }
    drop(pending);
    let _ = app.emit("open_files_pending", ());
}

pub fn queue_arguments(app: &tauri::AppHandle, args: Vec<String>, cwd: &Path) {
    queue_paths(app, args.into_iter().skip(1).map(|arg| cwd.join(arg)));
}

#[tauri::command]
pub async fn take_open_files(
    app: tauri::AppHandle,
) -> Result<Vec<crate::library::LibraryTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = std::mem::take(&mut *app.state::<OpenFiles>().0.lock());
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        let library = app.state::<crate::library::NativeLibrary>();
        library.authorize_paths(&paths)?;
        library.import_paths(paths)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_files_must_exist_and_be_audio_files_not_directories_or_urls() {
        let root = std::env::temp_dir().join(format!(
            "rawh-open-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let audio = root.join("selected.WAV");
        let text = root.join("private.txt");
        let directory = root.join("folder.wav");
        std::fs::write(&audio, b"fixture").unwrap();
        std::fs::write(&text, b"unrelated").unwrap();
        std::fs::create_dir(&directory).unwrap();
        let selected = audio_paths(vec![
            audio.clone(),
            text,
            directory,
            root.join("missing.wav"),
            PathBuf::from("https://example.com/music.wav"),
            audio.clone(),
        ]);
        assert_eq!(
            selected,
            vec![std::fs::canonicalize(audio)
                .unwrap()
                .to_string_lossy()
                .into_owned()]
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
