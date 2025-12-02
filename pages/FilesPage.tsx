
import React, { useState, useEffect, useMemo } from 'react';
import { Track, SortOption } from '../types';
import { FolderPlus, FileAudio, Play, LayoutGrid, List as ListIcon, Rows, MoreVertical, Trash2, ArrowUpDown, Shuffle, Sparkles, Plus } from 'lucide-react';
import { ScrollArea } from '../components/ScrollArea';

interface FilesPageProps {
  tracks: Track[];
  onPlay: (track: Track) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPlayNext: (trackId: string) => void;
  onAddToQueue: (trackId: string) => void;
  onRemove: (trackId: string) => void;
}

const OVERSCAN = 5; 

export const FilesPage: React.FC<FilesPageProps> = ({ tracks, onPlay, onUpload, onPlayNext, onAddToQueue, onRemove }) => {
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, trackId: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [sortBy, setSortBy] = useState<SortOption>('date');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('list');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  
  const ACCEPT_EXTENSIONS = ".mp3,.wav,.flac,.ogg,.aac,.m4a,.aiff,.aif,.dsf,.dff,.wma,.alac,.ape,.wv,.opus,.webm,.mp4,.3gp,.amr,.awb,.oga,.ra,.rm";

  useEffect(() => {
      if (tracks.length > 500) {
          setViewMode('compact');
      } else if (tracks.length < 50) {
          setViewMode('list'); 
      }
  }, [tracks.length]);

  const ITEM_HEIGHT = viewMode === 'compact' ? 56 : 80;

  useEffect(() => {
    const handleClickOutside = () => {
        setContextMenu(null);
        setActiveMenuId(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleMenuClick = (e: React.MouseEvent, trackId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      let x = rect.left;
      let y = rect.bottom + 5;
      if (x + 200 > window.innerWidth) x = window.innerWidth - 220;
      setContextMenu({ x, y, trackId });
      setActiveMenuId(trackId);
  };

  const sortedTracks = useMemo(() => {
      const t = [...tracks];
      if (sortBy === 'title') t.sort((a, b) => a.name.localeCompare(b.name));
      if (sortBy === 'artist') t.sort((a, b) => a.artist.localeCompare(b.artist));
      if (sortBy === 'date') t.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
      return t;
  }, [tracks, sortBy]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
      if (contextMenu) setContextMenu(null);
  };

  const { virtualItems, totalHeight } = useMemo(() => {
      if (viewMode === 'grid') return { virtualItems: [], totalHeight: 0 };
      const totalHeight = sortedTracks.length * ITEM_HEIGHT;
      const containerHeight = window.innerHeight; 
      let startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
      startIndex = Math.max(0, startIndex - OVERSCAN);
      let endIndex = Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT);
      endIndex = Math.min(sortedTracks.length, endIndex + OVERSCAN);
      const virtualItems = sortedTracks.slice(startIndex, endIndex).map((track, i) => ({
          track,
          index: startIndex + i,
          offsetTop: (startIndex + i) * ITEM_HEIGHT
      }));
      return { virtualItems, totalHeight };
  }, [sortedTracks, scrollTop, viewMode, ITEM_HEIGHT]);

  // Floating Glass Header Logic
  const Toolbar = (
    <div className="flex items-center gap-3 relative z-[60]">
        <div className="flex items-center bg-black/40 rounded-lg border border-white/10 p-0.5 backdrop-blur-md shadow-inner">
            <button onClick={() => setViewMode('list')} className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'}`}><ListIcon size={16} /></button>
            <button onClick={() => setViewMode('compact')} className={`p-2 rounded-md transition-all ${viewMode === 'compact' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'}`}><Rows size={16} /></button>
            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'}`}><LayoutGrid size={16} /></button>
        </div>
        
        <div className="relative group z-[70]"> 
            <button className="flex items-center gap-2 bg-black/40 hover:bg-white/10 border border-white/10 rounded-lg pl-3 pr-2 py-2 text-xs font-bold text-neutral-300 transition-all backdrop-blur-md">
                <span>{sortBy === 'date' ? 'Recent' : sortBy === 'title' ? 'A-Z' : 'Artist'}</span>
                <ArrowUpDown size={14} />
            </button>
            <div className="absolute right-0 top-[calc(100%+4px)] w-36 bg-neutral-900 border border-white/10 rounded-xl overflow-hidden hidden group-hover:block shadow-2xl animate-in fade-in zoom-in-95 duration-100 p-1">
                <button onClick={() => setSortBy('date')} className="w-full text-left px-3 py-2 text-xs font-medium text-neutral-400 hover:bg-white/10 hover:text-white rounded-lg transition-colors">Date Added</button>
                <button onClick={() => setSortBy('title')} className="w-full text-left px-3 py-2 text-xs font-medium text-neutral-400 hover:bg-white/10 hover:text-white rounded-lg transition-colors">Title A-Z</button>
                <button onClick={() => setSortBy('artist')} className="w-full text-left px-3 py-2 text-xs font-medium text-neutral-400 hover:bg-white/10 hover:text-white rounded-lg transition-colors">Artist A-Z</button>
            </div>
        </div>

        <label className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 font-bold py-2 px-4 rounded-lg cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-lg">
            <FolderPlus size={16} />
            <span className="text-xs">Add</span>
            <input type="file" multiple accept={ACCEPT_EXTENSIONS} className="hidden" onChange={onUpload} />
        </label>
    </div>
  );

  return (
    <ScrollArea title="Library" subtitle={`${tracks.length} tracks found`} action={Toolbar} onScrollChange={handleScroll}>
      <div className="px-6 md:px-8 pb-32">
        
        {/* Quick Actions / Hero */}
        {tracks.length > 0 && (
            <div className="mb-8 flex gap-4">
                <button onClick={() => onPlay(tracks[Math.floor(Math.random() * tracks.length)])} className="flex-1 bg-gradient-to-r from-primary-500/20 to-primary-900/20 border border-primary-500/30 rounded-2xl p-4 flex items-center gap-4 hover:border-primary-500/50 transition-all group">
                    <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-black shadow-lg shadow-primary-500/50 group-hover:scale-110 transition-transform">
                        <Shuffle size={20} />
                    </div>
                    <div className="text-left">
                        <div className="text-sm font-bold text-white">Shuffle Play</div>
                        <div className="text-[10px] text-primary-200">Rediscover your collection</div>
                    </div>
                </button>
                <div className="flex-1 border border-white/5 bg-white/5 rounded-2xl p-4 flex items-center gap-4 hover:bg-white/10 transition-all cursor-pointer">
                    <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center text-white">
                        <Sparkles size={18} />
                    </div>
                    <div className="text-left">
                        <div className="text-sm font-bold text-white">Smart Analyze</div>
                        <div className="text-[10px] text-neutral-400">Scan for metadata issues</div>
                    </div>
                </div>
            </div>
        )}

        <div className="rounded-3xl relative min-h-[400px]">
            {tracks.length === 0 ? (
                 <div className="py-24 text-center text-neutral-600 flex flex-col items-center gap-6 border-2 border-dashed border-white/5 rounded-3xl bg-white/[0.01]">
                    <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center">
                        <FolderPlus size={32} strokeWidth={1} className="opacity-50" />
                    </div>
                    <div>
                        <p className="font-medium text-white mb-2">Your collection is empty.</p>
                        <p className="text-xs text-neutral-500">Drag & drop files or click import to get started.</p>
                    </div>
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                    {sortedTracks.map(track => (
                        <div key={track.id} onClick={() => onPlay(track)} className="group cursor-pointer p-4 rounded-3xl hover:bg-white/5 transition-all duration-300 border border-transparent hover:border-white/5">
                            <div className="aspect-square bg-neutral-900 rounded-2xl border border-white/5 mb-4 overflow-hidden relative shadow-2xl transition-all duration-300 group-hover:scale-105 group-hover:shadow-primary-500/20">
                                {track.image ? <img src={track.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-neutral-700"><FileAudio size={32} /></div>}
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-black pl-1 shadow-xl transform scale-50 group-hover:scale-100 transition-transform">
                                        <Play size={20} fill="black" />
                                    </div>
                                </div>
                                <button onClick={(e) => handleMenuClick(e, track.id)} className="absolute top-2 right-2 p-2 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 hover:bg-black transition-all transform translate-y-2 group-hover:translate-y-0"><MoreVertical size={14} /></button>
                            </div>
                            <h4 className="font-bold text-white text-sm truncate pr-2 mb-1">{track.name}</h4>
                            <p className="text-neutral-500 text-xs truncate">{track.artist}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
                    <div className="grid grid-cols-12 text-[10px] font-bold text-neutral-500 uppercase tracking-widest border-b border-white/10 bg-black/80 backdrop-blur-xl sticky top-0 z-20 h-[40px] items-center">
                        <div className="col-span-6 pl-4">Track</div>
                        <div className="col-span-3">Artist</div>
                        <div className="col-span-2 hidden md:block">Info</div>
                        <div className="col-span-1 text-center"></div>
                    </div>
                    {virtualItems.map(({ track, offsetTop }) => (
                        <div key={track.id} className={`absolute left-0 w-full group transition-all grid grid-cols-12 items-center px-2 hover:bg-white/5 rounded-xl border border-transparent hover:border-white/5 ${activeMenuId === track.id ? 'bg-white/10' : ''}`} style={{ transform: `translateY(${offsetTop}px)`, height: `${ITEM_HEIGHT}px`, top: '40px' }}>
                            <div className="col-span-6 pl-2 cursor-pointer flex items-center gap-4 overflow-hidden" onClick={() => onPlay(track)}>
                                <div className={`w-10 h-10 rounded-lg bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-500 group-hover:text-white transition-all shadow-md overflow-hidden shrink-0 group-hover:scale-105 relative`}>
                                    {track.image ? <img src={track.image} className="w-full h-full object-cover" /> : <FileAudio size={16} />}
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Play size={12} fill="white" className="text-white" /></div>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className={`font-bold text-neutral-200 group-hover:text-white transition-colors truncate pr-4 text-sm`}>{track.name}</div>
                                </div>
                            </div>
                            <div className="col-span-3 text-neutral-400 font-medium cursor-pointer truncate pr-4 group-hover:text-neutral-300 text-xs" onClick={() => onPlay(track)}>{track.artist}</div>
                            <div className="col-span-2 hidden md:block cursor-pointer" onClick={() => onPlay(track)}>
                                <span className="bg-white/5 px-2 py-0.5 rounded text-[9px] font-mono font-bold text-neutral-500 border border-white/5">{track.format}</span>
                            </div>
                            <div className="col-span-1 flex justify-center">
                                <button onClick={(e) => handleMenuClick(e, track.id)} className={`p-2 rounded-lg text-neutral-500 hover:text-white hover:bg-white/10 transition-all ${activeMenuId === track.id ? 'opacity-100 text-white' : 'opacity-0 group-hover:opacity-100'}`}><MoreVertical size={16} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* Global Context Menu */}
        {contextMenu && (
             <div style={{ top: contextMenu.y, left: contextMenu.x }} className="fixed w-48 bg-neutral-900/90 backdrop-blur-2xl border border-white/10 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] z-[100] overflow-hidden p-1 animate-in fade-in zoom-in-95 duration-100" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { const t = tracks.find(tr => tr.id === contextMenu.trackId); if(t) onPlay(t); setContextMenu(null); }} className="flex items-center gap-3 w-full px-3 py-2 text-xs font-bold text-left text-neutral-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors">Play Now</button>
                <button onClick={() => { onPlayNext(contextMenu.trackId); setContextMenu(null); }} className="flex items-center gap-3 w-full px-3 py-2 text-xs font-bold text-left text-neutral-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors">Play Next</button>
                <button onClick={() => { onAddToQueue(contextMenu.trackId); setContextMenu(null); }} className="flex items-center gap-3 w-full px-3 py-2 text-xs font-bold text-left text-neutral-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors">Add to Queue</button>
                <div className="h-px bg-white/5 my-1" />
                <button onClick={() => { onRemove(contextMenu.trackId); setContextMenu(null); }} className="flex items-center gap-3 w-full px-3 py-2 text-xs font-bold text-left text-red-400 hover:text-red-200 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={12}/> Remove</button>
            </div>
        )}
      </div>
    </ScrollArea>
  );
};
