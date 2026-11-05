import { oauthToken, type SendHttp } from '@dataflow/core';
import { sendHttp } from '#shared/runner/send-http';
import type { ConnectionTest, ConnectionTestInput, ConnectionTestResult } from './connection-test';

/** how long the provider has to answer the token request */
export const OAUTH_TEST_TIMEOUT_MS = 15_000;

/**
 * REST OAuth 2.0: a real token asked from the token URL with the client credentials (as a run asks it), then thrown
 * away (not kept for the runs: the test runs in the API, the runs' tokens live in the supervisor). A refusal says the
 * provider's reason (invalid_client...). The authorization code grant cannot be tested yet (it needs a person to log in).
 */
export class RestOAuth2ConnectionTest implements ConnectionTest {
  constructor(
    private readonly http: SendHttp = sendHttp,
    private readonly timeoutMs = OAUTH_TEST_TIMEOUT_MS,
  ) {}

  async test({ config, secrets }: ConnectionTestInput): Promise<ConnectionTestResult> {
    if (config.grant === 'authorizationCode') {
      throw new Error('An OAuth 2.0 connection with the authorization code grant cannot be tested yet (soon); use client credentials.');
    }

    const now = Date.now();
    const signal = new AbortController().signal;
    const token = await oauthToken({ type: 'rest-oauth2', config, secrets }, request => this.http({ ...request, timeoutMs: this.timeoutMs, signal }), now);
    const minutes = Math.max(0, Math.round((token.expiresAt - now) / 60_000));
    return { message: `Got a token from ${config.tokenUrl}, valid for ${minutes} min.` };
  }
}
