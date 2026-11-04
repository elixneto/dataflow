import { DEV_KEY, Keyring } from '../crypto/keyring';
import type { AppSettings } from './app-settings';

/**
 * The keyring of the secrets (the api encrypts, the supervisor decrypts): SECRETS_KEYS, or in DEV only a fixed key so
 * nobody needs setup to develop. Outside DEV without keys, it refuses to start.
 */
export function appKeyring(config: AppSettings, warn: (line: string) => void = console.warn): Keyring {
  if (config.secretsKeys.length === 0 && config.environment !== 'DEV') {
    throw new Error('SECRETS_KEYS is required outside DEV (see .env.example).');
  }

  if (config.secretsKeys.length === 0) {
    warn('SECRETS_KEYS is not set: using the DEV key. Never store real secrets this way.');
  }

  return new Keyring(config.secretsKeys.length > 0 ? config.secretsKeys : [DEV_KEY]);
}
