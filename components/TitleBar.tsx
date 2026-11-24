import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ReactNode } from 'react';
import { Logo, Wordmark } from './Logo';

export function TitleBar({ children }: { children?: ReactNode }) {
  const native = Boolean(window.__TAURI_INTERNALS__);
  return (
    <header className="title-bar" data-tauri-drag-region>
      <div className="title-brand" data-tauri-drag-region>
        <Logo />
      </div>
      <Wordmark />
      <div className="title-actions">
        {children}
        {native && (
          <div className="window-buttons">
            <button onClick={() => void getCurrentWindow().minimize()} aria-label="Minimize" title="Minimize">
              <Minus size={15} />
            </button>
            <button onClick={() => void getCurrentWindow().toggleMaximize()} aria-label="Maximize" title="Maximize">
              <Square size={12} />
            </button>
            <button onClick={() => void getCurrentWindow().close()} aria-label="Close" title="Close">
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
