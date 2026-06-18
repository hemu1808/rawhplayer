
import React, { useRef, useEffect } from 'react';

interface VideoPlayerProps {
  src: string;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  onTimeUpdate: (time: number, duration: number) => void;
  onEnded: () => void;
  playbackRate: number;
  seekTime?: number | null; // Trigger seek
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
    src, 
    isPlaying, 
    volume, 
    isMuted, 
    onTimeUpdate, 
    onEnded,
    playbackRate,
    seekTime 
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    // Sync Playback State
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (isPlaying) {
            video.play().catch(e => console.warn("Video play interrupted", e));
        } else {
            video.pause();
        }
    }, [isPlaying, src]);

    // Sync Volume/Mute
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = Math.max(0, Math.min(1, volume));
            videoRef.current.muted = isMuted;
        }
    }, [volume, isMuted]);

    // Sync Speed
    useEffect(() => {
        if(videoRef.current) videoRef.current.playbackRate = playbackRate;
    }, [playbackRate]);

    // Handle Seek
    useEffect(() => {
        if (videoRef.current && seekTime !== undefined && seekTime !== null) {
            if (Math.abs(videoRef.current.currentTime - seekTime) > 0.5) {
                videoRef.current.currentTime = seekTime;
            }
        }
    }, [seekTime]);

    return (
        <div className="w-full h-full flex items-center justify-center bg-black">
            <video
                ref={videoRef}
                src={src}
                aria-label="Video playback monitor"
                className="w-full h-full object-contain max-h-screen"
                onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime, e.currentTarget.duration)}
                onEnded={onEnded}
                onClick={(e) => {
                    // Click to toggle play handled by parent usually, but here we can emit event
                    // For now, let controls handle it to avoid conflicts
                }}
            />
        </div>
    );
};
