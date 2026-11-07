import { mulberry32 } from '#fake-api/random';

export const DATA_VERSION = 1;

export function* customers(size: number, seed: number): Generator<[number, string, string, number, Date]> {
    const random = mulberry32(seed);
    const start = Date.UTC(2015, 0, 1);
    for (let id = 1; id <= size; id++) {
        yield [
            id,
            `customer ${id}`,
            `customer${id}@example.com`,
            Math.round(random() * 10_000_000) / 100,
            new Date(start + Math.floor(random() * 10 * 365 * 86_400_000)),
        ];
    }
}
