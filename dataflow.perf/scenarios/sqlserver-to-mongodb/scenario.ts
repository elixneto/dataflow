import sql from 'mssql';
import type { Scenario } from '#perf/scenario';
import { customers, DATA_VERSION } from './data';

const scenario: Scenario = {
    id: 'sqlserver-to-mongodb',
    description:
        'SQL Server Query (streamed, with backpressure) → Mapper → MongoDB Upsert (batches of 500): a SQL source into a Mongo target.',
    services: ['mssql', 'mongodb'],
    size: 50_000,
    quickSize: 5_000,
    seed: 1,
    timeoutMs: 300_000,
    dataVersion: DATA_VERSION,
    throughputNode: 'SQL Server Query',
    rulers: [
        { metric: 'durationMs', direction: 'lower-is-better' },
        { metric: 'envelopesPerSecond', direction: 'higher-is-better' },
        { metric: 'memoryDeltaBytes', direction: 'lower-is-better' },
        { metric: 'component.SQL Server Query.waitingMs', direction: 'lower-is-better' },
        { metric: 'component.MongoDB Upsert.waitingMs', direction: 'lower-is-better' },
    ],
    load: async ctx => {
        await ctx.sqlserver!.query('DROP TABLE IF EXISTS dbo.Customer');
        await ctx.sqlserver!.query(
            'CREATE TABLE dbo.Customer (id int PRIMARY KEY, name nvarchar(80), email nvarchar(120), balance decimal(12,2), since datetime2)',
        );
        await ctx.sqlserver!.bulk(
            'dbo.Customer',
            [
                { name: 'id', type: sql.Int, nullable: false },
                { name: 'name', type: sql.NVarChar(80) },
                { name: 'email', type: sql.NVarChar(120) },
                { name: 'balance', type: sql.Decimal(12, 2) },
                { name: 'since', type: sql.DateTime2 },
            ],
            [...customers(ctx.size, ctx.seed)],
        );
    },
    reset: async ctx => {
        const target = ctx.mongo!.collection('customers');
        await target.deleteMany({});
        await target.createIndex({ id: 1 }, { unique: true }, undefined);
    },
};

export default scenario;
