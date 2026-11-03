import type {ExecutableEdge} from '#types/executable-edge.type';
import type {ExecutableNode} from '#types/executable-node.type';
import type {WorkflowParameter} from '#types/workflow-parameter.type';

export type ExecutableWorkflow = {
  /** flow id (the Workflow Invoker calls another one by id) */
  id?: string;
  project: string;
  workflow: string;
  parameters: WorkflowParameter[];
  nodes: ExecutableNode[];
  edges: ExecutableEdge[];
};
