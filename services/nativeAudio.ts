
// This service acts as the bridge between the UI and the Rust Native Core.
// It handles platform detection (Desktop vs Mobile) and commands the Audio Engine.

import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';

export class NativeAudioService {
  private static isTauri = !!(window as any).__TAURI__;

  /**
   * Initialize the Native Engine.
   * Checks permissions and audio device availability.
   */
  static async init(): Promise<void> {
    if (!this.isTauri) return;
    try {
        console.log("[NativeEngine] Initializing Rust Core...");
        // In a real Rust setup, this would check for 'cpal' availability
        await invoke('init_audio_engine'); 
    } catch (e) {
        console.warn("[NativeEngine] Init warning:", e);
    }
  }

  /**
   * Plays a track through the OS Native Audio HAL (WASAPI/CoreAudio).
   * Bypasses the Browser Mixer for Bit-Perfect output.
   */
  static async play(filePath: string): Promise<boolean> {
    if (!this.isTauri) {
        console.warn("[NativeEngine] Not in Tauri environment. Fallback to Web Audio.");
        return false;
    }
    try {
      // Send the absolute path to Rust
      await invoke('play_track', { path: filePath });
      return true;
    } catch (e) {
      console.error("[NativeEngine] Play Error:", e);
      return false;
    }
  }

  static async pause(): Promise<void> {
    if (!this.isTauri) return;
    try { await invoke('pause_track'); } catch (e) { console.error(e); }
  }

  static async resume(): Promise<void> {
    if (!this.isTauri) return;
    try { await invoke('resume_track'); } catch (e) { console.error(e); }
  }

  static async stop(): Promise<void> {
    if (!this.isTauri) return;
    try { await invoke('stop_track'); } catch (e) { console.error(e); }
  }

  static async setVolume(volume: number): Promise<void> {
    if (!this.isTauri) return;
    try { await invoke('set_volume', { volume }); } catch (e) { console.error(e); }
  }

  static async seek(position: number): Promise<void> {
    if (!this.isTauri) return;
    try { await invoke('seek_track', { position }); } catch(e) { console.error(e); }
  }

  /**
   * Minimizes the window (Works on Windows/Mac, ignored on Mobile)
   */
  static async minimize() {
      if(this.isTauri) await appWindow.minimize();
  }
}
