import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flowFromYaml, toExecutableFlow, type ConnectionProfileData, type ExecutableFlow, type FlowFile } from '@dataflow/core';
import { MONGO_URL, PACKAGE_ROOT, PERF_PORTS, SA_PASSWORD } from '#perf/stack';

/*
 * A scenario's flows, read from its YAML files by the core's own functions (so a change to the flow format breaks the
 * scenarios' test, not a perf run months later), and the connection profiles and secrets they use: fixed ids that
 * point at the perf containers.
 */

export const PERF_SECRETS: Record<string, string> = { PERF_SA_PASSWORD: SA_PASSWORD, PERF_MONGO_URL: MONGO_URL };

export const PERF_CONNECTIONS: Record<string, ConnectionProfileData> = {
  'perf-sqlserver': {
    name: 'perf SQL Server',
    type: 'sqlserver',
    config: { host: '127.0.0.1', port: String(PERF_PORTS.mssql), database: 'perf', user: 'sa', password: 'PERF_SA_PASSWORD', encrypt: 'off', trustServerCertificate: 'on' },
  },
  'perf-mongodb': { name: 'perf MongoDB', type: 'mongodb', config: { connectionString: 'PERF_MONGO_URL', database: 'perf' } },
};

export type ScenarioFlowFile = { path: string; text: string; file: FlowFile };

export const flowsDir = (scenarioId: string) => join(PACKAGE_ROOT, 'scenarios', scenarioId, 'flows');

export function loadFlowFiles(scenarioId: string): ScenarioFlowFile[] {
  const dir = flowsDir(scenarioId);
  return readdirSync(dir)
    .filter(name => name.endsWith('.yaml'))
    .sort()
    .map(name => {
      const path = join(dir, name);
      const text = readFileSync(path, 'utf8');
      const result = flowFromYaml(text);
      if (!result.ok) {
        throw new Error(`${path}: ${result.errors.join(' ')}`);
      }

      if (!result.value.id) {
        throw new Error(`${path}: the flow has no id (a scenario's flows need fixed ids).`);
      }

      return { path, text, file: result.value };
    });
}

export function executableFlows(files: ScenarioFlowFile[], scenarioId: string): { main: ExecutableFlow; flows: Record<string, ExecutableFlow> } {
  const flows = Object.fromEntries(files.map(f => [f.file.id!, toExecutableFlow(f.file, 'perf')]));
  const main = flows[scenarioId];
  if (!main) {
    throw new Error(`The scenario ${scenarioId} has no flow with the id "${scenarioId}".`);
  }

  return { main, flows };
}
