import type {ExecutableEdge} from '#types/executable-edge.type';
import type {ExecutableNode} from '#types/executable-node.type';
import type {FlowParameter} from '#types/flow-parameter.type';

export type ExecutableFlow = {
  /** flow id (the Flow Invoker calls another one by id) */
  id?: string;
  project: string;
  flow: string;
  parameters: FlowParameter[];
  nodes: ExecutableNode[];
  edges: ExecutableEdge[];
};
