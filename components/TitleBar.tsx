import React, { useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Logo } from './Logo';

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  return (
    <div 
      data-tauri-drag-region
      className="absolute top-0 left-0 right-0 h-10 bg-transparent flex items-center justify-between px-4 select-none z-[100]"
    >
      {/* Spacers */}
      <div className="w-20 pointer-events-none"></div>

      {/* Centering Branding */}
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
                <button onClick={handleMinimize} className="text-neutral-400 hover:text-white transition p-1.5 rounded-md hover:bg-white/10" aria-label="Minimize"><Minus size={12} /></button>
                <button onClick={handleMaximize} className="text-neutral-400 hover:text-white transition p-1.5 rounded-md hover:bg-white/10" aria-label="Maximize"><Square size={10} /></button>
                <button onClick={handleClose} className="text-neutral-400 hover:text-white hover:bg-red-500 transition p-1.5 rounded-md" aria-label="Close"><X size={12} /></button>
            </>
        )}
      </div>
    </div>
  );
};