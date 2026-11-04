import type { ApiError, ApiResult } from '@/lib/api';

/*
 * Helpers for the MOCK apis (secrets, connections, files): they answer like the real api (async, ApiResult with
 * { code, message, fields }), so replacing a mock by its real module changes no screen.
 */

/** a short wait, like a request */
export const later = <T,>(value: T, ms = 120) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

export const ok = <T,>(value: T): ApiResult<T> => ({ ok: true, value });

export const failure = (code: string, message: string, fields?: Record<string, string>): ApiResult<never> => ({
  ok: false,
  error: (fields ? { code, message, fields } : { code, message }) as ApiError,
});

/** a validation failure from the fields' errors (undefined = valid); null when every field is valid */
export const fieldsFailure = (errors: Record<string, string | undefined>): ApiResult<never> | null => {
  const fields = Object.fromEntries(Object.entries(errors).filter(([, error]) => error !== undefined)) as Record<string, string>;
  if (Object.keys(fields).length === 0) {
    return null;
  }

  const conflict = Object.values(fields).includes('Already in use');
  return failure(conflict ? 'conflict' : 'validation', 'The request has invalid fields.', fields);
};

/** per project, created on first use (each mock seeds its own sample data) */
export function perProject<T>(seed: (projectId: string) => T[]) {
  const byProject = new Map<string, T[]>();
  return (projectId: string): T[] => {
    let items = byProject.get(projectId);
    if (!items) {
      items = seed(projectId);
      byProject.set(projectId, items);
    }

    return items;
  };
}
