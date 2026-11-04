import { describe, expect, test } from 'bun:test';
import { COMPONENTS } from '@dataflow/core';
import { paletteSections } from '../src/editor/catalog';
import { PALETTE_KEY, readPaletteOpen, savePaletteOpen } from '../src/lib/view-preference';

describe('components palette', () => {
  test('every core component is in the palette, once', () => {
    const types = paletteSections().flatMap(section => section.components.map(c => c.type));

    expect(types.sort()).toEqual(Object.keys(COMPONENTS).sort());
  });

  test('categories in order, components by label', () => {
    const sections = paletteSections();

    expect(sections.map(s => s.category)).toEqual(['database', 'api', 'code', 'transformation', 'flow']);
    expect(sections[0]!.components.map(c => c.label)).toEqual(['MongoDB Delete', 'MongoDB Pipeline', 'MongoDB Upsert', 'SQL Server Query']);
  });

  test('search by label or description, ignoring case; empty sections leave', () => {
    expect(paletteSections('mongo').map(s => s.components.map(c => c.label))).toEqual([['MongoDB Delete', 'MongoDB Pipeline', 'MongoDB Upsert']]);
    expect(paletteSections('BATCHES').flatMap(s => s.components.map(c => c.label))).toEqual(['Aggregate']);
    expect(paletteSections('nothing like this')).toEqual([]);
  });
});

describe('palette open preference', () => {
  test('starts open; the last choice is the one read next time', () => {
    const items = new Map<string, string>();
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };

    expect(readPaletteOpen(storage)).toBe(true);
    savePaletteOpen(false, storage);
    expect(items.get(PALETTE_KEY)).toBe('closed');
    expect(readPaletteOpen(storage)).toBe(false);
  });
});

describe('Discard', () => {
  test('is in the palette (flow category) and, with no output, is never dropped into an edge', async () => {
    const { componentInfo } = await import('../src/editor/catalog');
    const { canSplice } = await import('../src/editor/edge-splice');
    expect(componentInfo('discard')).toMatchObject({ label: 'Discard', category: 'flow' });
    expect(canSplice({ id: 'd', data: { type: 'discard', config: {} } }, [])).toBe(false);
    expect(canSplice({ id: 'm', data: { type: 'mapper', config: {} } }, [])).toBe(true);
  });
});
