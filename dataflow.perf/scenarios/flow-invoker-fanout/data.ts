import { mulberry32 } from '#fake-api/random';

export const DATA_VERSION = 1;

export function amounts(size: number, seed: number): { id: number; amount: number }[] {
    const random = mulberry32(seed);
    return Array.from({ length: size }, (_, i) => ({ id: i + 1, amount: Math.round(random() * 100_000) / 100 }));
}
