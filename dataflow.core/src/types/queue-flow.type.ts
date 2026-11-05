/**
 * A Flow Invoker's fire and forget call in a real run: another flow to run on its own, later, as a run of its own
 * (queued: its runner gives it to a supervisor). `chain`: the flows called so far down to it (circular calls and depth
 * are checked against it in the run it starts too); `rootName`: the first one's name, for those messages.
 */
export type QueueFlowRequest = {
  flowId: string;
  parameters: Record<string, string>;
  input?: unknown;
  chain: string[];
  rootName: string;
  /** the Flow Invoker that called it */
  nodeId: string;
  nodeLabel: string;
};

/** Queues the run (the runner's: a worker asks its supervisor) and answers its id; rejects when it could not. */
export type QueueFlow = (request: QueueFlowRequest) => Promise<{id: string}>;
