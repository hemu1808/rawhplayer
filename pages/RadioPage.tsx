import React, { useState } from 'react';
import { getStations, RadioStation } from '../services/radioService';
import { Play, Radio } from 'lucide-react';
import { Track } from '../types';

interface RadioPageProps {
  onPlayUrl: (track: Track) => void;
}

export const RadioPage: React.FC<RadioPageProps> = ({ onPlayUrl }) => {
  const [stations] = useState<RadioStation[]>(getStations());
  const [filter, setFilter] = useState<string>('All');

  const genres = ['All', ...Array.from(new Set(stations.map((s) => s.genre))).sort()];

  const filteredStations = filter === 'All' ? stations : stations.filter((s) => s.genre === filter);

  const handlePlay = (station: RadioStation) => {
    const track: Track = {
      id: station.id,
      name: station.name,
      artist: station.genre + ' Radio',
      path: station.url,
      source: 'youtube', // Use youtube or a custom stream source type to bypass local file checks
      format: 'STREAM',
      duration: 0,
      image: station.logo,
    };
    onPlayUrl(track);
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black mb-2 flex items-center gap-3">
              <Radio className="text-primary-500" size={36} /> Internet Radio
            </h1>
            <p className="text-white/50 text-lg">Curated high-quality audio streams</p>
          </div>
        </header>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {genres.map((g) => (
            <button
              key={g}
              onClick={() => setFilter(g)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-colors whitespace-nowrap ${
                filter === g ? 'bg-primary-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredStations.map((station) => (
            <div
              key={station.id}
              className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/10 transition-all group flex flex-col h-full"
            >
              <div className="flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-primary-500/20 to-primary-900/20 rounded-xl flex items-center justify-center text-primary-500">
                    <Radio size={28} />
                  </div>
                  <span className="text-xs font-bold text-white/40 bg-white/5 px-3 py-1 rounded-full uppercase tracking-wider">
                    {station.genre}
                  </span>
                </div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-primary-400 transition-colors">{station.name}</h3>
                <p className="text-sm text-white/50 line-clamp-3 mb-6">{station.description}</p>
              </div>
              <button
                onClick={() => handlePlay(station)}
                className="w-full py-3 bg-white/5 hover:bg-primary-500 hover:text-black rounded-xl font-bold transition-all flex items-center justify-center gap-2 group/btn"
              >
                <Play size={18} className="text-primary-500 group-hover/btn:text-black transition-colors" /> Tune In
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
