/*
 * The keys that encrypt the secrets' values: AES-256-GCM, a new random 12-byte nonce on every write, and the secret's
 * id + name as additional data (a ciphertext copied to another secret does not decrypt). Several keys can be loaded
 * (SECRETS_KEYS="v1:<base64>,v2:<base64>"): the last one encrypts, any of them decrypts, so keys rotate without
 * re-encrypting everything at once. Values are only decrypted to run a flow, never to show them.
 */

/** bytes in a plain ArrayBuffer (what WebCrypto takes) */
export type Bytes = Uint8Array<ArrayBuffer>;

export type KeyEntry = { version: string; key: Bytes };

export type Encrypted = { keyVersion: string; nonce: Bytes; ciphertext: Bytes };

export class KeyringError extends Error {
  override name = 'KeyringError';
}

/** "v1:<base64 of 32 bytes>,v2:..." -> the keys; throws naming what is wrong */
export function parseKeys(text: string | undefined): KeyEntry[] {
  if (!text?.trim()) {
    return [];
  }

  return text.split(',').map(part => {
    const [version, base64] = part.trim().split(':');
    const key = base64 ? Uint8Array.from(Buffer.from(base64, 'base64')) : new Uint8Array();
    if (!version || key.length !== 32) {
      throw new KeyringError(`SECRETS_KEYS: "${version || part}" must be <version>:<base64 of 32 bytes>.`);
    }

    return { version, key };
  });
}

/**
 * DEV ONLY: a fixed key so a developer needs no setup. Anyone can read it here: an instance with real data must set
 * SECRETS_KEYS (the api refuses to start outside DEV without it).
 */
export const DEV_KEY: KeyEntry = { version: 'dev', key: new Uint8Array(32).fill(7) };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const additionalData = (id: string, name: string) => encoder.encode(`${id}\n${name}`);

export class Keyring {
  private readonly imported = new Map<string, Promise<CryptoKey>>();

  constructor(private readonly keys: KeyEntry[]) {}

  get currentVersion(): string | undefined {
    return this.keys.at(-1)?.version;
  }

  async encrypt(plaintext: string, id: string, name: string): Promise<Encrypted> {
    const current = this.keys.at(-1);
    if (!current) {
      throw new KeyringError('SECRETS_KEYS is not set: secrets cannot be stored.');
    }

    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: additionalData(id, name) },
      await this.cryptoKey(current),
      encoder.encode(plaintext),
    );
    return { keyVersion: current.version, nonce, ciphertext: new Uint8Array(ciphertext) };
  }

  async decrypt(value: Encrypted, id: string, name: string): Promise<string> {
    const entry = this.keys.find(k => k.version === value.keyVersion);
    if (!entry) {
      throw new KeyringError(`The key "${value.keyVersion}" of this secret is not in SECRETS_KEYS.`);
    }

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: value.nonce, additionalData: additionalData(id, name) },
      await this.cryptoKey(entry),
      value.ciphertext,
    );
    return decoder.decode(plaintext);
  }

  private cryptoKey(entry: KeyEntry): Promise<CryptoKey> {
    let key = this.imported.get(entry.version);
    if (!key) {
      key = crypto.subtle.importKey('raw', entry.key, 'AES-GCM', false, ['encrypt', 'decrypt']);
      this.imported.set(entry.version, key);
    }

    return key;
  }
}
