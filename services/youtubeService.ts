
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../types';

interface YouTubeItem {
  id: { videoId: string };
  snippet: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      high?: { url: string };
      default?: { url: string };
    };
  };
}

const isValidYouTubeItem = (item: any): item is YouTubeItem => {
  return (
    item &&
    typeof item === 'object' &&
    item.id &&
    typeof item.id === 'object' &&
    typeof item.id.videoId === 'string' &&
    item.snippet &&
    typeof item.snippet === 'object'
  );
};

export const searchYouTube = async (query: string): Promise<Track[]> => {
  try {
    const data: any = await invoke('search_youtube', { query });
    
    if (data && typeof data === 'object' && Array.isArray(data.items)) {
      return data.items
        .filter(isValidYouTubeItem)
        .map((item: YouTubeItem) => ({
          id: `yt-${item.id.videoId}`,
          file: new File([], "yt_stream"),
          name: item.snippet.title || "Unknown Title",
          artist: item.snippet.channelTitle || "Unknown Artist",
          album: "YouTube",
          format: "STREAM",
          isLiked: false,
          dateAdded: Date.now(),
          image: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || "",
          source: 'youtube',
          duration: 0,
          path: `https://www.youtube.com/watch?v=${item.id.videoId}`
        }));
    }
  } catch (e) {
    console.warn("YouTube API backend call failed, falling back to mock.", e);
  }

  // Fallback Mock Generator (for development/demo without billing)
  await new Promise(resolve => setTimeout(resolve, 600));

  const generateResult = (i: number): Track => ({
      id: `yt-${crypto.randomUUID()}`,
      file: new File([], "yt_stream"),
      name: `${query} ${i === 0 ? '(Official Video)' : i === 1 ? '(Live)' : '(Remix)'}`,
      artist: `Artist ${query.substring(0, 5)}`,
      album: "YouTube Music",
      format: "WEBM", 
      isLiked: false,
      dateAdded: Date.now(),
      image: `https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=300&auto=format&fit=crop`,
      source: 'youtube',
      duration: 180 + Math.floor(Math.random() * 120),
      path: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' // Demo Audio
  });

  return [generateResult(0), generateResult(1), generateResult(2), generateResult(3)];
};
