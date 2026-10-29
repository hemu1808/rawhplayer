import { useEffect, useRef, useState } from 'react';

export interface PlayerCommand {
  id: string;
  label: string;
  run: () => void;
}
export function CommandPalette({ commands }: { commands: PlayerCommand[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery('');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const matches = commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed top-2 left-24 z-[110] text-xs text-neutral-300"
        aria-label="Open command palette"
      >
        Commands · Ctrl+K
      </button>
      <dialog
        ref={dialog}
        onCancel={() => setOpen(false)}
        aria-labelledby="commands-title"
        className="bg-neutral-950 text-white border border-white/20 rounded-xl p-5 w-[30rem] max-w-[95vw] backdrop:bg-black/70"
      >
        <h2 id="commands-title">Commands</h2>
        <input
          autoFocus
          aria-label="Find a command"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) {
              event.preventDefault();
              setOpen(false);
              matches[0].run();
            }
          }}
          className="my-3 w-full bg-neutral-900 p-3 rounded"
        />
        <ul className="max-h-80 overflow-auto">
          {matches.map((command) => (
            <li key={command.id}>
              <button
                className="w-full text-left p-3 hover:bg-white/10"
                onClick={() => {
                  setOpen(false);
                  command.run();
                }}
              >
                {command.label}
              </button>
            </li>
          ))}
        </ul>
        {!matches.length && <p>No matching commands.</p>}
        <button onClick={() => setOpen(false)} className="mt-3">
          Close commands
        </button>
      </dialog>
    </>
  );
}
