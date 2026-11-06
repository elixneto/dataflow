import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_ICON,
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectColorName,
  type ProjectIconName,
} from '@/data/projects/project-appearance';
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  validateNewProject,
  type NewProject,
  type NewProjectErrors,
  type Project,
} from '@/data/projects/project';
import type { ApiResult } from '@/lib/api';
import { ProjectIcon } from './project-icon';

/** what the window is for: a new project, or editing this one */
export type ProjectDialogTarget = { mode: 'create' } | { mode: 'edit'; project: Project };

type Props = {
  /** null = closed */
  target: ProjectDialogTarget | null;
  onClose: () => void;
  /** the projects already there, for the instant "Already in use" check */
  existing: Project[];
  /** saves it (on the server); field errors in the answer show under their fields */
  onSave: (fields: NewProject) => Promise<ApiResult<unknown>>;
};

const EMPTY_PROJECT: NewProject = { name: '', description: '', icon: DEFAULT_PROJECT_ICON, color: DEFAULT_PROJECT_COLOR };

const iconNames = Object.keys(PROJECT_ICONS) as ProjectIconName[];
const colorNames = Object.keys(PROJECT_COLORS) as ProjectColorName[];

const FieldError = ({ message }: { message?: string }) =>
  message ? <p className="text-sm text-destructive">{message}</p> : null;

/** The window to create or edit a project: name (required, unique), description, icon and color. */
export function ProjectDialog({ target, onClose, existing, onSave }: Props) {
  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* a new form each time it opens, so it starts from the project (or empty) */}
        {target && <ProjectForm key={target.mode === 'edit' ? target.project.id : 'new'} {...{ target, onClose, existing, onSave }} />}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({ target, onClose, existing, onSave }: Props & { target: ProjectDialogTarget }) {
  const editing = target.mode === 'edit' ? target.project : undefined;
  const [form, setForm] = useState<NewProject>(
    editing ? { name: editing.name, description: editing.description, icon: editing.icon, color: editing.color } : EMPTY_PROJECT,
  );
  const [errors, setErrors] = useState<NewProjectErrors>({});
  /** an error that is not about one field (e.g. the server is down) */
  const [failure, setFailure] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // checked here first for instant feedback; the server checks again and has the last word
    const { value, errors: found } = validateNewProject(form, existing, editing?.id);
    setErrors(found);
    setFailure('');
    if (Object.keys(found).length > 0) {
      return;
    }

    setSaving(true);
    const result = await onSave(value);
    setSaving(false);
    if (result.ok) {
      onClose();
      return;
    }

    if (result.error.fields) {
      setErrors(result.error.fields as NewProjectErrors);
    } else {
      setFailure(result.error.message);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
        <DialogDescription>A project groups flows and their secrets.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="project-name">Name</Label>
        <div className="flex items-center gap-2">
          <ProjectIcon icon={form.icon} color={form.color} />
          <Input
            id="project-name"
            autoFocus
            maxLength={NAME_MAX}
            value={form.name}
            aria-invalid={errors.name ? true : undefined}
            onChange={event => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <FieldError message={errors.name} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="project-description">Description</Label>
        <Textarea
          id="project-description"
          maxLength={DESCRIPTION_MAX}
          value={form.description}
          aria-invalid={errors.description ? true : undefined}
          onChange={event => setForm({ ...form, description: event.target.value })}
        />
        <FieldError message={errors.description} />
      </div>

      <div className="grid gap-2">
        <Label id="project-icon">Icon</Label>
        {/* 70 icons: seven even rows of 10 */}
        <div role="group" aria-labelledby="project-icon" className="grid grid-cols-10 gap-1">
          {iconNames.map(name => {
            const Icon = PROJECT_ICONS[name];
            const selected = form.icon === name;
            return (
              <Button
                key={name}
                type="button"
                variant={selected ? 'secondary' : 'ghost'}
                size="icon"
                aria-label={name}
                aria-pressed={selected}
                className={cn('size-auto aspect-square', selected && 'ring-2 ring-ring')}
                onClick={() => setForm({ ...form, icon: name })}
              >
                <Icon className={cn(selected && PROJECT_COLORS[form.color].text)} />
              </Button>
            );
          })}
        </div>
        <FieldError message={errors.icon} />
      </div>

      <div className="grid gap-2">
        <Label id="project-color">Color</Label>
        <div role="group" aria-labelledby="project-color" className="flex flex-wrap gap-2">
          {colorNames.map(name => {
            const selected = form.color === name;
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={selected}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  PROJECT_COLORS[name].swatch,
                  selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                )}
                onClick={() => setForm({ ...form, color: name })}
              >
                {selected && <Check className="size-4 text-white" />}
              </button>
            );
          })}
        </div>
        <FieldError message={errors.color} />
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
