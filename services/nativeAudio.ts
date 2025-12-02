
// This service bridges the React frontend with the Rust backend via Tauri Invoke
// It enables the "True Hardware Exclusive Mode" by offloading audio processing to Rust.

import { invoke } from '@tauri-apps/api/tauri';

export class NativeAudioService {
  private static isTauri = !!(window as any).__TAURI__;

  static async play(filePath: string): Promise<boolean> {
    if (!this.isTauri) {
        console.warn("Native Audio not available in browser mode.");
        return false;
    }
    try {
      await invoke('play_track', { path: filePath });
      return true;
    } catch (e) {
      console.error("Rust Audio Backend Error:", e);
      return false;
    }
  }

  static async pause(): Promise<void> {
    if (!this.isTauri) return;
    try {
      await invoke('pause_track');
    } catch (e) { console.error(e); }
  }

  static async resume(): Promise<void> {
    if (!this.isTauri) return;
    try {
      await invoke('resume_track');
    } catch (e) { console.error(e); }
  }

  static async stop(): Promise<void> {
    if (!this.isTauri) return;
    try {
      await invoke('stop_track');
    } catch (e) { console.error(e); }
  }

  static async setVolume(volume: number): Promise<void> {
    if (!this.isTauri) return;
    try {
      await invoke('set_volume', { volume });
    } catch (e) { console.error(e); }
  }

  static async seek(position: number): Promise<void> {
    if (!this.isTauri) return;
    try {
        await invoke('seek_track', { position });
    } catch(e) { console.error(e); }
  }
}
