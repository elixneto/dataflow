import { useEffect, useState } from 'react';
import { CircleAlert, Trash } from 'lucide-react';
import { COMPONENTS, componentIssues, componentSettings } from '@dataflow/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { componentInfo, isFixedType } from './catalog';
import { draftChanged, draftOf, type ComponentDraft } from './component-draft';
import type { ComponentData } from './component-node';
import { SettingsForm } from './settings-form';
import { useRunMark } from './run/run-marks';
import { ComponentLastRun } from '@/pages/flow-editor/run-panel';

type Tab = 'configuration' | 'notes' | 'last-run';

type Props = {
  id: string;
  data: ComponentData;
  /** applies the changes (one Ctrl+Z step) and closes */
  onSave: (draft: ComponentDraft) => void;
  /** closes without changing anything */
  onCancel: () => void;
  /** removes the component from the canvas */
  onRemove: () => void;
  /** gives the window's X and Esc this window's way to close (asks first when there are unsaved changes) */
  registerClose: (close: () => void) => void;
  /** whether it has unsaved changes, each time that changes (the minimized window's chip shows it) */
  onChanged?: (changed: boolean) => void;
};

/**
 * The body of a component's window: Configuration (its name on the canvas, the key it writes in the envelope when it
 * has one, what the core finds wrong with its config, then the component's own settings) and Notes (free notes and what
 * the component does). Unlike the PoC, nothing changes on the canvas while typing: Save applies it all at once, Cancel
 * drops it (it is explicit), X or Esc drop it too but ask first when something changed, Remove deletes the component.
 * The settings come from the core (ComponentLogic.settings).
 */
export function ComponentWindow({ id, data, onSave, onCancel, onRemove, registerClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('configuration');
  const mark = useRunMark(id);
  // this run's, unless it did not run this component (skipped by a Run from here): then the full run's
  const ranHere = !!mark?.run && mark.run.status !== 'skipped' && mark.run.status !== 'not-run';
  const lastRun = ranHere ? mark?.run : (mark?.full ?? mark?.run);
  const lastAbout = ranHere || !mark?.full ? mark?.about : mark?.fullAbout;
  const [draft, setDraft] = useState<ComponentDraft>(() => draftOf(data));
  const info = componentInfo(data.type);
  const logic = COMPONENTS[data.type];
  const settings = componentSettings(data.type);
  const issues = componentIssues(data.type, draft.config);
  const changed = draftChanged(draft, data);
  useEffect(() => {
    onChanged?.(changed);
  }, [changed, onChanged]);
  const set = (changes: Partial<ComponentDraft>) => setDraft(current => ({ ...current, ...changes }));

  // X or Esc with unsaved changes: asks before dropping them (Cancel does not ask: it is explicit)
  const [confirming, setConfirming] = useState(false);
  const requestClose = () => (changed ? setConfirming(true) : onCancel());
  useEffect(() => {
    registerClose(requestClose);
  });

  return (
    <>
      <div role="tablist" className="flex shrink-0 gap-1 border-b px-3">
        {(
          [
            ['configuration', 'Configuration'],
            ['notes', 'Notes'],
            ['last-run', 'Last run'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              tab === value ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {value === 'notes' && draft.notes?.trim() && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-amber-500 align-middle" aria-label="has a note" />}
          </button>
        ))}
      </div>

      {tab === 'configuration' ? (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto p-4 [&>*]:shrink-0">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-label`}>Name</Label>
            <Input id={`${id}-label`} value={draft.label} placeholder={info?.label} onChange={event => set({ label: event.target.value })} />
          </div>

          {logic?.defaultOutputKey && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-key`}>Key in the envelope</Label>
              <div className="flex items-center gap-1">
                <span className="font-mono text-sm text-muted-foreground">$</span>
                <Input
                  id={`${id}-key`}
                  value={draft.outputKey}
                  placeholder={logic.defaultOutputKey}
                  className="font-mono"
                  onChange={event => set({ outputKey: event.target.value })}
                />
              </div>
            </div>
          )}

          {logic?.usesOverride && (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <input
                id={`${id}-override`}
                type="checkbox"
                checked={draft.override}
                className="size-4 accent-primary"
                onChange={event => set({ override: event.target.checked })}
              />
              Override
            </label>
          )}

          {issues.length > 0 && (
            <ul aria-label="Issues" className="grid gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {issues.map(issue => (
                <li key={issue} className="flex gap-2">
                  <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>{issue.charAt(0).toUpperCase() + issue.slice(1)}</span>
                </li>
              ))}
            </ul>
          )}

          {settings.length > 0 && (
            <section aria-label="Settings" className="border-t pt-4">
              <SettingsForm id={id} nodeId={id} fields={settings} values={draft.config} onChange={config => set({ config })} />
            </section>
          )}
        </div>
      ) : tab === 'last-run' ? (
        // what this component received and sent in the last run (a Run from here: the full run for what it skipped)
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-auto">
          <ComponentLastRun c={lastRun} about={lastAbout} />
        </div>
      ) : (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 [&>*]:shrink-0">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-notes`}>Notes</Label>
            <Textarea id={`${id}-notes`} value={draft.notes} className="min-h-24" onChange={event => set({ notes: event.target.value })} />
          </div>
          <p className="border-t pt-4 text-sm leading-relaxed text-muted-foreground">{info?.description}</p>
        </div>
      )}

      {confirming ? (
        <footer role="alertdialog" aria-label="Discard changes?" className="flex shrink-0 items-center gap-2 border-t bg-muted/50 px-4 py-3">
          <span className="text-sm font-medium">Discard changes?</span>
          <Button variant="outline" size="sm" className="ml-auto" autoFocus onClick={() => setConfirming(false)}>
            Keep editing
          </Button>
          <Button variant="destructive" size="sm" onClick={onCancel}>
            Discard
          </Button>
        </footer>
      ) : (
        <footer className="flex shrink-0 items-center gap-2 border-t px-4 py-3">
          {/* the Start cannot be removed */}
          {!isFixedType(data.type) && (
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRemove}>
              <Trash /> Remove
            </Button>
          )}
          <Button variant="outline" size="sm" className="ml-auto" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!changed} onClick={() => onSave(draft)}>
            Save
          </Button>
        </footer>
      )}
    </>
  );
}
