import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ensureData, openLoadContext, resetTargets, type OpenLoadContext } from '#perf/load';
import { gitInfo, machineInfo } from '#perf/machine';
import { currentChild, measureOnce } from '#perf/measure';
import { printPlan, printRun, printScenario, printSummary } from '#perf/report';
import { buildReport, serveReport } from '#perf/report-site';
import { appendResult, lastResult, SCHEMA_VERSION, type ResultLine } from '#perf/results';
import type { Sample, Scenario } from '#perf/scenario';
import { SCENARIOS, scenarioById } from '#perf/scenarios';
import { checkDocker, dockerServices, ensureServices, IMAGES, killTree, PERF_PORTS, PerfError, startFakeApi, warnIfEmulated, type DockerInfo } from '#perf/stack';
import { summarize } from '#perf/stats';

const USAGE = 'usage: bun run perf [scenario...] [--runs N] [--quick] [--size N] [--list] [--serve] [--open]';

const stop = (message: string): never => {
    console.error(message);
    process.exit(2);
};

const parsed = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            options: {
                runs: { type: 'string' },
                quick: { type: 'boolean' },
                size: { type: 'string' },
                list: { type: 'boolean' },
                serve: { type: 'boolean' },
                open: { type: 'boolean' },
            },
            allowPositionals: true,
            strict: true,
        });
    } catch (e) {
        return stop(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    }
})();

const positive = (name: string, text: string | undefined) => {
    if (text === undefined) {
        return undefined;
    }

    const value = Number(text);
    return Number.isInteger(value) && value > 0 ? value : stop(`--${name} takes a whole number above 0 (got "${text}").\n${USAGE}`);
};

const options = {
    runs: positive('runs', parsed.values.runs),
    size: positive('size', parsed.values.size),
    quick: parsed.values.quick === true,
};

if (parsed.values.list) {
    for (const s of SCENARIOS) {
        console.log(
            `${s.id}\n  ${s.description}\n  services: ${s.services.join(', ') || 'none'} · size ${s.size.toLocaleString('en-US')} (quick ${s.quickSize.toLocaleString('en-US')})\n  rulers: ${s.rulers.map(r => r.metric).join(', ')}`,
        );
    }

    process.exit(0);
}

const unknown = parsed.positionals.filter(id => !scenarioById(id));
if (unknown.length) {
    stop(`Unknown scenario: ${unknown.join(', ')}. The scenarios are: ${SCENARIOS.map(s => s.id).join(', ')}.`);
}

const selected = parsed.positionals.length ? parsed.positionals.map(id => scenarioById(id)!) : SCENARIOS;

