import { useState } from 'react';
import { Folder as FolderIcon, FolderRoot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ProjectContents } from '@/data/flows/flow';
import { canMoveFolder, childrenOf } from '@/data/flows/project-tree';
import type { ApiResult } from '@/lib/api';
import { cn } from '@/lib/utils';

/** what moves: a folder (with what is under it) or a flow */
export type MoveTarget = { kind: 'folder' | 'flow'; id: string; name: string; currentFolderId: string | null };

type Props = {
  /** null = closed */
  target: MoveTarget | null;
  contents: ProjectContents;
  onClose: () => void;
  onMove: (target: MoveTarget, folderId: string | null) => Promise<ApiResult<unknown>>;
};

type Choice = { id: string | null; name: string; depth: number; disabled: boolean };

/** the project root and every visible folder, as an indented list; a folder cannot go into itself or under itself */
function choices(contents: ProjectContents, target: MoveTarget): Choice[] {
  const list: Choice[] = [{ id: null, name: 'Project root', depth: 0, disabled: false }];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childrenOf(contents, parentId).folders) {
      const disabled = target.kind === 'folder' && !canMoveFolder(contents.folders, target.id, folder.id);
      list.push({ id: folder.id, name: folder.name, depth, disabled });
      walk(folder.id, depth + 1);
    }
  };

  walk(null, 1);
  return list;
}

/** "Move to…": pick a folder (or the project root) for a folder or flow. */
export function MoveDialog({ target, contents, onClose, onMove }: Props) {
  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && <MoveForm key={target.id} target={target} contents={contents} onClose={onClose} onMove={onMove} />}
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({ target, contents, onClose, onMove }: Props & { target: MoveTarget }) {
  const [selected, setSelected] = useState<string | null>(target.currentFolderId);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const options = choices(contents, target);

  const move = async () => {
    setSaving(true);
    const result = await onMove(target, selected);
    setSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Move {target.name}</DialogTitle>
        <DialogDescription>Choose where the {target.kind} goes.</DialogDescription>
      </DialogHeader>

      <div role="radiogroup" aria-label="Destination" className="max-h-72 overflow-y-auto rounded-md border p-1">
        {options.map(option => (
          <button
            key={option.id ?? 'root'}
            type="button"
            role="radio"
            aria-checked={selected === option.id}
            disabled={option.disabled}
            onClick={() => setSelected(option.id)}
            style={{ paddingLeft: `${0.5 + option.depth * 1.25}rem` }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm py-1.5 pr-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
              selected === option.id && 'bg-accent font-medium',
            )}
          >
            {option.id === null ? <FolderRoot className="size-4 shrink-0" /> : <FolderIcon className="size-4 shrink-0" />}
            <span className="truncate">{option.name}</span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button disabled={saving || selected === target.currentFolderId} onClick={() => void move()}>
          {saving ? 'Moving...' : 'Move'}
        </Button>
      </DialogFooter>
    </div>
  );
}
