
import React from 'react';
import { FolderOpen, Disc, Settings, Link2, Search, ActivitySquare } from 'lucide-react';
import { Logo } from './Logo';

type Page = 'files' | 'player' | 'settings' | 'connect' | 'search' | 'audiophile';

interface NavigationProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ activePage, onNavigate }) => {
  const navItems: { id: Page; icon: React.ElementType; label: string }[] = [
    { id: 'player', icon: Disc, label: 'Now Playing' },
    { id: 'files', icon: FolderOpen, label: 'Library' },
    { id: 'search', icon: Search, label: 'Search' },
    { id: 'audiophile', icon: ActivitySquare, label: 'Audiophile' },
    { id: 'connect', icon: Link2, label: 'Connect' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="w-20 h-full bg-transparent flex flex-col items-center py-6 z-50 relative shrink-0 border-r border-white/0">
      <div className="mb-8 mt-2">
        <button 
            onClick={() => onNavigate('player')}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-[0_0_20px_rgba(var(--primary-500),0.1)] group hover:bg-white/10 transition-all duration-300 ${activePage === 'player' ? 'bg-primary-500 border-primary-400 text-black' : 'bg-white/5 border-white/5 backdrop-blur-md'}`}
            title="Now Playing"
        >
          <Logo className={`w-6 h-6 group-hover:scale-110 transition-transform duration-500 ${activePage === 'player' ? 'text-black' : 'text-primary-500'}`} />
        </button>
      </div>

      <div className="flex flex-col gap-4 w-full px-3">
        {navItems.map((item) => {
            const isActive = activePage === item.id;
            return (
                <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`group relative w-full flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-xl transition-all duration-500 ${
                        isActive 
                        ? 'bg-white/10 backdrop-blur-md shadow-lg translate-y-0' 
                        : 'bg-transparent hover:bg-white/5'
                    }`}
                >
                    <item.icon
                        size={20}
                        strokeWidth={isActive ? 2 : 1.5}
                        className={`transition-all duration-500 ${
                            isActive 
                            ? 'text-primary-400 scale-105 drop-shadow-[0_0_8px_rgba(var(--primary-500),0.5)]' 
                            : 'text-neutral-500 group-hover:text-white'
                        }`}
                    />
                    
                    {/* Tooltip */}
                    <span className="absolute left-full ml-4 px-3 py-1.5 bg-neutral-900 border border-white/10 rounded-lg text-[10px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none shadow-xl">
                        {item.label}
                    </span>
                    
                    {/* Active Glow Dot */}
                    {isActive && (
                        <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary-500 rounded-r-full blur-[2px] opacity-80" />
                    )}
                </button>
            );
        })}
      </div>
    </div>
  );
};
