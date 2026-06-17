import { invoke } from '@tauri-apps/api/core';

export const getTrackInsight = async (artist: string, title: string): Promise<string> => {
  try {
    const insight: string = await invoke('get_track_insight', { artist, title });
    return insight;
  } catch (error) {
    console.error("Error fetching Gemini insight from backend:", error);
    return "Could not retrieve AI insight at this time.";
  }
};