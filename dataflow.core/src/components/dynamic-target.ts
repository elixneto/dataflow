/*
 * A Flow Invoker's flow or a Script Invoker's function picked in the run: its setting holds DYNAMIC_TARGET, and an
 * expression on each envelope gives the target's whole path (`Folder/Sub/Flow name`, `folder/script#function`). The
 * runner cannot know beforehand which one: a run with such a call takes every flow (or script) of the project.
 */

/** the value of the flow or function setting when an expression names the target */
export const DYNAMIC_TARGET = '$dynamic';

/** whether the components pick a flow (Flow Invoker) or a function (Script Invoker) in the run */
export function dynamicTargets(nodes: {type: string; config: Record<string, unknown>}[]): {flows: boolean; scripts: boolean} {
  return {
    flows: nodes.some(n => n.type === 'flow' && n.config.flowId === DYNAMIC_TARGET),
    scripts: nodes.some(n => n.type === 'script' && n.config.function === DYNAMIC_TARGET),
  };
}
