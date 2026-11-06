import { useState, type FormEvent } from 'react';
import { ArrowLeft, CircleCheck, CircleX, LoaderCircle, Plus, Search, Zap } from 'lucide-react';
import { SecretValueInput } from '@/components/secret-value-input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { validateProfile, type ConnectionProfile, type ProfileFields } from '@/data/connections/connection-profile';
import type { NewSecret } from '@/data/connections/connections-api';
import {
  connectionType,
  defaultConfig,
  typesByGroup,
  visibleFields,
  type ConnectionField,
  type ConnectionTypeName,
} from '@/data/connections/connection-types';
import { secretNameError, type Secret } from '@/data/secrets/secret';
import type { ApiResult } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ConnectionTypeIcon } from './connection-type-icon';

/** a new connection (its type is picked first), or editing this one */
export type ConnectionDialogTarget = { mode: 'create' } | { mode: 'edit'; profile: ConnectionProfile };

type Props = {
  /** null = closed */
  target: ConnectionDialogTarget | null;
  profiles: ConnectionProfile[];
  secrets: Secret[];
  onClose: () => void;
  /** saves the connection and the secrets typed in the form (created together, all or nothing) */
  onSave: (fields: ProfileFields, newSecrets: NewSecret[]) => Promise<ApiResult<unknown>>;
  /** tests the profile as typed (nothing saved) */
  onTest: (fields: ProfileFields, newSecrets: NewSecret[]) => Promise<ApiResult<{ message: string; ms: number }>>;
};

type TestResult = { status: 'testing' } | { status: 'ok' | 'failed'; message: string };

const SELECT = 'h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30';

