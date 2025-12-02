
import React, { useRef, useState } from 'react';

interface ScrollAreaProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  onScrollChange?: (e: React.UIEvent<HTMLDivElement>) => void;
}

export const ScrollArea: React.FC<ScrollAreaProps> = ({ title, subtitle, children, action, onScrollChange }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [scrollPos, setScrollPos] = useState(0);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    setScrollPos(top);
    setIsScrolled(top > 20);
    if(onScrollChange) onScrollChange(e);
  };

  const titleScale = Math.max(0.9, 1 - scrollPos / 400);
  const titleOpacity = Math.max(0, 1 - scrollPos / 100);

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      {/* Sticky Blurred Header */}
      <div 
        className={`absolute top-0 left-0 right-0 z-30 h-16 flex items-end pb-3 px-6 transition-all duration-300 border-b ${
            isScrolled 
            ? 'bg-black/80 backdrop-blur-xl border-white/10 translate-y-0' 
            : 'bg-transparent border-transparent -translate-y-2 pointer-events-none'
        }`}
      >
        <div className={`flex items-center justify-between w-full transition-opacity duration-300 ${isScrolled ? 'opacity-100' : 'opacity-0'}`}>
             <span className="font-bold text-base text-white tracking-tight">{title}</span>
             {action && <div className="scale-90">{action}</div>}
        </div>
      </div>

      {/* Scroll Container */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar scroll-smooth perspective-1000"
      >
        {/* Compact Header Area */}
        <div className="pt-16 px-6 md:px-8 pb-4 min-h-[100px] flex flex-col justify-end relative z-10">
            <div 
                className="origin-bottom-left transition-transform duration-75 ease-out"
                style={{ 
                    transform: `scale(${titleScale})`,
                    opacity: titleOpacity,
                    filter: `blur(${scrollPos / 20}px)`
                }}
            >
                <div className="flex items-end justify-between">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tighter mb-1 drop-shadow-lg">
                            {title}
                        </h1>
                        {subtitle && (
                            <p className="text-neutral-400 font-medium text-xs tracking-wide">{subtitle}</p>
                        )}
                    </div>
                    {action && (
                        <div className="mb-1 origin-right transition-opacity" style={{ opacity: titleOpacity }}>
                            {action}
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Main Content */}
        <div className="px-1 pb-24 relative z-20">
            <div className="bg-transparent rounded-t-2xl min-h-screen">
                {children}
            </div>
        </div>
      </div>
    </div>
  );
};
