import React, { useEffect, useRef, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

interface VisualizerProps {
  isPlaying: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fftDataRef = useRef<number[]>(new Array(512).fill(0));
  const animationFrameRef = useRef<number>(0);

  // Optimization: Cache colors only once or when necessary, not every frame
  const colors = useMemo(() => {
    // We check for window to ensure SSR safety if needed, though this is client-only
    if (typeof window === 'undefined') return { primary500: '#f59e0b', primary900: '#78350f' };
    
    const styles = getComputedStyle(document.documentElement);
    return {
        primary500: styles.getPropertyValue('--primary-500').trim() || '#f59e0b',
        primary900: styles.getPropertyValue('--primary-900').trim() || '#78350f'
    };
  }, [isPlaying]);

  useEffect(() => {
    const unlisten = listen<{ fft: number[] }>('fft_data', (event) => {
      fftDataRef.current = event.payload.fft;
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  useEffect(() => {
    const draw = () => {
      if (!canvasRef.current) return;

      const dataArray = fftDataRef.current;
      const bufferLength = dataArray.length;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      // Clear
      ctx.clearRect(0, 0, width, height);

      // Draw Logic - Symmetrical RTA Style
      const barWidth = (width / bufferLength) * 8; // Zoom in on lows/mids
      let x = 0;

      // Re-use the cached colors
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, colors.primary900);
      gradient.addColorStop(0.5, colors.primary500);
      gradient.addColorStop(1, '#ffffff');

      ctx.fillStyle = gradient;

      // Only render first 33% of bins (Human hearing range mostly)
      const renderCount = Math.floor(bufferLength * 0.33); 

      for (let i = 0; i < renderCount; i++) {
        // Rust rustfft magnitudes can be large, normalize roughly
        const v = Math.min(dataArray[i] / 500, 1.0); 
        const barHeight = v * height;
        ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    if (isPlaying) {
        draw();
    } else {
        if(canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if(ctx) ctx.clearRect(0,0, canvasRef.current.width, canvasRef.current.height);
        }
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
    
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, colors]);

  // Handle High-DPI Scaling
  useEffect(() => {
      const canvas = canvasRef.current;
      if(!canvas) return;
      
      const resize = () => {
          const parent = canvas.parentElement;
          if(parent) {
              const dpr = window.devicePixelRatio || 1;
              const rect = parent.getBoundingClientRect();
              
              canvas.width = rect.width * dpr;
              canvas.height = rect.height * dpr;
              canvas.style.width = `${rect.width}px`;
              canvas.style.height = `${rect.height}px`;
              
              const ctx = canvas.getContext('2d');
              if(ctx) ctx.scale(dpr, dpr);
          }
      }
      window.addEventListener('resize', resize);
      resize();
      
      return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <div className="w-full h-full relative">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};