import { APP_NAME } from '../config';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`rawh-mark ${className}`} aria-hidden="true">
      <span />
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="rawh-wordmark" title={APP_NAME} data-tauri-drag-region>
      RAW<span>H</span>PLAYER
    </span>
  );
}
