import {useState, type ReactNode} from 'react';
import {Link} from 'react-router';
import {CheckCircle2, CircleAlert, Download, Eraser, Group, Loader2, MessageSquarePlus, Network, Play, Redo2, Save, Square, Undo2, Workflow} from 'lucide-react';
import type {RunMode} from '@dataflow/core';
import type {ArrangeDirection} from '#editor/layout';
import {Button} from '#ui/button';
import {ThemeButton} from '#ui/theme';
import {ConnectionStatus} from '#ui/connection-status';

export type ValidationResult = {ok: boolean; messages: string[]} | null;

type Props = {
  /** the flow's project: the link on the left goes back to it */
  project: {id: string; name: string};
  /** the flow's folder in the project (empty = root) */
  folder?: string;
  name: string;
  onName: (name: string) => void;
  validation: ValidationResult;
  onRun: () => void;
  onStop: () => void;
  validating: boolean;
  running: RunMode | null;
  onClear: () => void;
  onArrange: (direction: ArrangeDirection) => void;
  onComment: () => void;
  onGroup: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  changed: boolean;
  onSave: () => void;
  onDownload: () => void;
  /** the Dependencies button (it needs the flow as it is in the editor) */
  dependencies: ReactNode;
  onShowIssues: () => void;
};

export function Toolbar(p: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/" className="flex items-center gap-2 hover:text-foreground" title="Projects">
          <Workflow className="size-5 text-primary" aria-hidden="true"/>
        </Link>
        <span aria-hidden="true">/</span>
        <Link to={`/projects/${p.project.id}`} className="hidden max-w-48 truncate hover:text-foreground sm:inline">{p.project.name}</Link>
        <span aria-hidden="true">/</span>
        {p.folder && (
          <>
            <Link to={`/projects/${p.project.id}?folder=${encodeURIComponent(p.folder)}`} className="hidden max-w-40 truncate hover:text-foreground md:inline" title={p.folder}>
              {p.folder.split('/').pop()}
            </Link>
            <span aria-hidden="true" className="hidden md:inline">/</span>
          </>
        )}
      </div>
      <label className="flex min-w-0 flex-1 items-center">
        <span className="sr-only">Flow name</span>
        <input value={p.name} onChange={e => p.onName(e.target.value)}
               className="h-8 w-full max-w-xs rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-border focus-visible:border-ring"/>
      </label>

      <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
        <Button variant="ghost" size="icon-sm" onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 className="size-4" aria-hidden="true"/>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <Redo2 className="size-4" aria-hidden="true"/>
        </Button>
      </div>

      {p.validation && (
        <button type="button" role="status" onClick={p.onShowIssues}
                className={p.validation.ok ? 'flex max-w-xs items-center gap-2 text-xs text-entity' : 'flex max-w-xs items-center gap-2 text-xs text-destructive hover:underline'}
                title={p.validation.messages.join('\n')}>
          {p.validation.ok ? <CheckCircle2 className="size-4 shrink-0" aria-hidden="true"/> : <CircleAlert className="size-4 shrink-0" aria-hidden="true"/>}
          <span className="truncate">
            {p.validation.ok ? p.validation.messages[0] : `${p.validation.messages.length} issue${p.validation.messages.length === 1 ? '' : 's'}`}
          </span>
        </button>
      )}

      <div className="flex items-center gap-2">
        <ConnectionStatus/>
        <ThemeButton/>
        <Button variant="outline" size="sm" onClick={p.onComment}>
          <MessageSquarePlus className="size-4" aria-hidden="true"/> Comment
        </Button>
        <Button variant="outline" size="sm" onClick={p.onGroup} title="Colored rectangle behind the components">
          <Group className="size-4" aria-hidden="true"/> Group
        </Button>
        {p.dependencies}
        <ArrangeButton onArrange={p.onArrange}/>
        <Button variant="ghost" size="sm" onClick={p.onClear}>
          <Eraser className="size-4" aria-hidden="true"/> Clear
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={p.onDownload} aria-label="Download YAML" title="Download YAML">
          <Download className="size-4" aria-hidden="true"/>
        </Button>
        <Button variant="outline" size="sm" onClick={p.onSave} disabled={!p.changed} title={p.changed ? 'Save now (Ctrl+S)' : 'Saved'}>
          <Save className="size-4" aria-hidden="true"/> {p.changed ? 'Saving…' : 'Saved'}
        </Button>
        {p.running ? (
          <Button size="sm" variant="destructive" onClick={p.onStop} title="Stop the run">
            <Square className="size-3.5 fill-current" aria-hidden="true"/> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={p.onRun} disabled={p.validating}>
            {p.validating ? <Loader2 className="size-4 animate-spin" aria-hidden="true"/> : <Play className="size-4" aria-hidden="true"/>}
            Run
          </Button>
        )}
      </div>
    </header>
  );
}

const ARRANGE_KEY = 'dataflow-arrange-direction';

function readDirection(): ArrangeDirection {
  try {
    return localStorage.getItem(ARRANGE_KEY) === 'vertical' ? 'vertical' : 'horizontal';
  } catch {
    return 'horizontal';
  }
}

/** Arrange: the click repeats the last direction; hovering shows the two (horizontal and vertical). */
function ArrangeButton({onArrange}: {onArrange: (direction: ArrangeDirection) => void}) {
  const [last, setLast] = useState(readDirection);
  const choose = (direction: ArrangeDirection) => {
    setLast(direction);
    try {
      localStorage.setItem(ARRANGE_KEY, direction);
    } catch {
      // no storage: only lasts until reload
    }
    onArrange(direction);
  };
  const options: [ArrangeDirection, string, string][] = [['horizontal', 'Horizontal', '-rotate-90'], ['vertical', 'Vertical', '']];
  return (
    <div className="group relative">
      <Button variant="ghost" size="sm" onClick={() => choose(last)} title={last === 'vertical' ? 'Arrange from top to bottom' : 'Arrange from left to right'}>
        <Network className={last === 'vertical' ? 'size-4' : 'size-4 -rotate-90'} aria-hidden="true"/> Arrange
      </Button>
      <div role="menu" aria-label="Arrange"
           className="invisible absolute top-full left-0 z-50 flex min-w-36 flex-col rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        {options.map(([direction, label, rotate]) => (
          <button key={direction} type="button" role="menuitem" onClick={() => choose(direction)}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent">
            <Network className={`size-4 ${rotate}`} aria-hidden="true"/> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
