use parking_lot::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

#[derive(Default)]
pub struct DesktopState(Mutex<Option<WindowGeometry>>);
type WindowGeometry = (PhysicalSize<u32>, PhysicalPosition<i32>, bool);

#[tauri::command]
pub fn set_compact_mode(app: tauri::AppHandle, compact: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Player window unavailable")?;
    let state = app.state::<DesktopState>();
    let mut saved = state.0.lock();
    if compact && saved.is_none() {
        let previous = (
            window.inner_size().map_err(|e| e.to_string())?,
            window.outer_position().map_err(|e| e.to_string())?,
            window.is_maximized().map_err(|e| e.to_string())?,
        );
        *saved = Some(previous);
        window.unmaximize().map_err(|e| e.to_string())?;
        window
            .set_min_size(Some(tauri::LogicalSize::new(360.0, 140.0)))
            .map_err(|e| e.to_string())?;
        window
            .set_size(tauri::LogicalSize::new(440.0, 150.0))
            .map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
    } else if !compact {
        if let Some((size, position, maximized)) = *saved {
            window.set_always_on_top(false).map_err(|e| e.to_string())?;
            window
                .set_min_size(Some(tauri::LogicalSize::new(800.0, 600.0)))
                .map_err(|e| e.to_string())?;
            window.set_size(size).map_err(|e| e.to_string())?;
            window.set_position(position).map_err(|e| e.to_string())?;
            if maximized {
                window.maximize().map_err(|e| e.to_string())?;
            }
            *saved = None;
        }
    }
    app.emit("compact_mode_changed", compact)
        .map_err(|e| e.to_string())
}

pub fn restore_normal_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let size = window
            .inner_size()?
            .to_logical::<f64>(window.scale_factor()?);
        window.set_always_on_top(false)?;
        window.set_min_size(Some(tauri::LogicalSize::new(800.0, 600.0)))?;
        if size.width < 800.0 || size.height < 600.0 {
            window.set_size(tauri::LogicalSize::new(1000.0, 700.0))?;
        }
    }
    Ok(())
}

pub fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };
    let show = MenuItem::with_id(app, "show", "Show player", true, None::<&str>)?;
    let play = MenuItem::with_id(app, "play", "Play / pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next track", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous track", true, None::<&str>)?;
    let compact = MenuItem::with_id(app, "compact", "Compact player", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &play, &next, &previous, &compact, &quit])?;
    let mut tray = TrayIconBuilder::with_id("player")
        .tooltip("RawhPlayer")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                let _ = set_compact_mode(app.clone(), false);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "play" => {
                let _ = app.emit("media_play_pause", ());
            }
            "next" => {
                let _ = app.emit("media_next", ());
            }
            "previous" => {
                let _ = app.emit("media_prev", ());
            }
            "compact" => {
                let _ = set_compact_mode(app.clone(), true);
            }
            "quit" => app.exit(0),
            _ => (),
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
