import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { variableNameError, variableValueError, type Variable } from '@/data/variables/variable';
import type { ApiResult } from '@/lib/api';

/** a new variable (name and value), or a new value for this one */
export type VariableDialogTarget = { mode: 'create' } | { mode: 'edit'; variable: Variable };

type Props = {
  /** null = closed */
  target: VariableDialogTarget | null;
  existing: Variable[];
  onClose: () => void;
  onSave: (fields: { name: string; value: string }) => Promise<ApiResult<unknown>>;
};

/** The window to create a variable or change its value. Unlike a secret, the value is plain text, shown as is. */
export function VariableDialog({ target, existing, onClose, onSave }: Props) {
  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && <VariableForm key={target.mode === 'edit' ? target.variable.id : 'new'} {...{ target, existing, onClose, onSave }} />}
      </DialogContent>
    </Dialog>
  );
}

function VariableForm({ target, existing, onClose, onSave }: Props & { target: VariableDialogTarget }) {
  const editing = target.mode === 'edit' ? target.variable : undefined;
  const [name, setName] = useState(editing?.name ?? '');
  const [value, setValue] = useState(editing?.value ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = Object.fromEntries(
      Object.entries({ name: editing ? undefined : variableNameError(name.trim(), existing), value: variableValueError(value) }).filter(([, e]) => e),
    ) as Record<string, string>;
    setErrors(found);
    setFailure('');
    if (Object.keys(found).length > 0) {
      return;
    }

    setSaving(true);
    const result = await onSave({ name: name.trim(), value });
    setSaving(false);
    if (result.ok) {
      onClose();
    } else if (result.error.fields) {
      setErrors(result.error.fields);
    } else {
      setFailure(result.error.message);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${editing.name}` : 'New variable'}</DialogTitle>
        <DialogDescription>A plain value the flows read; it is shown to everyone in the project. For passwords and keys, use a secret.</DialogDescription>
      </DialogHeader>

      {!editing && (
        <div className="grid gap-2">
          <Label htmlFor="variable-name">Name</Label>
          <Input
            id="variable-name"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={name}
            placeholder="api_base_url"
            className="font-mono"
            aria-invalid={errors.name ? true : undefined}
            onChange={event => setName(event.target.value)}
          />
          {errors.name ? (
            <p className="text-sm text-destructive">{errors.name}</p>
          ) : (
            <span></span>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="variable-value">Value</Label>
        <Textarea
          id="variable-value"
          autoFocus={Boolean(editing)}
          value={value}
          rows={3}
          className="font-mono"
          aria-invalid={errors.value ? true : undefined}
          onChange={event => setValue(event.target.value)}
        />
        {errors.value && <p className="text-sm text-destructive">{errors.value}</p>}
      </div>

      {failure && <p className="text-sm text-destructive">{failure}</p>}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : editing ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}
