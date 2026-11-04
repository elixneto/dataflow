/*
 * A live "Test connection" for one type: connect with the profile (its secrets decrypted only for this, in memory),
 * run the smallest query and close. It throws when the connection fails; the handler masks the secret values in the
 * message (safeMessage) before it leaves the server. Each driver loads on its first test, not when the server starts.
 */

export type ConnectionTestInput = { config: Record<string, string>; secrets: Record<string, string> };

export interface ConnectionTest {
  test(input: ConnectionTestInput): Promise<string>;
}

export const TEST_TIMEOUT_MS = 10_000;

/**
 * A driver's error as one line without any secret value (nor a URI's user:password), for the answer and logs.
 * Longer secrets first, so one that contains another is masked whole.
 */
export function safeMessage(error: unknown, secretValues: string[]): string {
  let message = error instanceof Error ? error.message : String(error);

  for (const value of [...secretValues].filter(v => v.length > 0).sort((a, b) => b.length - a.length)) {
    message = message.split(value).join('***');
  }

  return message.replace(/(\w+:\/\/)[^@\s/]+@/g, '$1***@').replace(/\s+/g, ' ').trim() || 'Could not connect.';
}
