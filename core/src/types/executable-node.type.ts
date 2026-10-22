/** Workflow node as the runner receives it (no position or anything visual). */
export type ExecutableNode = {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
  /** name of the key the component adds to DATA */
  outputKey?: string;
  /** the output carries only this component's key (drops the rest of DATA) */
  override?: boolean;
  disabled?: boolean;
};
