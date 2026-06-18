
import React, { useState } from 'react';
import { Cloud, Server, Globe, Cast, HardDrive, Wifi, ShieldCheck, Play, Link, Music2, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { ScrollArea } from '../components/ScrollArea';
import { importFromUrl } from '../services/playlistImporter';
import { Track } from '../types';

interface ConnectPageProps {
    onPlayUrl?: (url: string) => void;
    onImportPlaylist?: (tracks: Track[], name: string) => void;
}

export const ConnectPage: React.FC<ConnectPageProps> = ({ onPlayUrl, onImportPlaylist }) => {
  const [streamUrl, setStreamUrl] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleStreamLoad = () => {
      if (!streamUrl || !onPlayUrl) return;
      
      let finalUrl = streamUrl.trim();
      // Google Drive Smart Parser
      if (finalUrl.includes('drive.google.com') && finalUrl.includes('/file/d/')) {
          const idMatch = finalUrl.match(/\/d\/(.*?)\//);
          if (idMatch && idMatch[1]) {
              const id = idMatch[1];
              // Validate ID format to prevent redirection template pollution
              if (/^[a-zA-Z0-9_-]+$/.test(id)) {
                  finalUrl = `https://drive.google.com/uc?export=download&id=${id}`;
              }
          }
      }

      // Enforce HTTP/HTTPS protocols (prevent javascript:, file:, etc.)
      if (!/^https?:\/\//i.test(finalUrl)) {
          console.error("Invalid URL protocol. Only HTTP/HTTPS links are supported.");
          return;
      }

      onPlayUrl(finalUrl);
  };

  const handlePlaylistImport = async () => {
      if (!importUrl || !onImportPlaylist) return;
      
      setIsImporting(true);
      setImportStatus('idle');

      try {
          const result = await importFromUrl(importUrl);
          onImportPlaylist(result.tracks, result.name);
          setImportStatus('success');
          setImportUrl('');
      } catch (error) {
          console.error(error);
          setImportStatus('error');
      } finally {
          setIsImporting(false);
          setTimeout(() => setImportStatus('idle'), 3000);
      }
  };

  const sources = [
    { name: 'Google Drive', icon: Cloud, color: 'text-blue-400', status: 'Connect' },
    { name: 'Dropbox', icon: HardDrive, color: 'text-indigo-400', status: 'Connect' },
    { name: 'OneDrive', icon: Cloud, color: 'text-sky-400', status: 'Connect' },
    { name: 'WebDAV Server', icon: Globe, color: 'text-emerald-400', status: 'Configure' },
    { name: 'DLNA / UPnP', icon: Cast, color: 'text-orange-400', status: 'Scan' },
    { name: 'SMB / Network', icon: Server, color: 'text-neutral-200', status: 'Mount' },
  ];

  return (
    <ScrollArea title="Connect" subtitle="Import & Stream Center">
      <div className="px-6 md:px-8 max-w-6xl mx-auto space-y-12 pb-32">
        
        {/* Universal Playlist Importer */}
        <section>
             <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
                    <Music2 size={16} />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Universal Playlist Bridge</h3>
            </div>
            
            <div className="glass-panel rounded-3xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/10 rounded-full blur-[100px] pointer-events-none" />
                
                <div className="flex flex-col md:flex-row gap-8 relative z-10">
                    <div className="flex-1">
                        <h4 className="text-xl font-bold text-white mb-2">Import from Spotify or Apple Music (Simulated Demo)</h4>
                        <p className="text-sm text-neutral-400 mb-6 max-w-md">
                            Paste a playlist link. (Simulated Demo Bridge: Parses the link format and resolves matched high-fidelity tracks via search).
                        </p>
                        
                        <div className="flex gap-2">
                             <div className="relative flex-1 group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-neutral-500 group-focus-within:text-green-500 transition-colors">
                                    <Link size={16} />
                                </div>
                                <input 
                                    type="text" 
                                    value={importUrl}
                                    onChange={(e) => setImportUrl(e.target.value)}
                                    placeholder="https://open.spotify.com/playlist/..." 
                                    aria-label="Universal Playlist URL"
                                    className="w-full bg-black/40 border border-white/10 rounded-xl py-4 pl-11 pr-4 text-white text-sm focus:border-green-500/50 outline-none transition-all placeholder:text-neutral-600 focus:ring-1 focus:ring-green-500/50"
                                    disabled={isImporting}
                                />
                             </div>
                             <button 
                                onClick={handlePlaylistImport}
                                disabled={isImporting || !importUrl}
                                className={`px-6 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${importStatus === 'success' ? 'bg-green-500 text-black' : 'bg-white text-black hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                            >
                                {isImporting ? <Loader2 size={18} className="animate-spin" /> : importStatus === 'success' ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                                {isImporting ? 'Processing...' : importStatus === 'success' ? 'Imported' : 'Import'}
                            </button>
                        </div>
                        
                        {importStatus === 'error' && (
                            <p className="text-red-400 text-xs mt-3 ml-1 animate-in fade-in">
                                Unable to process link. Please check the URL format.
                            </p>
                        )}
                    </div>
                    
                    {/* Visual Decor */}
                    <div className="hidden md:flex flex-col gap-3 justify-center opacity-50">
                        <div className="flex items-center gap-3 text-xs text-neutral-500">
                             <div className="w-6 h-6 rounded-full bg-[#1DB954] flex items-center justify-center text-black font-bold text-[10px]">S</div>
                             Spotify Support
                        </div>
                        <div className="flex items-center gap-3 text-xs text-neutral-500">
                             <div className="w-6 h-6 rounded-full bg-[#FA243C] flex items-center justify-center text-white font-bold text-[10px]">A</div>
                             Apple Music Support
                        </div>
                    </div>
                </div>
            </div>
        </section>

        {/* Direct Stream Input */}
        <section>
            <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">
                    <Wifi size={16} />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Network Stream</h3>
            </div>
            
            <div className="glass-panel rounded-3xl p-8 relative overflow-hidden group">
                 <div className="flex flex-col md:flex-row gap-4 relative z-10">
                    <input 
                        type="text" 
                        value={streamUrl}
                        onChange={(e) => setStreamUrl(e.target.value)}
                        placeholder="Direct Audio URL (FLAC/MP3/WAV)..." 
                        aria-label="Direct Audio Stream URL"
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-6 py-4 text-white text-sm focus:border-amber-500/50 outline-none transition-colors placeholder:text-neutral-600 focus:ring-1 focus:ring-amber-500/50"
                    />
                    <button 
                        onClick={handleStreamLoad}
                        className="bg-neutral-800 border border-white/10 text-white font-bold px-8 py-4 rounded-xl hover:bg-white hover:text-black transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                    >
                        <Play size={16} fill="currentColor" /> Load Stream
                    </button>
                </div>
            </div>
        </section>

        {/* Cloud Integrations */}
        <section>
            <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-500 mb-6 px-2">Storage Integrations</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {sources.map((source) => (
                    <div key={source.name} className="group glass-panel rounded-3xl p-6 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] cursor-pointer border border-white/5 hover:border-white/20">
                        <div className="flex items-start justify-between mb-8">
                            <div className={`p-4 rounded-2xl bg-white/5 ${source.color} group-hover:scale-110 transition-transform duration-300`}>
                                <source.icon size={28} />
                            </div>
                            <div className="text-[10px] font-mono text-neutral-500 border border-white/5 px-2 py-1 rounded-md flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                <ShieldCheck size={10} /> Secure
                            </div>
                        </div>
                        <div>
                            <h4 className="text-xl font-medium text-white mb-1">{source.name}</h4>
                            <p className="text-xs text-neutral-500 mb-6">Access your library remotely.</p>
                            <button 
                                disabled 
                                aria-disabled="true" 
                                className="w-full py-3 text-xs font-bold uppercase tracking-wider bg-white/5 border border-white/5 rounded-xl text-neutral-500 cursor-not-allowed"
                            >
                                {source.status} (Unavailable)
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </section>

      </div>
    </ScrollArea>
  );
};
