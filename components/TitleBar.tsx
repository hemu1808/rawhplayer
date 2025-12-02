import React, { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { appWindow } from '@tauri-apps/api/window';
import { Logo } from './Logo';

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    // Check if running in Tauri
    if ((window as any).__TAURI__) {
      setIsTauri(true);
    }
  }, []);

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  const handleClose = () => {
    appWindow.close();
  };

  return (
    <div 
      data-tauri-drag-region
      className="absolute top-0 left-0 right-0 h-10 bg-transparent flex items-center justify-between px-4 select-none z-[100]"
    >
      {/* Spacers */}
      <div className="w-20 pointer-events-none"></div>

      {/* Centered Branding */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none opacity-80">
        <Logo className="w-4 h-4 text-white" />
        <span className="text-[10px] text-white tracking-[0.3em] uppercase font-bold drop-shadow-[0_0_10px_rgba(0,0,0,0.5)]">
          Rawh Player
        </span>
      </div>

      {/* Window Controls */}
      <div className="flex items-center gap-3 w-20 justify-end z-[101]">
        {isTauri && (
            <>
                <button onClick={handleMinimize} className="text-neutral-400 hover:text-white transition p-1.5 rounded-md hover:bg-white/10"><Minus size={12} /></button>
                <button onClick={handleMaximize} className="text-neutral-400 hover:text-white transition p-1.5 rounded-md hover:bg-white/10"><Square size={10} /></button>
                <button onClick={handleClose} className="text-neutral-400 hover:text-white hover:bg-red-500 transition p-1.5 rounded-md"><X size={12} /></button>
            </>
        )}
      </div>
    </div>
  );
};