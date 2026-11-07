import os from 'node:os';
import { PACKAGE_ROOT, SERVICE_LIMITS } from '#perf/stack';

export type MachineInfo = {
    hostname: string;
    cpuModel: string;
    cores: number;
    totalMemBytes: number;
    platform: string;
    release: string;
    bunVersion: string;
    dockerVersion?: string;
    limits: typeof SERVICE_LIMITS;
};

const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: PACKAGE_ROOT, stdout: 'pipe', stderr: 'ignore' });
    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
};

export function gitInfo(): { sha: string; dirty: boolean } {
    return { sha: git('rev-parse', 'HEAD') ?? 'unknown', dirty: (git('status', '--porcelain') ?? '') !== '' };
}

export function machineInfo(docker?: { version: string }): MachineInfo {
    const cpus = os.cpus();
    return {
        hostname: os.hostname(),
        cpuModel: cpus[0]?.model.trim() ?? 'unknown',
        cores: cpus.length,
        totalMemBytes: os.totalmem(),
        platform: os.platform(),
        release: os.release(),
        bunVersion: Bun.version,
        ...(docker ? { dockerVersion: docker.version } : {}),
        limits: SERVICE_LIMITS,
    };
}
