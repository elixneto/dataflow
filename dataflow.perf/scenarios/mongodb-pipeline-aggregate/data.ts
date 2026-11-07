import { mulberry32 } from '#fake-api/random';

export const DATA_VERSION = 1;
export type Order = {
    orderId: number;
    customerId: number;
    status: 'paid' | 'cancelled';
    total: number;
    items: { sku: string; qty: number }[];
    placedAt: Date;
};

export function* orders(size: number, seed: number): Generator<Order> {
    const random = mulberry32(seed);
    const customers = Math.max(1, Math.floor(size / 20));
    const year = Date.UTC(2025, 0, 1);
    for (let orderId = 1; orderId <= size; orderId++) {
        const items = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
            sku: `sku-${Math.floor(random() * 500)}`,
            qty: 1 + Math.floor(random() * 5),
        }));
        yield {
            orderId,
            customerId: 1 + Math.floor(random() * customers),
            status: random() < 0.1 ? 'cancelled' : 'paid',
            total: Math.round(random() * 100_000) / 100,
            items,
            placedAt: new Date(year + Math.floor(random() * 365 * 86_400_000)),
        };
    }
}
