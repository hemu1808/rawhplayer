import { useEffect } from 'react';
import { THEMES } from '../types';
import { usePersistence } from './usePersistence';

export function useTheme() {
  const [currentThemeId, setCurrentThemeId] = usePersistence<string>('rawh_theme_id', 'reference');

  useEffect(() => {
    const theme = THEMES.find(t => t.id === currentThemeId) || THEMES.find(t => t.id === 'reference');
    if (theme) {
      document.documentElement.style.setProperty('--primary-300', theme.colors[300]);
      document.documentElement.style.setProperty('--primary-400', theme.colors[400]);
      document.documentElement.style.setProperty('--primary-500', theme.colors[500]);
      document.documentElement.style.setProperty('--primary-600', theme.colors[600]);
      document.documentElement.style.setProperty('--primary-900', theme.colors[900]);
    }
  }, [currentThemeId]);

  return { currentThemeId, setCurrentThemeId };
}
