import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServiceName } from '#perf/scenario';

/*
 * The scenarios' services: the databases in their own compose project (docker-compose.perf.yml) and the fake API as a
 * local process. Checks Docker before anything starts, starts only what a scenario lists, and says how to fix what is
 * wrong (a PerfError, exit code 2). The constants here are the only place the ports, images and limits are written in
 * code; the compose file repeats them and tests/stack.test.ts checks that both agree.
 */

export const PACKAGE_ROOT = dirname(import.meta.dir);
export const COMPOSE_FILE = join(PACKAGE_ROOT, 'docker-compose.perf.yml');
export const COMPOSE_PROJECT = 'dataflow-perf';
export const PERF_PORTS = { mssql: 14330, mongodb: 27030, fakeApi: 5195, report: 5196 } as const;
export const SA_PASSWORD = 'Perf-Passw0rd!';
export const MONGO_URL = `mongodb://127.0.0.1:${PERF_PORTS.mongodb}`;
export const FAKE_API_URL = `http://127.0.0.1:${PERF_PORTS.fakeApi}`;
export const IMAGES = { mssql: 'mcr.microsoft.com/mssql/server:2022-CU16-ubuntu-22.04', mongodb: 'mongo:8.0.9' } as const;
export const SERVICE_LIMITS = {
    mssql: { cpus: 2, memoryBytes: 2560 * 1024 ** 2 },
    mongodb: { cpus: 1, memoryBytes: 1024 * 1024 ** 2 },
} as const;

export type DockerService = keyof typeof SERVICE_LIMITS;
export type DockerInfo = { memTotalBytes: number; arch: string; version: string };

/** a failure of the environment (Docker, ports, data load), not of the engine: exit code 2 */
export class PerfError extends Error {
    override name = 'PerfError';
}

export const dockerServices = (services: ServiceName[]): DockerService[] => services.filter((s): s is DockerService => s in SERVICE_LIMITS);

async function run(cmd: string[], inherit = false) {
    const child = Bun.spawn(cmd, {
        stdin: 'ignore',
        stdout: inherit ? 'inherit' : 'pipe',
        stderr: inherit ? 'inherit' : 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
        inherit ? '' : new Response(child.stdout as ReadableStream).text(),
        inherit ? '' : new Response(child.stderr as ReadableStream).text(),
        child.exited,
    ]);
    return { code, stdout, stderr };
}

export async function checkDocker(services: ServiceName[]): Promise<DockerInfo> {
    let result: Awaited<ReturnType<typeof run>>;
    try {
        result = await run(['docker', 'info', '--format', 'json']);
    } catch {
        throw new PerfError(
            'Docker is not installed (the `docker` command was not found). Install Docker Desktop, or run only the scenarios without databases (bun run perf --list).',
        );
    }

    const info = (() => {
        try {
            return JSON.parse(result.stdout) as {
                MemTotal?: number;
                Architecture?: string;
                ServerVersion?: string;
                ServerErrors?: string[];
            };
        } catch {
            return {};
        }
    })();
    if (result.code !== 0 || !info.ServerVersion) {
        throw new PerfError(
            `Docker is not answering: start Docker Desktop and try again.${info.ServerErrors?.length ? ` (${info.ServerErrors.join('; ')})` : ''}`,
        );
    }

    const needed = dockerServices(services).reduce((sum, s) => sum + SERVICE_LIMITS[s].memoryBytes, 0);
    const total = info.MemTotal ?? 0;
    if (needed > total) {
        const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
        throw new PerfError(
            `Docker has ${gb(total)} GB of memory and these scenarios need ${gb(needed)} GB: raise it in Docker Desktop (Settings → Resources), or on Windows in .wslconfig (memory=), then restart Docker.`,
        );
    }

    return { memTotalBytes: total, arch: info.Architecture ?? '', version: info.ServerVersion };
}

export async function ensureServices(services: ServiceName[]): Promise<void> {
    const wanted = dockerServices(services);
    if (wanted.length === 0) {
        return;
    }

    const { code } = await run(['docker', 'compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait', '--wait-timeout', '180', ...wanted], true);
    if (code !== 0) {
        throw new PerfError(
            `The services ${wanted.join(', ')} did not start (ports ${wanted.map(s => PERF_PORTS[s]).join(', ')} must be free). See \`docker compose -p ${COMPOSE_PROJECT} logs ${wanted.join(' ')}\`.`,
        );
    }
}

const answers = async (url: string) => {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
        return false;
    }
};

export async function startFakeApi(): Promise<{ stop(): void }> {
    if (await answers(`${FAKE_API_URL}/health`)) {
        throw new PerfError(
            `Something already answers on port ${PERF_PORTS.fakeApi} (a fake API left from an interrupted run?): stop it and try again.`,
        );
    }

    const script = join(PACKAGE_ROOT, 'fake-api', 'server.ts');
    if (!existsSync(script)) {
        throw new PerfError(`The fake API is missing (${script}).`);
    }

    const child = Bun.spawn([process.execPath, script], {
        env: { ...process.env, PORT: String(PERF_PORTS.fakeApi) },
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'inherit',
    });
    const stop = () => killTree(child.pid);
    for (let i = 0; i < 100; i++) {
        if (await answers(`${FAKE_API_URL}/health`)) {
            return { stop };
        }

        if (child.exitCode !== null) {
            break;
        }

        await Bun.sleep(100);
    }

    stop();
    throw new PerfError(`The fake API did not start on port ${PERF_PORTS.fakeApi}: is the port in use?`);
}

export function killTree(pid: number) {
    if (process.platform === 'win32') {
        Bun.spawnSync(['taskkill', '/pid', String(pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
    } else {
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            return;
        }
    }
}

export function warnIfEmulated(docker: DockerInfo | undefined, services: ServiceName[]) {
    if (docker && services.includes('mssql') && /^(aarch64|arm64)$/i.test(docker.arch)) {
        console.warn(
            'SQL Server has no ARM64 image: it runs emulated on this machine, slower, and its results do not compare with other machines.',
        );
    }
}
