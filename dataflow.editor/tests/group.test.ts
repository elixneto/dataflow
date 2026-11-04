import { describe, expect, test } from 'bun:test';
import { GROUP_Z, layerGroups } from '../src/editor/group';

describe('group layers', () => {
  test('a smaller group is above a bigger one, whatever the order they were made in; components untouched', () => {
    const small = { id: 's', type: 'group', width: 200, height: 100 };
    const big = { id: 'b', type: 'group', width: 800, height: 400 };
    const card = { id: 'c', type: 'component' };
    const z = Object.fromEntries(layerGroups([small, card, big]).map(n => [n.id, (n as { zIndex?: number }).zIndex]));

    expect(z.s).toBeGreaterThan(z.b!);
    expect(z.s).toBeLessThanOrEqual(GROUP_Z);
    expect(z.c).toBeUndefined();
  });
});
