
import { Track } from '../types';
import { CONFIG } from '../config';

export const searchYouTube = async (query: string): Promise<Track[]> => {
  // 1. If API Key exists, try real fetch
  if (CONFIG.YOUTUBE_API_KEY) {
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=10&q=${encodeURIComponent(query)}&type=video&key=${CONFIG.YOUTUBE_API_KEY}`
      );
      
      if (!response.ok) throw new Error("YouTube API Error");
      
      const data = await response.json();
      
      return data.items.map((item: any) => ({
        id: `yt-${item.id.videoId}`,
        file: new File([], "yt_stream"),
        name: item.snippet.title,
        artist: item.snippet.channelTitle,
        album: "YouTube",
        format: "STREAM",
        isLiked: false,
        dateAdded: Date.now(),
        image: item.snippet.thumbnails.high.url,
        source: 'youtube',
        duration: 0, // Duration requires a second API call (videos endpoint), skipping for speed
        path: `https://www.youtube.com/watch?v=${item.id.videoId}` // Needs YTDL backend to play
      }));

    } catch (e) {
      console.warn("YouTube API failed, falling back to mock.", e);
    }
  }

  // 2. Fallback Mock Generator (for development/demo without billing)
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
      image: `https://source.unsplash.com/random/300x300/?music,${query},${i}`,
      source: 'youtube',
      duration: 180 + Math.floor(Math.random() * 120),
      path: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' // Demo Audio
  });

  return [generateResult(0), generateResult(1), generateResult(2), generateResult(3)];
};
