import React, { useEffect, useState } from 'react';
import { CheckCircle } from 'lucide-react';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, isVisible, onClose }) => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const animationClasses = prefersReducedMotion 
    ? "" 
    : "animate-in slide-in-from-bottom-5 fade-in duration-300";

  return (
    <div 
      role="alert" 
      aria-live="polite" 
      className={`fixed bottom-28 left-1/2 -translate-x-1/2 z-[100] ${animationClasses}`}
    >
      <div className="bg-neutral-800/90 backdrop-blur-md border border-white/10 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
        <CheckCircle size={16} className="text-primary-500" />
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
};