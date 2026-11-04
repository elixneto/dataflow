import { newFlowFile, validateFlowFile, type FlowFile } from '@dataflow/core';
import type { Flow } from './flow';

/*
 * A flow's draft (flows.draft_definition): the core's flow file as the editor saves it, with a revision that grows on
 * every save. A save names the revision it started from; when another save came in between, it is refused (409)
 * instead of overwriting it. A flow made before drafts existed (or by the create without one) opens as a new flow:
 * its Start and its End.
 */

export type StoredDraft = { revision: number; flow: FlowFile };

export type FlowDraft = { flow: FlowFile; revision: number };

/** the draft the editor opens: the saved one, or a new flow (revision 0); always with the row's id and name */
export function readDraft(row: Flow): FlowDraft {
  const stored = row.draftDefinition as Partial<StoredDraft> | null;
  const checked = stored?.flow ? validateFlowFile(stored.flow) : null;
  const flow = checked?.ok ? checked.value : newFlowFile(row.name, row.id);
  return { flow: { ...flow, id: row.id, name: row.name }, revision: checked?.ok && typeof stored?.revision === 'number' ? stored.revision : 0 };
}

/** the revision a row's draft is at (0 when it has none yet) */
export const revisionOf = (row: Flow) => {
  const stored = row.draftDefinition as Partial<StoredDraft> | null;
  return stored?.flow && typeof stored.revision === 'number' ? stored.revision : 0;
};
