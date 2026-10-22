import {Link} from 'react-router'
import {CheckCircle2, CircleAlert, Eraser, Group, Loader2, MessageSquarePlus, Network, Play, Redo2, Save, Square, Undo2, Workflow} from 'lucide-react'
import type {RunMode} from '@dataflow/core'
import {Button} from '@/ui/button'
import {ThemeButton} from '@/ui/theme'

export type ValidationResult = {ok: boolean; messages: string[]} | null

type Props = {
  /** the flow's project: the link on the left goes back to it */
  project: {id: string; name: string}
  /** the flow's folder in the project (empty = root) */
  folder?: string
  name: string
  onName: (name: string) => void
  validation: ValidationResult
  onRun: () => void
  onStop: () => void
  validating: boolean
  running: RunMode | null
  onClear: () => void
  onArrange: () => void
  onComment: () => void
  onGroup: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  changed: boolean
  onSave: () => void
  onShowIssues: () => void
}

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
        <ThemeButton/>
        <Button variant="outline" size="sm" onClick={p.onComment}>
          <MessageSquarePlus className="size-4" aria-hidden="true"/> Comment
        </Button>
        <Button variant="outline" size="sm" onClick={p.onGroup} title="Colored rectangle behind the components">
          <Group className="size-4" aria-hidden="true"/> Group
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onArrange} title="Arrange from left to right">
          <Network className="size-4 -rotate-90" aria-hidden="true"/> Arrange
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onClear}>
          <Eraser className="size-4" aria-hidden="true"/> Clear
        </Button>
        <Button variant="outline" size="sm" onClick={p.onSave} disabled={!p.changed} title={p.changed ? 'Save (Ctrl+S)' : 'Nothing to save'}>
          <Save className="size-4" aria-hidden="true"/> {p.changed ? 'Save' : 'Saved'}
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
  )
}
