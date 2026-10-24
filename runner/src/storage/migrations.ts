import type {Database} from './database';

/*
 * The schema, one step at a time. A step is never edited after it is committed: a change becomes a new step at the
 * end. `schema_migrations` records the steps already applied, each in its own transaction.
 */

const STEPS: string[] = [
  // 1: projects, flows and runs
  `
  CREATE TABLE projects (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    -- empty folders created by hand, as paths ("Sales/Invoices")
    folders jsonb NOT NULL DEFAULT '[]',
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE flows (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    folder text NOT NULL DEFAULT '',
    name text NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    version integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- the lean flow definition, as the editor saves and downloads it
    definition jsonb NOT NULL
  );
  CREATE INDEX flows_project ON flows (project_id);

  CREATE TABLE runs (
    id text PRIMARY KEY,
    project_id text,
    workflow_id text,
    mode text NOT NULL,
    status text NOT NULL,
    started_at timestamptz NOT NULL,
    duration_ms integer NOT NULL,
    -- the full run record (with the per-component detail)
    record jsonb NOT NULL
  );
  CREATE INDEX runs_project_started ON runs (project_id, started_at DESC);

  INSERT INTO projects (id, name, description) VALUES ('examples', 'Examples', 'An example flow for each component.');
  `,
];

export async function migrate(db: Database) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await db.query<{version: number}>('SELECT version FROM schema_migrations')).map(r => r.version));
  for (const [index, step] of STEPS.entries()) {
    const version = index + 1;
    if (applied.has(version)) continue;
    await db.transaction(async tx => {
      await tx.exec(step);
      await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
  }
}
