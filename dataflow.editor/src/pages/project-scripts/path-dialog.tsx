import { useState, type FormEvent } from 'react';
import { normalizeScriptPath } from '@dataflow/core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** what to name: a new script or folder, or renaming (moving) one */
export type PathDialogTarget = {
  title: string;
  initial: string;
  submitLabel: string;
  /** what is wrong with the path typed (the core's rules, and what is already there), or null */
  issue: (path: string) => string | null;
  onSave: (path: string) => void;
};

/** The window that asks for a script's or a folder's path (folders/name, e.g. upload/types). */
export function PathDialog({ target, onClose }: { target: PathDialogTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">{target && <PathForm key={`${target.title}:${target.initial}`} target={target} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function PathForm({ target, onClose }: { target: PathDialogTarget; onClose: () => void }) {
  const [path, setPath] = useState(target.initial);
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const issue = target.issue(path);
    setError(issue ?? '');
    if (issue) {
      return;
    }

    target.onSave(normalizeScriptPath(path));
    onClose();
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{target.title}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="script-path">Path</Label>
        <Input
          id="script-path"
          autoFocus
          placeholder="folder/name"
          className="font-mono"
          value={path}
          aria-invalid={error ? true : undefined}
          onChange={event => setPath(event.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit">{target.submitLabel}</Button>
      </DialogFooter>
    </form>
  );
}
