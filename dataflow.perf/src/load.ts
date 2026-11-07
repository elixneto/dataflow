import sql from 'mssql';
import { MongoClient } from 'mongodb';
import type { LoadContext, Scenario } from '#perf/scenario';
import { FAKE_API_URL, MONGO_URL, PERF_PORTS, PerfError, SA_PASSWORD } from '#perf/stack';

/*
 * The scenarios' data, loaded by the orchestrator (never through the dataflow): opens what a scenario's load and reset
 * use, loads its source data once per scenario and seed at its largest size (the flows read the subset a run asks for
 * by parameter), and resets its targets before every run. A marker written last says what is loaded; a missing or
 * different marker means an interrupted or older load, and it loads again from scratch.
 */

const BULK_ROWS = 10_000;

const sqlConfig = (database: string): sql.config => ({
    server: '127.0.0.1',
    port: PERF_PORTS.mssql,
    user: 'sa',
    password: SA_PASSWORD,
    database,
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 300_000,
});

export type OpenLoadContext = LoadContext & { close(): Promise<void> };

export async function openLoadContext(scenario: Scenario, size: number, seed: number): Promise<OpenLoadContext> {
    const closers: (() => Promise<unknown>)[] = [];
    const ctx: OpenLoadContext = {
        size,
        seed,
        log: line => console.log(`  ${line}`),
        close: async () => {
            await Promise.all(closers.map(close => close().catch(() => undefined)));
        },
    };
    try {
        if (scenario.services.includes('mssql')) {
            const master = await new sql.ConnectionPool(sqlConfig('master')).connect();
            await master.request().query("IF DB_ID('perf') IS NULL CREATE DATABASE perf");
            await master.close();
            const pool = await new sql.ConnectionPool(sqlConfig('perf')).connect();
            closers.push(() => pool.close());
            ctx.sqlserver = {
                query: async (text, parameters = {}) => {
                    const request = pool.request();
                    for (const [name, value] of Object.entries(parameters)) {
                        request.input(name, value);
                    }

                    return ((await request.query(text)).recordset ?? []) as Record<string, unknown>[];
                },
                bulk: async (table, columns, rows) => {
                    for (let i = 0; i < rows.length; i += BULK_ROWS) {
                        const batch = new sql.Table(table);
                        batch.create = false;
                        for (const column of columns) {
                            batch.columns.add(column.name, column.type, { nullable: column.nullable ?? true });
                        }

                        for (const row of rows.slice(i, i + BULK_ROWS)) {
                            batch.rows.add(...(row as (string | number | boolean | Date | null)[]));
                        }

                        await pool.request().bulk(batch);
                    }
                },
            };
        }

        if (scenario.services.includes('mongodb')) {
            const client = await new MongoClient(MONGO_URL, { appName: 'dataflow-perf', serverSelectionTimeoutMS: 15_000 }).connect();
            closers.push(() => client.close());
            ctx.mongo = client.db('perf');
        }

        if (scenario.services.includes('fake-api')) {
            ctx.fakeApi = {
                reset: async () => void (await fetch(`${FAKE_API_URL}/_reset`, { method: 'POST' })),
                stats: async () =>
                    (await (await fetch(`${FAKE_API_URL}/_stats`)).json()) as Awaited<
                        ReturnType<NonNullable<LoadContext['fakeApi']>['stats']>
                    >,
            };
        }
    } catch (e) {
        await ctx.close();
        throw new PerfError(`Could not open the scenario's services: ${e instanceof Error ? e.message : String(e)}`);
    }

    return ctx;
}

export const dataMarker = (scenario: Scenario, size: number, seed: number) => `${scenario.dataVersion}:${seed}:${size}`;

const loaded = (marker: string | undefined, scenario: Scenario, size: number, seed: number) => {
    const [version, markedSeed, markedSize] = (marker ?? '').split(':');
    return version === String(scenario.dataVersion) && markedSeed === String(seed) && Number(markedSize) >= size;
};

type MarkerStore = { read(): Promise<string | undefined>; clear(): Promise<void>; write(marker: string): Promise<void> };

function markerStore(ctx: LoadContext, scenario: Scenario): MarkerStore | undefined {
    const sqlserver = ctx.sqlserver;
    if (sqlserver) {
        const ensure = () =>
            sqlserver.query(
                "IF OBJECT_ID('dbo._perf_meta') IS NULL CREATE TABLE dbo._perf_meta (scenario nvarchar(64) PRIMARY KEY, marker nvarchar(64), at datetime2)",
            );
        return {
            read: async () => {
                await ensure();
                return (await sqlserver.query('SELECT marker FROM dbo._perf_meta WHERE scenario = @id', { id: scenario.id }))[0]?.marker as
                    string | undefined;
            },
            clear: async () => void (await sqlserver.query('DELETE FROM dbo._perf_meta WHERE scenario = @id', { id: scenario.id })),
            write: async marker =>
                void (await sqlserver.query('INSERT INTO dbo._perf_meta (scenario, marker, at) VALUES (@id, @marker, SYSUTCDATETIME())', {
                    id: scenario.id,
                    marker,
                })),
        };
    }

    const mongo = ctx.mongo;
    if (mongo) {
        const meta = mongo.collection<{ _id: string; marker: string; at: Date }>('_perf_meta');
        return {
            read: async () => (await meta.findOne({ _id: scenario.id }))?.marker,
            clear: async () => void (await meta.deleteOne({ _id: scenario.id })),
            write: async marker => void (await meta.replaceOne({ _id: scenario.id }, { marker, at: new Date() }, { upsert: true })),
        };
    }

    return undefined;
}

export async function ensureData(ctx: LoadContext, scenario: Scenario, size: number, seed: number): Promise<void> {
    const store = markerStore(ctx, scenario);
    if (!store) {
        return;
    }

    const target = Math.max(size, scenario.size);
    if (loaded(await store.read(), scenario, target, seed)) {
        ctx.log('data matches, load skipped');
        return;
    }

    ctx.log(`loading ${target.toLocaleString('en-US')} rows of source data (once per seed and size)...`);
    const t0 = performance.now();
    await store.clear();
    ctx.size = target;
    try {
        await scenario.load(ctx);
    } catch (e) {
        throw new PerfError(`The data load of ${scenario.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
        ctx.size = size;
    }

    await store.write(dataMarker(scenario, target, seed));
    ctx.log(`loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

export async function resetTargets(ctx: LoadContext, scenario: Scenario): Promise<void> {
    await scenario.reset(ctx);
}
