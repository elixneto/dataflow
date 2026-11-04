import { describe, expect, test } from 'bun:test';
import { draftChanged, draftOf } from '../src/editor/component-draft';

describe("a component window's draft", () => {
  const data = { type: 'mapper', config: { fields: [{ target: 'a', value: '1' }] }, label: 'Prices' };

  test('starts as the node is (empty fields as text): nothing changed', () => {
    const draft = draftOf(data);
    expect(draft).toEqual({ label: 'Prices', outputKey: '', notes: '', config: data.config });
    expect(draftChanged(draft, data)).toBe(false);
  });

  test('a changed name, key, note or setting is a change; typing it back is not', () => {
    const draft = draftOf(data);
    expect(draftChanged({ ...draft, label: 'Prices 2' }, data)).toBe(true);
    expect(draftChanged({ ...draft, notes: 'x' }, data)).toBe(true);
    expect(draftChanged({ ...draft, outputKey: 'price' }, data)).toBe(true);
    expect(draftChanged({ ...draft, config: { fields: [{ target: 'b', value: '1' }] } }, data)).toBe(true);
    // a new config object with the same content is not a change
    expect(draftChanged({ ...draft, config: { fields: [{ target: 'a', value: '1' }] } }, data)).toBe(false);
  });
});
