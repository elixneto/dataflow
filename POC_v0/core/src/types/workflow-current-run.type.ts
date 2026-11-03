import type {RunMode} from '#types/run-mode.type';

export type WorkflowCurrentRun = {
  id: string;
  mode: RunMode;
  project: string;
  workflow: string;
  startedAt: string;
  /** run that called this one (Workflow Invoker); without it, it was called from outside */
  parentId?: string;
};