/** New connection: pick the type, then fill its fields. Edit: the fields of its type. */
export function ConnectionDialog(props: Props) {
  const { target, onClose } = props;
  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {target && <ConnectionForm key={target.mode === 'edit' ? target.profile.id : 'new'} {...props} target={target} />}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionForm({ target, profiles, secrets, onClose, onSave, onTest }: Props & { target: ConnectionDialogTarget }) {
  const editing = target.mode === 'edit' ? target.profile : undefined;
  const [type, setType] = useState<ConnectionTypeName | null>(editing?.type ?? null);
  const [name, setName] = useState(editing?.name ?? '');
  const [config, setConfig] = useState<Record<string, string>>(editing ? { ...editing.config } : {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);
  const [tested, setTested] = useState<TestResult | null>(null);
  /** secrets typed with "+ New": kept here until the connection is saved (closing the window drops them) */
  const [pending, setPending] = useState<NewSecret[]>([]);

  if (type === null) {
    return (
      <TypePicker
        onPick={picked => {
          setType(picked);
          setConfig(defaultConfig(picked));
        }}
      />
    );
  }

  const kind = connectionType(type);
  // a change makes the last test result stale
  const set = (key: string, value: string) => {
    setConfig(current => ({ ...current, [key]: value }));
    setTested(null);
  };
  const secretNames = [...secrets.map(s => ({ name: s.name, pending: false })), ...pending.map(s => ({ name: s.name, pending: true }))];

  // the profile's fields (the name aside: a test does not need it), then the server connects with them
  const test = async () => {
    const checked = validateProfile({ name, type, config }, [], secretNames.map(s => s.name));
    const { name: _name, ...problems } = checked.errors;
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      setTested(null);
      return;
    }

    setTested({ status: 'testing' });
    const used = new Set(Object.values(checked.value.config));
    const result = await onTest(checked.value, pending.filter(secret => used.has(secret.name)));
    if (!result.ok && result.error.fields) {
      setErrors(result.error.fields);
    }

    setTested(result.ok ? { status: 'ok', message: `${result.value.message} ${result.value.ms} ms` } : { status: 'failed', message: result.error.message });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields = { name, type, config };
    const checked = validateProfile(fields, profiles, secretNames.map(s => s.name), editing?.id);
    setErrors(checked.errors);
    setFailure('');
    if (Object.keys(checked.errors).length > 0) {
      return;
    }

    setSaving(true);
    // only the new secrets a field still uses go with the connection
    const used = new Set(Object.values(checked.value.config));
    const result = await onSave(checked.value, pending.filter(secret => used.has(secret.name)));
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
        <DialogTitle className="flex items-center gap-2">
          {!editing && (
            <Button type="button" variant="ghost" size="icon" className="-ml-2 size-7" aria-label="Choose another type" onClick={() => setType(null)}>
              <ArrowLeft />
            </Button>
          )}
          <ConnectionTypeIcon type={kind.type} className="size-5" />
          {editing ? `Edit ${editing.name}` : `New ${kind.label} connection`}
        </DialogTitle>
        <DialogDescription>Passwords, keys and tokens come from the project's Secrets.</DialogDescription>
      </DialogHeader>

      <Field id="connection-name" label="Name" error={errors.name}>
        <Input id="connection-name" autoFocus value={name} aria-invalid={errors.name ? true : undefined} onChange={event => setName(event.target.value)} />
      </Field>

      {visibleFields(type, config).map(field => (
        <Field key={field.key} id={`connection-${field.key}`} label={field.label} required={field.required} error={errors[field.key]}>
          <FieldInput
            field={field}
            value={config[field.key] ?? ''}
            invalid={Boolean(errors[field.key])}
            secretNames={secretNames}
            onChange={value => set(field.key, value)}
            onAddSecret={secret => setPending(current => [...current, secret])}
          />
        </Field>
      ))}

      {failure && <p className="text-sm text-destructive">{failure}</p>}

      {tested && (
        <p
          role="status"
          className={cn(
            'flex items-start gap-1.5 text-sm break-words',
            tested.status === 'failed' ? 'text-destructive' : tested.status === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
          )}
        >
          {tested.status === 'testing' && <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />}
          {tested.status === 'ok' && <CircleCheck className="mt-0.5 size-4 shrink-0" />}
          {tested.status === 'failed' && <CircleX className="mt-0.5 size-4 shrink-0" />}
          <span className="min-w-0">{tested.status === 'testing' ? 'Testing…' : tested.message}</span>
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" className="sm:mr-auto" disabled={tested?.status === 'testing'} onClick={() => void test()}>
          <Zap /> Test connection
        </Button>
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

/** "What does it connect to?": the types by group (APIs, Storage, Databases, Messaging), with a search */
function TypePicker({ onPick }: { onPick: (type: ConnectionTypeName) => void }) {
  const [search, setSearch] = useState('');
  const groups = typesByGroup(search);

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New connection</DialogTitle>
        <DialogDescription>What does it connect to?</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={search} placeholder="Search" aria-label="Search connection types" className="pl-9" onChange={event => setSearch(event.target.value)} />
      </div>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">No connection type found.</p>}
      {groups.map(({ group, label, types }) => (
        <section key={group} className="grid gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
          <div className="grid grid-cols-2 gap-2">
            {types.map(option => (
              <button
                key={option.type}
                type="button"
                onClick={() => onPick(option.type)}
                className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ConnectionTypeIcon type={option.type} className="size-5" />
                {option.label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Field({ id, label, required, error, children }: { id: string; label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-muted-foreground">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

type FieldInputProps = {
  field: ConnectionField;
  value: string;
  invalid: boolean;
  /** the project's secrets and the ones typed in this form (not created yet) */
  secretNames: { name: string; pending: boolean }[];
  onChange: (value: string) => void;
  onAddSecret: (secret: NewSecret) => void;
};

function FieldInput({ field, value, invalid, secretNames, onChange, onAddSecret }: FieldInputProps) {
  const id = `connection-${field.key}`;
  const aria = invalid ? true : undefined;

  if (field.kind === 'textarea') {
    return <Textarea id={id} value={value} aria-invalid={aria} onChange={event => onChange(event.target.value)} />;
  }

  if (field.kind === 'select') {
    return (
      <select id={id} value={value} aria-invalid={aria} className={SELECT} onChange={event => onChange(event.target.value)}>
        {field.options?.map(option => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === 'secret') {
    return <SecretPicker id={id} value={value} invalid={invalid} secretNames={secretNames} onChange={onChange} onAddSecret={onAddSecret} />;
  }

  return (
    <Input
      id={id}
      inputMode={field.kind === 'number' ? 'numeric' : undefined}
      placeholder={field.placeholder}
      value={value}
      aria-invalid={aria}
      onChange={event => onChange(event.target.value)}
    />
  );
}

/**
 * A sensitive field: one of the project's secrets, or a new one typed right here. A new one is only kept in the form
 * ("name (new)") and created together with the connection; Cancel drops it.
 */
function SecretPicker({ id, value, invalid, secretNames, onChange, onAddSecret }: Omit<FieldInputProps, 'field'> & { id: string }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    const nameError = secretNameError(name, secretNames);
    if (nameError || secretValue === '') {
      setError(nameError ?? 'Value required');
      return;
    }

    onAddSecret({ name, value: secretValue });
    onChange(name);
    setAdding(false);
    setName('');
    setSecretValue('');
    setError('');
  };

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <select id={id} value={value} aria-invalid={invalid ? true : undefined} className={cn(SELECT, 'font-mono')} onChange={event => onChange(event.target.value)}>
          <option value="">Choose a secret…</option>
          {secretNames.map(secret => (
            <option key={secret.name} value={secret.name}>
              {secret.pending ? `${secret.name} (new)` : secret.name}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" className="h-9" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          <Plus /> New
        </Button>
      </div>
      {adding && (
        <div className="grid gap-2 rounded-md border border-dashed p-3">
          <Input
            value={name}
            placeholder="new_secret_name"
            aria-label="New secret name"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            onChange={event => setName(event.target.value)}
          />
          <SecretValueInput value={secretValue} placeholder="Value" aria-label="New secret value" onChange={setSecretValue} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">It is created when the connection is saved.</p>
          <Button type="button" size="sm" className="justify-self-start" onClick={add}>
            Use this secret
          </Button>
        </div>
      )}
    </div>
  );
}