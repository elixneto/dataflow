import { useState, type FormEvent } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NAME_MAX, validateName } from '@/data/flows/flow';
import type { ApiResult } from '@/lib/api';

/** what to name: a new folder or flow, or renaming one */
export type NameDialogTarget = {
  title: string;
  /** where it is, e.g. "In Imports / Daily" */
  description?: string;
  initial: string;
  submitLabel: string;
  /** the names next to it, for the instant "Already in use" check */
  siblings: { name: string }[];
  onSave: (name: string) => Promise<ApiResult<unknown>>;
};

type Props = {
  /** null = closed */
  target: NameDialogTarget | null;
  onClose: () => void;
};

/** The window that asks for a name (folders and flows have only that). */
export function NameDialog({ target, onClose }: Props) {
  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {/* a new form each time it opens */}
        {target && <NameForm key={`${target.title}:${target.initial}`} target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ target, onClose }: { target: NameDialogTarget; onClose: () => void }) {
  const [name, setName] = useState(target.initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = validateName(name, target.siblings);
    setError(checked.error ?? '');
    if (checked.error) {
      return;
    }

    setSaving(true);
    const result = await target.onSave(checked.value);
    setSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error.fields?.name ?? result.error.message);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{target.title}</DialogTitle>
        {target.description && <DialogDescription>{target.description}</DialogDescription>}
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="item-name">Name</Label>
        <Input
          id="item-name"
          autoFocus
          maxLength={NAME_MAX}
          value={name}
          aria-invalid={error ? true : undefined}
          onChange={event => setName(event.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : target.submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
