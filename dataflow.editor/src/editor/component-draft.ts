import type { ComponentData } from './component-node';

/** what a component's window edits: the node's own fields and its config */
export type ComponentDraft = Pick<ComponentData, 'label' | 'outputKey' | 'notes' | 'config'>;

/** the draft a window starts from: the node as it is (empty fields as '') */
export const draftOf = (data: ComponentData): ComponentDraft => ({
  label: data.label ?? '',
  outputKey: data.outputKey ?? '',
  notes: data.notes ?? '',
  config: data.config,
});

/** whether the draft differs from the node (then closing with X or Esc asks first) */
export function draftChanged(draft: ComponentDraft, data: ComponentData): boolean {
  const saved = draftOf(data);
  return (['label', 'outputKey', 'notes'] as const).some(key => draft[key] !== saved[key]) || JSON.stringify(draft.config) !== JSON.stringify(saved.config);
}
