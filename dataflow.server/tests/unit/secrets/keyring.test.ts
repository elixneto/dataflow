import { describe, expect, test } from 'bun:test';
import { Keyring, KeyringError, parseKeys, type KeyEntry } from '#shared/crypto/keyring';

const key = (version: string, fill: number): KeyEntry => ({ version, key: new Uint8Array(32).fill(fill) });

describe('keyring', () => {
  test('encrypts with a new nonce each time and decrypts back', async () => {
    const keyring = new Keyring([key('v1', 1)]);
    const a = await keyring.encrypt('s3cr3t', 'id-1', 'db-password');
    const b = await keyring.encrypt('s3cr3t', 'id-1', 'db-password');

    expect(a.keyVersion).toBe('v1');
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(new TextDecoder().decode(a.ciphertext)).not.toContain('s3cr3t');
    expect(await keyring.decrypt(a, 'id-1', 'db-password')).toBe('s3cr3t');
  });

  test('a ciphertext does not decrypt under another secret (id + name are part of it)', async () => {
    const keyring = new Keyring([key('v1', 1)]);
    const encrypted = await keyring.encrypt('value', 'id-1', 'a');

    expect(keyring.decrypt(encrypted, 'id-2', 'a')).rejects.toThrow();
    expect(keyring.decrypt(encrypted, 'id-1', 'b')).rejects.toThrow();
  });

  test('the last key encrypts; older keys still decrypt (rotation)', async () => {
    const old = await new Keyring([key('v1', 1)]).encrypt('old', 'x', 'n');
    const rotated = new Keyring([key('v1', 1), key('v2', 2)]);

    expect((await rotated.encrypt('new', 'x', 'n')).keyVersion).toBe('v2');
    expect(await rotated.decrypt(old, 'x', 'n')).toBe('old');
    expect(new Keyring([key('v2', 2)]).decrypt(old, 'x', 'n')).rejects.toThrow(KeyringError);
  });

  test('SECRETS_KEYS: version:base64 of 32 bytes, comma separated', () => {
    const base64 = Buffer.alloc(32, 9).toString('base64');

    expect(parseKeys(`v1:${base64}, v2:${base64}`).map(k => k.version)).toEqual(['v1', 'v2']);
    expect(parseKeys('')).toEqual([]);
    expect(() => parseKeys('v1:c2hvcnQ=')).toThrow('base64 of 32 bytes');
  });

  test('no key: nothing can be stored', async () => {
    expect(new Keyring([]).encrypt('x', 'i', 'n')).rejects.toThrow('SECRETS_KEYS is not set');
  });
});
