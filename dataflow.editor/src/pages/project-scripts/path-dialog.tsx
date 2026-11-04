import { useState, type FormEvent } from 'react';
import { normalizeScriptPath } from '@dataflow/core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** what to name: a new script or folder, or renaming (moving) one */
export type PathDialogTarget = {
  title: string;
  /** shown under the path (who imports what is renamed) */
  warning?: string;
  initial: string;
  submitLabel: string;
  /** what is wrong with the path typed (the core's rules, and what is already there), or null */
  issue: (path: string) => string | null;
  /** saves it: null when done, or why not (the server's answer) */
  onSave: (path: string) => Promise<string | null>;
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
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const issue = target.issue(path);
    setError(issue ?? '');
    if (issue) {
      return;
    }

    setSaving(true);
    const failed = await target.onSave(normalizeScriptPath(path));
    setSaving(false);
    if (failed) {
      setError(failed);
    } else {
      onClose();
    }
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
        {target.warning && <p className="text-sm text-amber-600 dark:text-amber-400">{target.warning}</p>}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {target.submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
