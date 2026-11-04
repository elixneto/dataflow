import type { Context } from 'hono';

/** the JSON body, or undefined when it is missing or not JSON (the handler's validation then answers 400) */
export const jsonBody = (c: Context) => c.req.json<unknown>().catch(() => undefined);

/** the JSON body plus fields from the path (e.g. { id }); a body that is not an object goes as it came */
export async function bodyWith(c: Context, fields: Record<string, string>): Promise<unknown> {
  const body = await jsonBody(c);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? { ...body, ...fields } : body;
}
