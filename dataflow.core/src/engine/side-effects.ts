import type {ComponentLogic} from '#types/component-logic.type';

/** Whether the component, with this config, writes outside the run (a target): the test-run gate and Run for real use it. */
export function writesOutside(logic: ComponentLogic | undefined, config: Record<string, unknown>): boolean {
  if (!logic?.sideEffects) return false;
  return typeof logic.sideEffects === 'function' ? logic.sideEffects(config) : logic.sideEffects;
}
