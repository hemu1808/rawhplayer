
import React, { useState, useMemo } from 'react';
import { Track } from '../types';
import { Search, Play, FileAudio, Youtube, Library } from 'lucide-react';
import { ScrollArea } from '../components/ScrollArea';
import { searchYouTube } from '../services/youtubeService';

interface SearchPageProps {
  tracks: Track[];
  onPlay: (track: Track) => void;
}

export const SearchPage: React.FC<SearchPageProps> = ({ tracks, onPlay }) => {
  const [query, setQuery] = useState('');
  const [sourceMode, setSourceMode] = useState<'local' | 'youtube'>('local');
  const [ytResults, setYtResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const localResults = useMemo(() => {
    if (!query) return [];
    const lowerQ = query.toLowerCase();
    return tracks.filter(t => 
        t.name.toLowerCase().includes(lowerQ) || 
        t.artist.toLowerCase().includes(lowerQ) ||
        t.format?.toLowerCase().includes(lowerQ)
    );
  }, [query, tracks]);

  const handleSearch = async (e: React.FormEvent) => {
      e.preventDefault();
      if (sourceMode === 'youtube' && query) {
          setIsSearching(true);
          try {
              const results = await searchYouTube(query);
              setYtResults(results);
          } catch (error) {
              console.error("YouTube search error:", error);
          } finally {
              setIsSearching(false);
          }
      }
  };

  const activeResults = sourceMode === 'local' ? localResults : ytResults;

  return (
    <ScrollArea title="Search" subtitle={sourceMode === 'local' ? "Library Search" : "YouTube Music API"}>
        <div className="px-6 md:px-8 max-w-4xl mx-auto">
            
            {/* Search Source Toggles */}
            <div className="flex items-center gap-4 mb-6">
                <button 
                    onClick={() => setSourceMode('local')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${sourceMode === 'local' ? 'bg-white text-black' : 'bg-white/5 text-neutral-400 hover:text-white'}`}
                >
                    <Library size={14} /> Library
                </button>
                <button 
                    onClick={() => setSourceMode('youtube')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${sourceMode === 'youtube' ? 'bg-red-600 text-white shadow-lg shadow-red-900/50' : 'bg-white/5 text-neutral-400 hover:text-white'}`}
                >
                    <Youtube size={14} /> YouTube
                </button>
            </div>

            <form onSubmit={handleSearch} className="relative mb-12 group">
                <div className={`absolute inset-0 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 ${sourceMode === 'youtube' ? 'bg-red-600/20' : 'bg-white/5'}`} />
                <input 
                    type="text" 
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={sourceMode === 'youtube' ? "Search YouTube..." : "Search artists, tracks, formats..."} 
                    aria-label={sourceMode === 'youtube' ? "Search YouTube" : "Search library"}
                    className="relative z-10 w-full bg-black/40 backdrop-blur-xl border border-white/10 focus:border-primary-500/50 rounded-2xl py-5 pl-14 pr-4 text-xl text-white placeholder:text-neutral-600 outline-none transition-all font-light shadow-2xl"
                />
                <Search className="absolute z-20 left-5 top-1/2 -translate-y-1/2 text-neutral-600 group-focus-within:text-primary-500 transition-colors" size={24} />
            </form>

            <div className="space-y-3">
                {isSearching && (
                    <div className="text-center py-20">
                        <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-neutral-500">Searching YouTube...</p>
                    </div>
                )}

                {!isSearching && query && activeResults.length === 0 && (
                    <div className="text-center text-neutral-600 mt-20 animate-in fade-in slide-in-from-bottom-4">
                        <p className="text-lg">No results for "{query}"</p>
                    </div>
                )}

                {!isSearching && activeResults.map((track) => (
                     <div 
                        key={track.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Play search result: ${track.name} by ${track.artist}`}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onPlay(track);
                            }
                        }}
                        onClick={() => onPlay(track)}
                        className="group flex items-center gap-5 p-4 rounded-2xl hover:bg-white/5 cursor-pointer transition-all border border-transparent hover:border-white/5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    >
                        <div className="w-14 h-14 bg-neutral-900 rounded-xl flex items-center justify-center text-neutral-600 group-hover:text-white transition-colors border border-white/5 shadow-lg overflow-hidden relative">
                            {track.image ? (
                                <img src={track.image} alt={`${track.name} album art`} className="w-full h-full object-cover" />
                            ) : (
                                <FileAudio size={24} strokeWidth={1.5} />
                            )}
                            {track.source === 'youtube' && (
                                <div className="absolute bottom-0 right-0 p-1 bg-red-600 text-white rounded-tl-lg">
                                    <Youtube size={10} fill="white" />
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                                <h4 className="text-white font-medium truncate text-lg">{track.name}</h4>
                                {track.format && <span className="text-[9px] px-2 py-0.5 bg-white/10 rounded text-neutral-400 uppercase font-bold tracking-wider">{track.format}</span>}
                            </div>
                            <p className="text-neutral-500 text-sm truncate">{track.artist}</p>
                        </div>
                        <button 
                            className={`w-10 h-10 rounded-full text-black flex items-center justify-center transition-all transform scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-100 shadow-[0_0_15px_rgba(var(--primary-500),0.5)] ${track.source === 'youtube' ? 'bg-red-500' : 'bg-primary-500'} focus:opacity-100 focus:scale-100`}
                            aria-label={`Play ${track.name}`}
                        >
                            <Play size={16} fill="currentColor" className="ml-0.5" />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    </ScrollArea>
  );
};
