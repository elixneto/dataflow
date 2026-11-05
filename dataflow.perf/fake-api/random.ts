/*
 * A small deterministic random generator: the same seed gives the same sequence on every machine. The fake API draws
 * each item's delay and failure from it, and the scenarios' data generators draw their rows from it (never Math.random).
 */

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a (32 bits) over the parts as text: one seed out of several values */
export function hashSeed(...parts: (number | string)[]): number {
  let hash = 0x811c9dc5;
  for (const char of parts.join('|')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
}
