import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { RestOAuth2ConnectionTest } from '#features/connections/test-connection/rest-oauth2-connection-test';
import { LIVE_TESTS, testProfile, untestedMessage } from '#features/connections/test-connection/test-profile';
import { ProjectRepository } from '#features/projects/project-repository';
import { openDatabase, type Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';

setDefaultTimeout(30_000);

/** Test connection of a REST OAuth 2.0 profile: a real token from a local provider; the other API types say why not. */
describe('Test connection: REST OAuth 2.0 and the API types', () => {
  let provider: ReturnType<typeof Bun.serve>;
  let db: Database;
  let ctx: UseCaseContext;
  let projectId: string;
  const asked: URLSearchParams[] = [];

  beforeAll(async () => {
    provider = Bun.serve({
      port: 0,
      async fetch(request) {
        const form = new URLSearchParams(await request.text());
        asked.push(form);
        return form.get('client_secret') === 'right-s3cret'
          ? Response.json({ access_token: 'tok-from-test', expires_in: 1800 })
          : Response.json({ error: 'invalid_client', error_description: `Bad secret ${form.get('client_secret')}` }, { status: 401 });
      },
    });
    db = await openDatabase('memory://');
    ctx = { orgId: crypto.randomUUID(), userId: 'ana', db };
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [ctx.orgId, 'org']);
    projectId = (await new ProjectRepository(db, ctx.orgId).insert({ id: crypto.randomUUID(), name: 'P', description: '' })).id;
  });

  afterAll(() => provider.stop(true));

  const config = (extra: Record<string, string> = {}) => ({ grant: 'clientCredentials', tokenUrl: `http://localhost:${provider.port}/token`, clientId: 'app', clientSecret: 'CS', ...extra });

  test('the provider gives a token: what it got and for how long; the token itself is not shown', async () => {
    const result = await testProfile(ctx, LIVE_TESTS, projectId, { type: 'rest-oauth2', config: config({ scopes: 'read' }) }, [{ name: 'CS', value: 'right-s3cret' }]);
    expect(result).toMatchObject({ ok: true, value: { message: `Got a token from http://localhost:${provider.port}/token, valid for 30 min.` } });
    expect(JSON.stringify(result)).not.toContain('tok-from-test');
    expect(asked.at(-1)?.get('grant_type')).toBe('client_credentials');
    expect(asked.at(-1)?.get('scope')).toBe('read');
  });

  test("the provider refuses: its reason (invalid_client), the secret's value masked", async () => {
    const result = await testProfile(ctx, LIVE_TESTS, projectId, { type: 'rest-oauth2', config: config() }, [{ name: 'CS', value: 'wrong-s3cret' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unavailable');
      expect(result.error.message).toContain('(HTTP 401): invalid_client: Bad secret ***');
      expect(result.error.message).not.toContain('wrong-s3cret');
    }
  });

  test('a token URL that does not answer fails (does not hang)', async () => {
    const tester = new RestOAuth2ConnectionTest(undefined, 2_000);
    await expect(tester.test({ config: config({ tokenUrl: 'http://127.0.0.1:1/token' }), secrets: { clientSecret: 'x' } })).rejects.toThrow('Could not reach the server');
  });

  test('the authorization code grant cannot be tested yet', async () => {
    await expect(new RestOAuth2ConnectionTest().test({ config: config({ grant: 'authorizationCode' }), secrets: { clientSecret: 'x' } })).rejects.toThrow('cannot be tested yet (soon)');
  });

  test('REST Basic and HTTP Client have nothing to call; other types wait for their component', async () => {
    const basic = await testProfile(ctx, LIVE_TESTS, projectId, { type: 'rest-basic', config: { user: 'u', password: 'PW' } }, [{ name: 'PW', value: 'p' }]);
    expect(basic).toMatchObject({ ok: true, value: { message: 'Complete. Nothing to call yet: the HTTP Request that uses it sets the URL.' } });
    expect(untestedMessage('http-client')).toBe('Complete. Nothing to call yet: the HTTP Request that uses it sets the URL.');
    expect(untestedMessage('postgresql')).toBe("Complete. A live test comes with this connection's component.");
  });
});
