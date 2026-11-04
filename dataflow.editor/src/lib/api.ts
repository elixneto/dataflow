import { mockUser } from '@/auth/mock-user';

/*
 * Calls to dataflow.server. In dev Vite proxies /api to it (vite.config.ts). Who is calling goes in X-Org-Id and
 * X-User-Id until there is authentication (then a token replaces both here, and nothing else changes).
 */

export type ApiError = {
  code: string;
  message: string;
  /** per field, for validation and conflict errors: { name: 'Already in use' } */
  fields?: Record<string, string>;
};

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

const UNAVAILABLE: ApiError = { code: 'unavailable', message: 'Server unavailable' };

/** a request to the api: the value, or the error the server answered ({ error: { code, message, fields } }) */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'x-org-id': mockUser.orgId,
        'x-user-id': mockUser.id,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    return { ok: true, value: body as T };
  }

  const error = (body as { error?: ApiError } | undefined)?.error;
  if (error?.code && error.message) {
    return { ok: false, error };
  }

  // the proxy answers 5xx without a body of ours when the server is down
  return { ok: false, error: response.status >= 500 ? UNAVAILABLE : { code: 'http', message: `Request failed (${response.status}).` } };
}
