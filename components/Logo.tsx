import React, { useId } from 'react';

interface LogoProps {
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ className }) => {
  const idNamespace = useId();
  const gradId = `logoGrad-${idNamespace}`;

  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} role="img" aria-label="Rawh Player Logo">
      <title>Rawh Player Logo</title>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="100" y2="100">
          <stop offset="0%" stopColor="currentColor" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      
      {/* Left Pillar */}
      <path 
        d="M25 15 V85" 
        stroke={`url(#${gradId})`} 
        strokeWidth="12" 
        strokeLinecap="round" 
      />
      
      {/* Right Pillar */}
      <path 
        d="M75 15 V85" 
        stroke={`url(#${gradId})`} 
        strokeWidth="12" 
        strokeLinecap="round" 
      />
      
      {/* The "Music/Wave" Bridge */}
      <path 
        d="M25 50 L35 50 L45 35 L55 65 L65 50 L75 50" 
        stroke={`url(#${gradId})`} 
        strokeWidth="8" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      
      {/* Accent Dots */}
      <circle cx="25" cy="15" r="3" fill="white" fillOpacity="0.6" />
      <circle cx="75" cy="85" r="3" fill="white" fillOpacity="0.6" />
    </svg>
  );
};