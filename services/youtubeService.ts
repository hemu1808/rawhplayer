import { invoke } from '@tauri-apps/api/core';
import type { Track } from '../types';

// Search metadata is not an audio stream. Callers must use an official provider playback integration.
export async function searchYouTube(query: string): Promise<Track[]> {
  if (!query.trim() || query.length > 256) throw new Error('Enter a search query of 1–256 characters.');
  const data = await invoke<unknown>('search_youtube', { query: query.trim() });
  if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items))
    throw new Error('Invalid search response.');
  return data.items.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || !('snippet' in item)) return [];
    const id = item.id;
    const snippet = item.snippet;
    if (
      !id ||
      typeof id !== 'object' ||
      !('videoId' in id) ||
      typeof id.videoId !== 'string' ||
      !snippet ||
      typeof snippet !== 'object' ||
      !('title' in snippet) ||
      typeof snippet.title !== 'string'
    )
      return [];
    return [
      {
        id: 'yt-' + id.videoId,
        name: snippet.title,
        artist:
          'channelTitle' in snippet && typeof snippet.channelTitle === 'string'
            ? snippet.channelTitle
            : 'Unknown artist',
        source: 'youtube' as const,
        album: 'YouTube',
        format: 'ONLINE',
        dateAdded: Date.now(),
      },
    ];
  });
}
