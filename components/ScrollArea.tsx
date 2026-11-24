import type { ReactNode, UIEvent } from 'react';

interface ScrollAreaProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  onScrollChange?: (event: UIEvent<HTMLDivElement>) => void;
}

export function ScrollArea({ title, subtitle, children, action, onScrollChange }: ScrollAreaProps) {
  return (
    <section className="workspace">
      <header className="workspace-heading">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action && <div className="workspace-actions">{action}</div>}
      </header>
      <div className="workspace-content custom-scrollbar" onScroll={onScrollChange}>
        {children}
      </div>
    </section>
  );
}
