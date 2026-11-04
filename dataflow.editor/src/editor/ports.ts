import { COMPONENTS, router, routerCases } from '@dataflow/core';
import { componentInfo } from './catalog';

/*
 * A component node's ports, from @dataflow/core: inputs in-0, in-1... on the left, outputs out-0, out-1... on the right.
 * Components with a chosen number of ports (Union inputs, Copy outputs) read it from the config, within their limits;
 * the Router has one output per case and the else.
 */

/** optional: an output that may stay unconnected (what goes out through it is dropped), e.g. Filter's false */
export type Port = { id: string; label?: string; optional?: boolean };

const count = (config: Record<string, unknown>, limits: { min: number; max: number; key: string }) => {
  const n = Math.round(Number(config[limits.key] ?? limits.min));
  return Math.min(limits.max, Math.max(limits.min, Number.isFinite(n) ? n : limits.min));
};

export function inputPorts(type: string, config: Record<string, unknown> = {}): Port[] {
  const logic = COMPONENTS[type];
  if (!logic) {
    return [];
  }

  const total = logic.variableInputs ? count(config, logic.variableInputs) : logic.inputs;
  const labels = componentInfo(type)?.inputLabels ?? [];
  return Array.from({ length: total }, (_, i) => ({ id: `in-${i}`, label: labels[i] }));
}

export function outputPorts(type: string, config: Record<string, unknown> = {}): Port[] {
  const logic = COMPONENTS[type];
  if (!logic) {
    return [];
  }

  const optional = typeof logic.optionalOutputs === 'function' ? logic.optionalOutputs(config) : (logic.optionalOutputs ?? []);
  const mark = (ports: Port[]) => ports.map(p => (optional.includes(p.id) ? { ...p, optional: true } : p));

  if (type === router.type) {
    const cases = routerCases(config);
    return mark([...cases.map((_, i) => ({ id: `out-${i}`, label: `case ${i + 1}` })), { id: `out-${cases.length}`, label: 'else' }]);
  }

  const total = logic.variableOutputs ? count(config, logic.variableOutputs) : logic.outputs;
  const labels = componentInfo(type)?.outputLabels ?? [];
  return mark(Array.from({ length: total }, (_, i) => ({ id: `out-${i}`, label: labels[i] })));
}
