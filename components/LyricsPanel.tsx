import React, { useState, useEffect } from 'react';
import { Track } from '../types';
import { X, Music } from 'lucide-react';

interface LyricsPanelProps {
  track: Track | null;
  isOpen: boolean;
  onClose: () => void;
}

export const LyricsPanel: React.FC<LyricsPanelProps> = ({ track, isOpen, onClose }) => {
  const [lyrics, setLyrics] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !track) return;
    
    let isMounted = true;
    const fetchLyrics = async () => {
      setLoading(true);
      setError(false);
      setLyrics('');
      try {
        const response = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.name)}`);
        if (!response.ok) throw new Error('Not found');
        const data = await response.json();
        if (isMounted) {
          setLyrics(data.lyrics || 'Lyrics not found');
        }
      } catch (err) {
        if (isMounted) {
          setError(true);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    fetchLyrics();
    
    return () => {
      isMounted = false;
    };
  }, [track, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-80 bg-black/40 backdrop-blur-2xl border-l border-white/10 p-6 flex flex-col z-40 transition-transform shadow-2xl">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2"><Music size={20} /> Lyrics</h2>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
      </div>
      
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
        {loading && <div className="animate-pulse text-white/50 text-center mt-10">Loading lyrics...</div>}
        {error && !loading && <div className="text-white/50 text-center mt-10">Lyrics not found</div>}
        {!loading && !error && lyrics && (
          <div className="whitespace-pre-wrap text-white/80 font-medium leading-relaxed">{lyrics}</div>
        )}
      </div>
    </div>
  );
};
