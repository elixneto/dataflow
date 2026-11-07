import { mulberry32 } from '#fake-api/random';

export const DATA_VERSION = 1;
export type Sale = { id: number; name: string; amount: number; category: 'a' | 'b'; createdAt: string };

export function sales(size: number, seed: number): Sale[] {
    const random = mulberry32(seed);
    const year = Date.UTC(2025, 0, 1);
    return Array.from({ length: size }, (_, i) => ({
        id: i + 1,
        name: `sale ${i + 1}`,
        amount: Math.round((random() * 1000 - 50) * 100) / 100,
        category: random() < 0.5 ? 'a' : 'b',
        createdAt: new Date(year + Math.floor(random() * 365 * 86_400_000)).toISOString(),
    }));
}