async function serve(focus?: string): Promise<never> {
    let site: Awaited<ReturnType<typeof serveReport>>;
    try {
        site = await serveReport();
    } catch (e) {
        return stop(
            `The report could not be served on port ${PERF_PORTS.report} (${e instanceof Error ? e.message : String(e)}): is it already running?`,
        );
    }

    const url = focus ? `${site.url}#/s/${encodeURIComponent(focus)}` : site.url;
    console.log(`\nReport: ${url}  (Ctrl+C to stop)`);
    if (parsed.values.open) {
        const opener =
            process.platform === 'win32'
                ? ['cmd', '/c', 'start', '', url]
                : process.platform === 'darwin'
                  ? ['open', url]
                  : ['xdg-open', url];
        Bun.spawn(opener, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    }

    const close = () => {
        site.stop();
        process.exit(0);
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
        process.removeAllListeners(signal);
        process.on(signal, close);
    }

    return new Promise<never>(() => undefined);
}

if (parsed.values.serve) {
    await serve(parsed.positionals.length === 1 ? parsed.positionals[0] : undefined);
}

type Current = {
    scenario: Scenario;
    size: number;
    runs: number;
    warmup: Sample | null;
    samples: Sample[];
    fakeApi?: { stop(): void };
};

let current: Current | undefined;
let exitCode = 0;
const lines: ResultLine[] = [];
const notRun: string[] = [];
const git = gitInfo();

const needsDocker = selected.flatMap(s => dockerServices(s.services));
let docker: DockerInfo | undefined;
let dockerProblem: string | undefined;
if (needsDocker.length) {
    try {
        docker = await checkDocker([...new Set(needsDocker)]);
    } catch (e) {
        dockerProblem = e instanceof Error ? e.message : String(e);
    }
}

const machine = machineInfo(docker);

function resultLine(state: Current, partial: boolean): ResultLine {
    const counted = state.samples.filter(s => s.record.status !== 'failed');
    const previous = lastResult(machine.hostname, state.scenario.id, state.size);
    return {
        schemaVersion: SCHEMA_VERSION,
        at: new Date().toISOString(),
        partial,
        scenario: {
            id: state.scenario.id,
            description: state.scenario.description,
            size: state.size,
            seed: state.scenario.seed,
            dataVersion: state.scenario.dataVersion,
            services: state.scenario.services,
            runs: state.runs,
            quick: options.quick,
        },
        git,
        machine,
        images: Object.fromEntries(dockerServices(state.scenario.services).map(s => [s, IMAGES[s]])),
        warmup: state.warmup,
        samples: state.samples,
        rulers: summarize(state.scenario.rulers, counted, state.scenario, previous?.rulers),
    };
}

let interrupted = false;
const interrupt = () => {
    if (interrupted) {
        return;
    }

    interrupted = true;
    if (currentChild) {
        killTree(currentChild.pid);
    }

    current?.fakeApi?.stop();
    if (current) {
        appendResult(resultLine(current, true));
        console.log(
            `\nInterrupted: ${current.samples.length} measured run(s) of ${current.scenario.id} saved as a partial result. The containers keep running.`,
        );
    }

    process.exit(130);
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
process.on('SIGBREAK', interrupt);

for (const scenario of selected) {
    const t0 = performance.now();
    const size = options.size ?? (options.quick ? scenario.quickSize : scenario.size);
    const runs = options.runs ?? (options.quick ? 2 : (scenario.runs ?? 5));
    const warmup = !options.quick;
    const state: Current = { scenario, size, runs, warmup: null, samples: [] };
    current = state;
    let ctx: OpenLoadContext | undefined;
    try {
        printPlan(
            scenario,
            {
                runs,
                quick: options.quick,
                size,
                warmup,
            },
            lastResult(machine.hostname, scenario.id, size)?.rulers,
        );
        if (dockerServices(scenario.services).length && dockerProblem) {
            throw new PerfError(dockerProblem);
        }

        warnIfEmulated(docker, scenario.services);
        await ensureServices(scenario.services);
        if (scenario.services.includes('fake-api')) {
            state.fakeApi = await startFakeApi();
        }

        ctx = await openLoadContext(scenario, size, scenario.seed);
        await ensureData(ctx, scenario, size, scenario.seed);
        for (let iteration = warmup ? 0 : 1; iteration <= runs; iteration++) {
            await resetTargets(ctx, scenario);
            const sample = await measureOnce(
                scenario,
                {
                    size,
                    seed: scenario.seed,
                    iteration,
                    warmup: iteration === 0,
                },
                ctx,
            );
            if (sample.warmup) {
                state.warmup = sample;
            } else {
                state.samples.push(sample);
            }

            printRun(sample, runs);
        }

        const line = resultLine(state, false);
        appendResult(line);
        lines.push(line);
        printScenario(line, performance.now() - t0);
        if (line.samples.some(s => s.record.status === 'failed')) {
            exitCode = Math.max(exitCode, 1);
        }
    } catch (e) {
        if (!(e instanceof PerfError)) {
            throw e;
        }

        console.error(`  ${e.message}`);
        notRun.push(scenario.id);
        exitCode = 2;
    } finally {
        await ctx?.close();
        state.fakeApi?.stop();
        current = undefined;
    }
}

printSummary(lines, notRun);
if (lines.length) {
    const page = await buildReport();
    if (parsed.values.open) {
        await serve(lines.length === 1 ? lines[0]!.scenario.id : undefined);
    }

    console.log(`\nReport: bun run perf --serve --open   (or open ${pathToFileURL(page).href} and pick the .jsonl)`);
}

process.exit(exitCode);
