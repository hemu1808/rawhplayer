
import { Track } from '../types';
import { searchYouTube } from './youtubeService';

// Enterprise-grade regex for validating URLs
const PATTERNS = {
    SPOTIFY: /open\.spotify\.com\/(playlist|album|track)\/([a-zA-Z0-9]+)/,
    APPLE: /music\.apple\.com\/\w+\/(playlist|album)\/[^/]+\/([a-zA-Z0-9]+)/,
    YOUTUBE: /(youtube\.com|youtu\.be)\/(watch\?v=|playlist\?list=)([a-zA-Z0-9_-]+)/
};

interface ImportResult {
    provider: 'spotify' | 'apple' | 'youtube';
    type: 'playlist' | 'track' | 'album';
    id: string;
    tracks: Track[];
    name: string;
}

/**
 * Simulates fetching playlist metadata from an external provider.
 * In a real backend environment, this would call the Spotify/Apple Music Web APIs.
 */
const fetchExternalMetadata = async (provider: 'spotify' | 'apple' | 'youtube', id: string): Promise<string[]> => {
    // Mock latency
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Mock data generation based on ID seed to make it feel real
    const mockTitles = [
        "Blinding Lights - The Weeknd",
        "Midnight City - M83",
        "Dreams - Fleetwood Mac",
        "Hotel California - Eagles",
        "Starboy - The Weeknd",
        "Do I Wanna Know? - Arctic Monkeys",
        "The Less I Know The Better - Tame Impala",
        "Bohemian Rhapsody - Queen",
        "Shape of You - Ed Sheeran",
        "Levitating - Dua Lipa"
    ];

    // Randomize subset based on ID to simulate different playlists
    const seed = id.charCodeAt(0) % 5; 
    return mockTitles.slice(seed, seed + 5 + (id.charCodeAt(1) % 5));
};

export const importFromUrl = async (url: string): Promise<ImportResult> => {
    let match;
    let provider: 'spotify' | 'apple' | 'youtube' | null = null;
    let id = '';
    let type: 'playlist' | 'track' | 'album' = 'playlist';

    if ((match = url.match(PATTERNS.SPOTIFY))) {
        provider = 'spotify';
        const matchedType = match[1];
        if (matchedType === 'playlist' || matchedType === 'track' || matchedType === 'album') {
            type = matchedType;
        }
        id = match[2];
    } else if ((match = url.match(PATTERNS.APPLE))) {
        provider = 'apple';
        const matchedType = match[1];
        if (matchedType === 'playlist' || matchedType === 'album') {
            type = matchedType;
        }
        id = match[2];
    } else if ((match = url.match(PATTERNS.YOUTUBE))) {
        provider = 'youtube';
        // group 2 is watch?v= or playlist?list=
        // group 3 is ID
        type = match[2].includes('playlist') ? 'playlist' : 'track';
        id = match[3];
    }

    if (!provider || !id) {
        throw new Error("Invalid or unsupported URL format.");
    }

    // 1. Get the list of song titles (Mocked for this client-only demo)
    const rawTitles = await fetchExternalMetadata(provider, id);

    // 2. Convert titles to Playable Tracks concurrently via YouTube Search Service
    const searchPromises = rawTitles.map(async (title): Promise<Track | null> => {
        try {
            const results = await searchYouTube(title);
            if (results && results.length > 0) {
                // Return a clean copy instead of mutating cached objects directly
                return {
                    ...results[0],
                    album: `${provider === 'spotify' ? 'Spotify' : provider === 'apple' ? 'Apple Music' : 'YouTube'} Import`
                };
            }
        } catch (e) {
            console.warn(`Failed to resolve track: ${title}`, e);
        }
        return null;
    });

    const resolvedResults = await Promise.all(searchPromises);
    const tracks = resolvedResults.filter((t): t is Track => t !== null);

    let collectionName = 'Imported Collection';
    if (provider === 'spotify') collectionName = 'Spotify Collection';
    else if (provider === 'apple') collectionName = 'Apple Music Collection';
    else if (provider === 'youtube') collectionName = 'YouTube Collection';

    return {
        provider,
        type,
        id,
        name: collectionName,
        tracks
    };
};
    