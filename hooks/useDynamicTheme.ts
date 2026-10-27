import { useEffect } from 'react';
import { Track, ThemeColor, THEMES } from '../types';

const extractDominantColor = (imageUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject('No canvas context');
        return;
      }
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, img.width, img.height);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      r = Math.floor(r / count);
      g = Math.floor(g / count);
      b = Math.floor(b / count);
      resolve(`rgb(${r}, ${g}, ${b})`);
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
};

export const useDynamicTheme = (currentTrack: Track | null, isDynamicThemeEnabled: boolean) => {
  useEffect(() => {
    if (!isDynamicThemeEnabled) {
      return;
    }
    if (currentTrack && currentTrack.image) {
      extractDominantColor(currentTrack.image).then((color) => {
        // We'll set a few variables. In a real app we'd map luminance for 300, 400, 500, 600, 900.
        // For simplicity, we set the primary color.
        document.documentElement.style.setProperty('--primary-500', color);
      }).catch((e) => console.error('Failed to extract color', e));
    }
  }, [currentTrack, isDynamicThemeEnabled]);
};
