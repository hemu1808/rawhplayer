import { useEffect } from 'react';
import type { Track } from '../types';

const paletteCache = new Map<string, [number, number, number]>();
export const useDynamicTheme = (track: Track | null, enabled: boolean) => {
  const image = track?.image;
  useEffect(() => {
    if (!enabled || !image) return;
    let active = true;
    const apply = ([r, g, b]: [number, number, number]) => {
      if (!active) return;
      const tones = { 300: 0.65, 400: 0.5, 500: 0.35, 600: 0, 900: -0.7 };
      Object.entries(tones).forEach(([shade, mix]) => {
        const channel = (value: number) => Math.round(mix >= 0 ? value + (255 - value) * mix : value * (1 + mix));
        document.documentElement.style.setProperty(
          '--primary-' + shade,
          'rgb(' + [r, g, b].map(channel).join(',') + ')',
        );
      });
      window.dispatchEvent(new Event('rawh-theme-changed'));
    };
    const cached = paletteCache.get(image);
    if (cached) {
      apply(cached);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!active) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(img, 0, 0, 24, 24);
        const pixels = context.getImageData(0, 0, 24, 24).data;
        const sums = [0, 0, 0];
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] < 128) continue;
          sums[0] += pixels[i];
          sums[1] += pixels[i + 1];
          sums[2] += pixels[i + 2];
          count++;
        }
        if (!count) return;
        const palette = sums.map((value) => Math.round(value / count)) as [number, number, number];
        if (paletteCache.size >= 128) paletteCache.delete(paletteCache.keys().next().value!);
        paletteCache.set(image, palette);
        apply(palette);
      } catch {
        /* Keep the selected theme when artwork cannot be sampled. */
      }
    };
    img.src = image;
    return () => {
      active = false;
      img.onload = null;
    };
  }, [image, enabled]);
};
