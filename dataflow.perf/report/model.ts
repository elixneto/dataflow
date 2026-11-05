/*
 * What the report page knows about the results, apart from the DOM: the shape of a result line it reads (a subset of
 * src/results.ts; tests/model.test.ts checks they still fit), and the pure functions behind each view: the latest
 * execution of every scenario, a scenario's executions at one size, the change of a metric against a baseline, and
 * the comparison of several executions side by side.
 */

export type Direction = 'lower-is-better' | 'higher-is-better';

export type ReportComponent = {
  label: string;
  type: string;
  status: string;
  activeTimeMs?: number;
  waitingMs?: number;
  outputs: Record<string, number>;
  memory?: { peakEnvelopes: number; peakBytes: number };
  errors?: number;
  firstError?: string;
};

export type ReportSample = {
  iteration: number;
  warmup: boolean;
  record: { status: string; durationMs: number; error?: string; components: ReportComponent[] };
  memory: { startRssBytes: number; peakRssBytes: number; endRssBytes: number; samples: number };
  cpu: { cpuMs: number };
  fakeApi?: { requests: number; failures: number; p50Ms: number; p95Ms: number };
};

export type ReportRuler = { metric: string; direction: Direction; median?: number; min?: number; max?: number; previous?: number };

export type ReportLine = {
  schemaVersion: number;
  at: string;
  partial: boolean;
  scenario: { id: string; description?: string; size: number; seed: number; services: string[]; runs: number; quick: boolean };
  git: { sha: string; dirty: boolean };
  machine: { hostname: string; cpuModel: string; cores: number; totalMemBytes: number; platform: string; bunVersion: string; dockerVersion?: string };
  warmup: ReportSample | null;
  samples: ReportSample[];
  rulers: ReportRuler[];
};

export type Change = { ratio: number; text: string; kind: 'better' | 'worse' | 'same' };

/** a change smaller than this reads as no change */
export const SAME = 0.02;
/** a spread of the engine's time above this share of its median is noise */
export const NOISE_LIMIT = 0.1;

