import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS_DIR } from '#perf/results';
import { PACKAGE_ROOT, PERF_PORTS } from '#perf/stack';

export const REPORT_SOURCE = join(PACKAGE_ROOT, 'report');
export const REPORT_DIR = join(RESULTS_DIR, 'report');
const STATIC_FILES = ['index.html', 'style.css'];

export async function buildReport(dir = REPORT_DIR): Promise<string> {
    const result = await Bun.build({
        entrypoints: [join(REPORT_SOURCE, 'app.ts')],
        target: 'browser',
        format: 'iife',
        minify: false,
        sourcemap: 'none',
    });
    if (!result.success || !result.outputs[0]) {
        throw new Error(`The report page did not build: ${result.logs.map(String).join('\n')}`);
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'app.js'), await result.outputs[0].text());
    for (const file of STATIC_FILES) {
        copyFileSync(join(REPORT_SOURCE, file), join(dir, file));
    }

    rmSync(join(RESULTS_DIR, 'report.html'), { force: true });
    return join(dir, 'index.html');
}

export function allResults(dir = RESULTS_DIR): string {
    if (!existsSync(dir)) {
        return '';
    }

    return readdirSync(dir)
        .filter(name => name.endsWith('.jsonl'))
        .sort()
        .map(name => readFileSync(join(dir, name), 'utf8').trim())
        .filter(Boolean)
        .join('\n');
}

const TYPES: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
};

export async function serveReport(
    port: number = PERF_PORTS.report,
    dir = REPORT_DIR,
): Promise<{
    url: string;
    stop(): void;
}> {
    await buildReport(dir);
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port,
        fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === '/results.jsonl') {
                return new Response(allResults(), {
                    headers: {
                        'content-type': 'application/x-ndjson; charset=utf-8',
                        'cache-control': 'no-store',
                    },
                });
            }

            const file = path === '/' ? 'index.html' : path.slice(1);
            if (!['app.js', ...STATIC_FILES].includes(file)) {
                return new Response('Not found', { status: 404 });
            }

            return new Response(Bun.file(join(dir, file)), {
                headers: {
                    'content-type': TYPES[file.split('.').pop()!]!,
                    'cache-control': 'no-store',
                },
            });
        },
    });
    return { url: `http://127.0.0.1:${server.port}/`, stop: () => void server.stop(true) };
}
