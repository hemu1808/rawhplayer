import { useEffect, useRef, useState } from 'react';
import { Command, X } from 'lucide-react';

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
  function runCommand(command: PlayerCommand) {
    dialog.current?.close();
    setOpen(false);
    command.run();
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="command-trigger" aria-label="Open command palette" title="Commands (Ctrl+K)">
        <Command size={14} /> <span>Commands</span> <kbd>Ctrl K</kbd>
      </button>
      <dialog ref={dialog} onCancel={() => setOpen(false)} aria-labelledby="commands-title" className="command-dialog">
        <div className="command-heading">
          <h2 id="commands-title">Commands</h2>
          <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close commands">
            <X size={17} />
          </button>
        </div>
        <input
          autoFocus
          aria-label="Find a command"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) {
              event.preventDefault();
              runCommand(matches[0]);
            }
          }}
          placeholder="Search commands"
        />
        <ul className="max-h-80 overflow-auto">
          {matches.map((command) => (
            <li key={command.id}>
              <button onClick={() => runCommand(command)}>{command.label}</button>
            </li>
          ))}
        </ul>
        {!matches.length && <p>No matching commands.</p>}
      </dialog>
    </>
  );
}
