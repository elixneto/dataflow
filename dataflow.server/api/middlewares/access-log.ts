import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { Logger } from '#shared/logging/logger';
import type { AppEnv } from '../app-env';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * One event per request: method, path, its route (the pattern, to group by: /flows/:id), status and time. A read that
 * went well is debug (the editor reads all the time, /health every few seconds); a write is info; a refusal (4xx) a
 * warning; a failure (5xx) an error.
 */
export const accessLog = (logger: Logger) => createMiddleware<AppEnv>(async (c, next) => {
  const t0 = performance.now();
  await next();
  const status = c.res.status;
  const fields = {
    method: c.req.method,
    path: c.req.path,
    route: routePath(c),
    statusCode: status,
    durationMs: Math.round((performance.now() - t0) * 10) / 10,
    orgId: c.req.header('x-org-id'),
    userId: c.req.header('x-user-id'),
  };
  const msg = `${c.req.method} ${c.req.path} ${status}`;
  if (status >= 500) {
    logger.error(msg, fields);
  } else if (status >= 400) {
    logger.warn(msg, fields);
  } else if (READS.has(c.req.method)) {
    logger.debug(msg, fields);
  } else {
    logger.info(msg, fields);
  }
});
