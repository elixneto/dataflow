/*
 * Response headers that carry credentials (a session cookie, a token) never enter an envelope as they came: the
 * envelope goes to the run's record, the editor's samples and the next components. Their name stays, their value is
 * "***", so the flow still sees that the server sent them.
 */

/** what a response header's name says it carries: cookies, credentials, tokens, keys, sessions */
const SENSITIVE_HEADER = /cookie|auth|token|secret|session|api-?key|credential|password|signature/i;

export const RESPONSE_HEADER_MODES = ['safe', 'none', 'all'] as const;
export type ResponseHeaderMode = (typeof RESPONSE_HEADER_MODES)[number];

export const isSensitiveHeader = (name: string) => SENSITIVE_HEADER.test(name);

/** The response headers as the envelope gets them: credentials hidden (safe), none, or all as they came (unsafe). */
export function responseHeaders(headers: Record<string, string>, mode: ResponseHeaderMode = 'safe'): Record<string, string> {
  if (mode === 'none') return {};
  if (mode === 'all') return {...headers};
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, isSensitiveHeader(name) ? '***' : value]));
}
