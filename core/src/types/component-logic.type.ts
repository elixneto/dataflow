import type {ComponentContext} from '#types/component-context.type';
import type {ComponentOutput} from '#types/component-output.type';
import type {Envelope} from '#types/envelope.type';
import type {Issue} from '#types/issue.type';

export type ComponentLogic = {
  type: string;

  /** number of inputs (in-0, in-1...); every port carries envelopes */
  inputs: number;
  /** number of outputs (out-0, out-1...), besides the error port */
  outputs: number;
  /** outputs that may stay unconnected: what goes out through them is dropped silently (e.g. Filter's false, Router's else) */
  optionalOutputs?: string[] | ((config: Record<string, unknown>) => string[]);
  /**
   * Number of inputs chosen on the node (e.g. Union, 2 to 100), stored in config[key]; replaces `inputs`.
   */
  variableInputs?: {min: number; max: number; key: string};
  /** Number of outputs chosen on the node (e.g. Copy, 2 to 10), stored in config[key]; replaces `outputs`. */
  variableOutputs?: {min: number; max: number; key: string};
  /**
   * Default DATA key where the component puts what it produces (the node can change it).
   * Without it, the component writes directly into the DATA fields (e.g. Mapper).
   */
  defaultOutputKey?: string;
  /**
   * A target: writes outside the run (a database, an API). In a test run (`validation`, the editor's Run) it does not
   * write and its branch stops there, unless it is pinned (docs/architecture.md, section 12). Runs for real in `execution`.
   * A function of the config when it depends on it (e.g. an HTTP request writes only with POST, PUT, PATCH, DELETE).
   */
  sideEffects?: boolean | ((config: Record<string, unknown>) => boolean);
  /** configuration issues (no data): short messages, without the component's name */
  validate: (config: Record<string, unknown>) => Issue[];
  /** envelope by envelope */
  execute: (inputs: Record<string, AsyncIterable<Envelope>>, config: Record<string, unknown>, ctx: ComponentContext) => AsyncIterable<ComponentOutput>;
};
