import React, { useEffect } from 'react';
import { CheckCircle } from 'lucide-react';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, isVisible, onClose }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="bg-neutral-800/90 backdrop-blur-md border border-white/10 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
        <CheckCircle size={16} className="text-primary-500" />
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
};