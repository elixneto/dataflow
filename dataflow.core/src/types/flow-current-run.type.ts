import type {RunMode} from '#types/run-mode.type';

export type FlowCurrentRun = {
  id: string;
  mode: RunMode;
  project: string;
  flow: string;
  startedAt: string;
  /** run that called this one (Flow Invoker); without it, it was called from outside */
  parentId?: string;
};
