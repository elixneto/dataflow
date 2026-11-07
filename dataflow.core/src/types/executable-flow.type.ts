import type {ExecutableEdge} from '#types/executable-edge.type';
import type {ExecutableNode} from '#types/executable-node.type';
import type {FlowParameter} from '#types/flow-parameter.type';
import type {TypeShape} from '../scripts/type-shape';

export type ExecutableFlow = {
  /** flow id (the Flow Invoker calls another one by id) */
  id?: string;
  /** its folders and name (`Imports/Bynder/Main`): how a Flow Invoker names it by expression */
  path?: string;
  project: string;
  flow: string;
  parameters: FlowParameter[];
  nodes: ExecutableNode[];
  edges: ExecutableEdge[];
  /**
   * The Start's input type (a project script's type), read when the run was queued: a Flow Invoker checks what it
   * sends against it before calling this flow
   */
  inputType?: {name: string; shape: TypeShape};
  /** why this flow cannot be called (it does not validate, its input type is gone...): each call is an error */
  unavailable?: string;
};
