//! Native command signatures are reflected by Specta; CI rejects stale TypeScript bindings.
#[cfg(test)]
use specta_typescript::{BigIntExportBehavior, Typescript};
pub fn builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .commands(tauri_specta::collect_commands![
            crate::pick_music,
            crate::open_files::take_open_files,
            crate::desktop::set_compact_mode,
            crate::policy::deployment_policy,
            crate::library::library_load,
            crate::library::library_migrate_legacy,
            crate::library::library_save,
            crate::library::library_import_paths,
            crate::library::library_remove_track,
            crate::library::library_locate_track,
            crate::library::library_reconcile,
            crate::library::library_cancel_scan,
            crate::library::library_search,
            crate::library::library_export,
            crate::library::library_restore,
            crate::library::library_waveform,
            crate::library::library_read_lyrics,
            crate::library::library_update_metadata,
            crate::library::library_undo_metadata,
            crate::play_file,
            crate::toggle_play,
            crate::seek_audio,
            crate::set_volume,
            crate::get_track_insight,
            crate::search_youtube,
            crate::set_equalizer_band,
            crate::set_purist_mode,
            crate::set_playback_rate,
            crate::list_audio_devices,
            crate::set_crossfade_duration,
            crate::queue_next_file,
            crate::get_audio_info,
            crate::stop_audio,
            crate::clear_pending,
            crate::set_paused,
            crate::set_output_device,
            crate::set_normalization,
            crate::support::credential_status,
            crate::support::credential_set,
            crate::support::credential_delete,
            crate::support::diagnostics_export,
            crate::support::update_status,
            crate::watcher::start_watching,
            crate::watcher::stop_watching,
            crate::watcher::get_watched_folders,
            crate::watcher::remove_watched_folder,
            crate::watcher::pick_watched_folder,
            crate::library::catalog::library_bootstrap,
            crate::library::catalog::library_page,
            crate::library::catalog::library_tracks,
            crate::library::catalog::library_track_ids,
            crate::library::catalog::library_groups,
            crate::library::mutations::library_patch,
            crate::library::catalog::play_library_track,
            crate::library::catalog::queue_library_track,
            crate::library::catalog::library_import_catalog,
            crate::library::catalog::library_remove_catalog,
            crate::library::catalog::pick_music_catalog,
            crate::library::catalog::library_restore_catalog,
            crate::library::catalog::library_reconcile_catalog,
            crate::library::analysis::analysis_start,
            crate::library::analysis::analysis_cancel,
            crate::library::analysis::analysis_status,
            crate::library::maintenance::library_maintenance
        ])
        .events(tauri_specta::collect_events![
            crate::library::catalog::CatalogChanged,
            crate::library::analysis::AnalysisProgress,
            crate::audio_engine::TrackEvent,
            crate::audio_engine::EndedEvent,
            crate::audio_engine::AudioInfo
        ])
}
#[cfg(test)]
pub fn bindings() -> Result<String, String> {
    builder()
        .export_str(Typescript::default().bigint(BigIntExportBehavior::Number))
        .map_err(|error| error.to_string())
}
#[cfg(test)]
mod tests {
    #[test]
    fn generated_contracts_are_current() {
        let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../services/generated/native.ts");
        let generated = super::bindings().unwrap();
        if std::env::var_os("RAWH_GENERATE_IPC").is_some() {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, &generated).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(file).expect("Run npm run generate:ipc"),
            generated,
            "Native contracts changed: run npm run generate:ipc"
        );
    }
}
