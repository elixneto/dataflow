import { ERROR_PORT, outputPorts } from '@dataflow/core';

/** a port's name in the run's Data tab: the core's (true, false, a Router's case), "error", or "output" for the unnamed one */
export const portLabel = (type: string, config: Record<string, unknown>, port: string) =>
  port === ERROR_PORT ? 'error' : (outputPorts(type, config).find(p => p.id === port)?.label ?? (port === 'out-0' ? 'output' : port));
