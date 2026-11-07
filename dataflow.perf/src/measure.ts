import { join } from 'node:path';
import type { Subprocess } from 'bun';
import type { LoadContext, Sample, Scenario } from '#perf/scenario';
import { killTree, PACKAGE_ROOT, PerfError } from '#perf/stack';

const KILL_MARGIN_MS = 30_000;

export let currentChild: Subprocess | undefined;

export async function measureOnce(
    scenario: Scenario,
    run: { size: number; seed: number; iteration: number; warmup: boolean },
    ctx: LoadContext,
): Promise<Sample> {
    const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'run-once.ts'), scenario.id, String(run.size), String(run.seed), String(run.iteration)],
        {
            cwd: PACKAGE_ROOT,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'inherit',
        },
    );
    currentChild = child;
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
    }, scenario.timeoutMs + KILL_MARGIN_MS);
    try {
        const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        if (timedOut) {
            throw new PerfError(
                `Run ${run.iteration} of ${scenario.id} passed ${Math.round((scenario.timeoutMs + KILL_MARGIN_MS) / 1000)} s and was killed.`,
            );
        }

        if (code !== 0) {
            throw new PerfError(`The measuring process of ${scenario.id} broke (exit code ${code}); its error is above.`);
        }

        const line = text.trim().split('\n').pop() ?? '';
        const sample = { ...(JSON.parse(line) as Omit<Sample, 'warmup'>), warmup: run.warmup } as Sample;
        if (ctx.fakeApi) {
            sample.fakeApi = await ctx.fakeApi.stats();
        }

        return sample;
    } finally {
        clearTimeout(timer);
        currentChild = undefined;
    }
}
