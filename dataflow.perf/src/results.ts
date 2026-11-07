import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineInfo } from '#perf/machine';
import type { RulerResult, Sample, ServiceName } from '#perf/scenario';
import { PACKAGE_ROOT } from '#perf/stack';

// TBD: auto increment?
export const SCHEMA_VERSION = 2;

export type ResultLine = {
    schemaVersion: number;
    at: string;
    partial: boolean;
    scenario: {
        id: string;
        description?: string;
        size: number;
        seed: number;
        dataVersion: number;
        services: ServiceName[];
        runs: number;
        quick: boolean;
    };
    git: { sha: string; dirty: boolean };
    machine: MachineInfo;
    images: Partial<Record<'mssql' | 'mongodb', string>>;
    warmup: Sample | null;
    samples: Sample[];
    rulers: RulerResult[];
};

export const RESULTS_DIR = join(PACKAGE_ROOT, 'results');

export function resultsPath(hostname: string, dir = RESULTS_DIR): string {
    const name =
        hostname
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'machine';
    return join(dir, `${name}.jsonl`);
}

export function appendResult(line: ResultLine, dir = RESULTS_DIR) {
    mkdirSync(dir, { recursive: true });
    appendFileSync(resultsPath(line.machine.hostname, dir), `${JSON.stringify(line)}\n`);
}

export function readResults(hostname: string, dir = RESULTS_DIR): ResultLine[] {
    const path = resultsPath(hostname, dir);
    if (!existsSync(path)) {
        return [];
    }

    return readFileSync(path, 'utf8')
        .split('\n')
        .flatMap(text => {
            if (!text.trim()) {
                return [];
            }

            try {
                const line = JSON.parse(text) as ResultLine;
                return line.scenario?.id ? [line] : [];
            } catch {
                return [];
            }
        });
}

export const historyOf = (lines: ResultLine[], scenarioId: string, size: number) =>
    lines.filter(l => !l.partial && l.scenario.id === scenarioId && l.scenario.size === size);

export function lastResult(hostname: string, scenarioId: string, size: number, dir = RESULTS_DIR): ResultLine | undefined {
    return historyOf(readResults(hostname, dir), scenarioId, size).at(-1);
}

export function latestPerScenario(lines: ResultLine[]): ResultLine[] {
    const latest = new Map<string, ResultLine>();
    for (const line of lines) {
        if (!line.partial) {
            latest.delete(line.scenario.id);
            latest.set(line.scenario.id, line);
        }
    }

    return [...latest.values()];
}
