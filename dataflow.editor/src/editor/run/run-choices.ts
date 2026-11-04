/** a choice kept in this browser tab (the panel's tab, the Data view): what was stored, if it is one of `allowed` */
export function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T, storage: Pick<Storage, 'getItem'> | undefined = globalThis.sessionStorage): T {
  try {
    const value = storage?.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function rememberChoice(key: string, value: string, storage: Pick<Storage, 'setItem'> | undefined = globalThis.sessionStorage) {
  try {
    storage?.setItem(key, value);
  } catch {
    // no storage: the default next time
  }
}
