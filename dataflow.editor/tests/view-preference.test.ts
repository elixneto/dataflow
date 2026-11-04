import { describe, expect, test } from 'bun:test';
import { readProjectView, saveProjectView, VIEW_KEY } from '../src/lib/view-preference';

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

describe('project view preference', () => {
  test('the last choice is the one read next time', () => {
    const storage = memoryStorage();

    expect(readProjectView(storage)).toBe('cards');
    saveProjectView('tree', storage);
    expect(readProjectView(storage)).toBe('tree');
    saveProjectView('cards', storage);
    expect(readProjectView(storage)).toBe('cards');
  });

  test('an unknown value or blocked storage gives the default', () => {
    const storage = memoryStorage();
    storage.setItem(VIEW_KEY, 'list');
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readProjectView(storage)).toBe('cards');
    expect(readProjectView(blocked)).toBe('cards');
    expect(() => saveProjectView('tree', blocked)).not.toThrow();
  });
});
