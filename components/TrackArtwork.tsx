import { Disc3 } from 'lucide-react';

export function TrackArtwork({ src, cover = false }: { src?: string | null; cover?: boolean }) {
  return (
    <span className={`track-artwork${cover ? ' track-artwork--cover' : ''}`} aria-hidden="true">
      {src ? (
        <img src={src} alt="" />
      ) : cover ? (
        <span className="artwork-disc">
          <span />
        </span>
      ) : (
        <Disc3 size={20} />
      )}
    </span>
  );
}
