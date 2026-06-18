
import React, { useEffect, useState } from 'react';
import { FolderOpen, Disc, Settings, Link2, Search, ActivitySquare } from 'lucide-react';
import { Logo } from './Logo';

type Page = 'files' | 'player' | 'settings' | 'connect' | 'search' | 'audiophile';

interface NavigationProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ activePage, onNavigate }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const navItems: { id: Page; icon: React.ElementType; label: string }[] = [
    { id: 'player', icon: Disc, label: 'Player' },
    { id: 'files', icon: FolderOpen, label: 'Library' },
    { id: 'search', icon: Search, label: 'Search' },
    { id: 'audiophile', icon: ActivitySquare, label: 'Audio' },
    { id: 'connect', icon: Link2, label: 'Net' },
    { id: 'settings', icon: Settings, label: 'Setup' },
  ];

  if (isMobile) {
      // MOBILE LAYOUT: Bottom Tab Bar (iOS Style)
      return (
        <nav aria-label="Mobile navigation bar" className="fixed bottom-0 left-0 right-0 h-20 bg-neutral-950/90 backdrop-blur-xl border-t border-white/10 z-[90] flex items-center justify-around px-2 pb-safe">
            {navItems.map((item) => {
                const isActive = activePage === item.id;
                return (
                    <button
                        key={item.id}
                        onClick={() => onNavigate(item.id)}
                        className={`flex flex-col items-center justify-center gap-1 w-full h-full ${isActive ? 'text-primary-500' : 'text-neutral-500'}`}
                        aria-label={`Go to ${item.label} page`}
                        aria-current={isActive ? 'page' : undefined}
                    >
                        <item.icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
                        <span className="text-[9px] font-medium">{item.label}</span>
                    </button>
                )
            })}
        </nav>
      );
  }

  // DESKTOP LAYOUT: Sidebar (Mac/Windows Style)
  return (
    <nav aria-label="Desktop sidebar navigation" className="w-20 h-full bg-transparent flex flex-col items-center py-6 z-50 relative shrink-0 border-r border-white/0">
      <div className="mb-8 mt-2">
        <button 
            onClick={() => onNavigate('player')}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-[0_0_20px_rgba(var(--primary-500),0.1)] group hover:bg-white/10 transition-all duration-300 ${activePage === 'player' ? 'bg-primary-500 border-primary-400 text-black' : 'bg-white/5 border-white/5 backdrop-blur-md'}`}
            title="Now Playing"
            aria-label="Go to Player page"
            aria-current={activePage === 'player' ? 'page' : undefined}
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
                    aria-label={`Go to ${item.label} page`}
                    aria-current={isActive ? 'page' : undefined}
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
    </nav>
  );
};