export function median(values: number[]): number | undefined {
  if (!values.length) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** every line that parses, oldest first */
export function parseResults(text: string): ReportLine[] {
  return text
    .split('\n')
    .flatMap(line => {
      if (!line.trim()) {
        return [];
      }

      try {
        const parsed = JSON.parse(line) as ReportLine;
        return parsed?.scenario?.id && parsed.at && Array.isArray(parsed.samples) ? [parsed] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

export const counted = (line: ReportLine) => line.samples.filter(s => s.record.status !== 'failed');

export const failedRuns = (line: ReportLine) => line.samples.length - counted(line).length;

export const shortCommit = (line: ReportLine) => `${line.git.sha.slice(0, 7)}${line.git.dirty ? '-dirty' : ''}`;

export const machines = (lines: ReportLine[]) => [...new Set(lines.map(l => l.machine.hostname))].sort();

export const metricValue = (line: ReportLine, metric: string) => line.rulers.find(r => r.metric === metric)?.median;

/** the change of `value` against `baseline`, read in the metric's direction */
export function changeOf(value: number | undefined, baseline: number | undefined, direction: Direction): Change | undefined {
  if (value === undefined || baseline === undefined || baseline === 0) {
    return undefined;
  }

  const ratio = (value - baseline) / Math.abs(baseline);
  const kind = Math.abs(ratio) < SAME ? 'same' : ratio < 0 === (direction === 'lower-is-better') ? 'better' : 'worse';
  return { ratio, text: `${ratio > 0 ? '+' : ''}${(ratio * 100).toFixed(1)} %`, kind };
}

/** (max − min) ÷ median of the engine's time over the counted runs */
export function noise(line: ReportLine): number | undefined {
  const times = counted(line).map(s => s.record.durationMs);
  const middle = median(times);
  return times.length < 2 || !middle ? undefined : (Math.max(...times) - Math.min(...times)) / middle;
}

/** a scenario's executions at one size, oldest first (partial ones included, flagged) */
export const executionsOf = (lines: ReportLine[], scenarioId: string, size: number) => lines.filter(l => l.scenario.id === scenarioId && l.scenario.size === size);

/** the sizes a scenario ran at, the most recently used first */
export function sizesOf(lines: ReportLine[], scenarioId: string): number[] {
  const sizes: number[] = [];
  for (const line of [...lines].reverse()) {
    if (line.scenario.id === scenarioId && !sizes.includes(line.scenario.size)) {
      sizes.push(line.scenario.size);
    }
  }

  return sizes;
}

export type ScenarioSummary = {
  id: string;
  description?: string;
  latest: ReportLine;
  previous?: ReportLine;
  executions: number;
  time?: number;
  change?: Change;
};

const engineTime = (line: ReportLine) => metricValue(line, 'durationMs') ?? median(counted(line).map(s => s.record.durationMs));

/** each scenario's latest complete execution, with the one before it at the same size, in the order first run */
export function summaries(lines: ReportLine[]): ScenarioSummary[] {
  const ids = [...new Set(lines.map(l => l.scenario.id))];
  return ids.flatMap(id => {
    const complete = lines.filter(l => l.scenario.id === id && !l.partial);
    const latest = complete.at(-1);
    if (!latest) {
      return [];
    }

    const previous = complete.filter(l => l.scenario.size === latest.scenario.size).at(-2);
    const time = engineTime(latest);
    const change = changeOf(time, previous ? engineTime(previous) : undefined, 'lower-is-better');
    const description = [...complete].reverse().find(l => l.scenario.description)?.scenario.description;
    const summary: ScenarioSummary = { id, latest, executions: lines.filter(l => l.scenario.id === id).length };
    return [{ ...summary, ...(description ? { description } : {}), ...(previous ? { previous } : {}), ...(time !== undefined ? { time } : {}), ...(change ? { change } : {}) }];
  });
}

export type MetricRow = { metric: string; direction: Direction; values: (number | undefined)[]; changes: (Change | undefined)[] };

/** every metric of the executions, side by side; each change is against the first execution (the baseline) */
export function compareMetrics(executions: ReportLine[]): MetricRow[] {
  const metrics: { metric: string; direction: Direction }[] = [];
  for (const line of executions) {
    for (const r of line.rulers) {
      if (!metrics.some(m => m.metric === r.metric)) {
        metrics.push({ metric: r.metric, direction: r.direction });
      }
    }
  }

  return metrics.map(({ metric, direction }) => {
    const values = executions.map(line => metricValue(line, metric));
    return { metric, direction, values, changes: values.map((v, i) => (i === 0 ? undefined : changeOf(v, values[0], direction))) };
  });
}

export type ComponentRow = { label: string; type: string; active: (number | undefined)[]; waiting: (number | undefined)[]; outputs: (number | undefined)[] };

/** each component's median active and waiting time and its envelopes out, per execution, the busiest last first */
export function compareComponents(executions: ReportLine[]): ComponentRow[] {
  const rows: ComponentRow[] = [];
  executions.forEach((line, i) => {
    const runs = counted(line);
    for (const c of runs[0]?.record.components ?? []) {
      let row = rows.find(r => r.label === c.label);
      if (!row) {
        row = { label: c.label, type: c.type, active: executions.map(() => undefined), waiting: executions.map(() => undefined), outputs: executions.map(() => undefined) };
        rows.push(row);
      }

      const of = (key: 'activeTimeMs' | 'waitingMs') => median(runs.map(s => s.record.components.find(x => x.label === c.label)?.[key]).filter((v): v is number => typeof v === 'number'));
      row.active[i] = of('activeTimeMs');
      row.waiting[i] = of('waitingMs');
      row.outputs[i] = Object.values(c.outputs).reduce((sum, n) => sum + n, 0);
    }
  });
  const busy = (row: ComponentRow) => (row.active.at(-1) ?? 0) + (row.waiting.at(-1) ?? 0);
  return rows.sort((a, b) => busy(b) - busy(a));
}

/** a metric over the complete executions, for the history chart */
export const seriesOf = (executions: ReportLine[], metric: string) =>
  executions.flatMap(line => {
    const value = metricValue(line, metric);
    return value === undefined || line.partial ? [] : [{ at: line.at, commit: shortCommit(line), value }];
  });

/** the default selection: the last two complete executions (or the only one) */
export const defaultSelection = (executions: ReportLine[]) =>
  executions
    .filter(l => !l.partial)
    .slice(-2)
    .map(l => l.at);
