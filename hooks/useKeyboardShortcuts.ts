import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AudioState } from '../types';

export function useKeyboardShortcuts(
  audioState: AudioState,
  onPlayPause: () => void
) {
  const audioStateRef = useRef(audioState);
  
  useEffect(() => {
    audioStateRef.current = audioState;
  }, [audioState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts when inside form elements
      if (document.activeElement?.tagName === 'INPUT' || 
          document.activeElement?.tagName === 'SELECT' || 
          document.activeElement?.tagName === 'TEXTAREA') {
          return;
      }
      
      const currentState = audioStateRef.current;

      if (e.code === 'Space') {
          e.preventDefault();
          onPlayPause();
      } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          invoke('seek_audio', { position: Math.min(currentState.duration, currentState.currentTime + 5.0) }).catch(console.error);
      } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          invoke('seek_audio', { position: Math.max(0.0, currentState.currentTime - 5.0) }).catch(console.error);
      } else if (e.code === 'KeyM') {
          // Additional shortcuts if needed
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPlayPause]);
}
