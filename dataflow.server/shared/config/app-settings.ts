/*
 * The instance's configuration, read once from the environment (Bun loads dataflow.server/.env). Each environment (DEV,
 * STAGING, PROD...) is its own instance of the product, so these values say which one this process is.
 * Settings an environment manager changes at runtime (e.g. readonly) live in the `settings` table, not here.
 */

export type AppSettings = {
  /** Postgres connection; undefined = embedded PGlite in dataflow.server/data.local/, 'memory://' = PGlite in memory (tests) */
  databaseUrl?: string;
  /** name of this instance's environment, e.g. DEV, STAGING, PRODUCTION */
  environment: string;
  /** HTTP port of the api host */
  port: number;
  /** how many workers the supervisor starts = how many runs it executes at the same time (one worker = one run) */
  workers: number;
  /** which runs this supervisor takes for its workers (runs.worker_tag) */
  workerTags: string[];
  /** base URL of the next environment's instance, for promotions (push); undefined = this one promotes nowhere */
  promoteTo?: string;
};

export class AppSettingsError extends Error {
  override name = 'AppSettingsError';
}

function integer(name: string, value: string | undefined, fallback: number, min: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new AppSettingsError(`${name} must be an integer >= ${min} (got "${value}").`);
  }
  
  return n;
}

function list(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function url(name: string, value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    throw new AppSettingsError(`${name} is not a valid URL (got "${value}").`);
  }
}

/** Reads and validates the configuration. Throws AppSettingsError naming the variable that is wrong. */
export function readAppSettings(env: Record<string, string | undefined> = process.env): AppSettings {
  return {
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    environment: env.ENVIRONMENT?.trim() || 'DEV',
    port: integer('API_PORT', env.API_PORT, 5190, 1),
    workers: integer('WORKERS', env.WORKERS, 1, 1),
    workerTags: list(env.WORKER_TAGS, ['default']),
    promoteTo: url('PROMOTE_TO', env.PROMOTE_TO),
  };
}
