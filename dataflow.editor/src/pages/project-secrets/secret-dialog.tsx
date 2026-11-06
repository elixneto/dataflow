import { useState, type FormEvent } from 'react';
import { SecretValueInput } from '@/components/secret-value-input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { secretNameError, secretValueError, type Secret } from '@/data/secrets/secret';
import type { ApiResult } from '@/lib/api';

/** a new secret (name and value), or a new value for this one */
export type SecretDialogTarget = { mode: 'create' } | { mode: 'replace'; secret: Secret };

type Props = {
  /** null = closed */
  target: SecretDialogTarget | null;
  existing: Secret[];
  onClose: () => void;
  onSave: (fields: { name: string; value: string }) => Promise<ApiResult<unknown>>;
};

/** The window to create a secret or replace its value. The value is typed here and never shown again. */
export function SecretDialog({ target, existing, onClose, onSave }: Props) {
  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && <SecretForm key={target.mode === 'replace' ? target.secret.id : 'new'} {...{ target, existing, onClose, onSave }} />}
      </DialogContent>
    </Dialog>
  );
}

function SecretForm({ target, existing, onClose, onSave }: Props & { target: SecretDialogTarget }) {
  const replacing = target.mode === 'replace' ? target.secret : undefined;
  const [name, setName] = useState(replacing?.name ?? '');
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = Object.fromEntries(
      Object.entries({ name: replacing ? undefined : secretNameError(name.trim(), existing), value: secretValueError(value) }).filter(([, e]) => e),
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
        <DialogTitle>{replacing ? `Replace the value of ${replacing.name}` : 'New secret'}</DialogTitle>
        <DialogDescription>The value is stored encrypted and is never shown again.</DialogDescription>
      </DialogHeader>

      {!replacing && (
        <div className="grid gap-2">
          <Label htmlFor="secret-name">Name</Label>
          <Input
            id="secret-name"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            autoFocus
            value={name}
            placeholder="db_password"
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
        <Label htmlFor="secret-value">Value</Label>
        <SecretValueInput
          id="secret-value"
          autoFocus={Boolean(replacing)}
          value={value}
          aria-invalid={errors.value ? true : undefined}
          onChange={setValue}
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
          {saving ? 'Saving...' : replacing ? 'Replace' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}
