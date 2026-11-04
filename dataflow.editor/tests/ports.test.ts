import { describe, expect, test } from 'bun:test';
import { COMPONENTS, inputPorts, outputPorts } from '@dataflow/core';
import { componentInfo, paletteSections } from '../src/editor/catalog';

describe('component ports (from @dataflow/core)', () => {
  test('the palette offers exactly the core components (no Copy, no Union: any port takes several edges)', () => {
    const offered = paletteSections().flatMap(s => s.components.map(c => c.type));
    expect(offered.sort()).toEqual(Object.keys(COMPONENTS).sort());
    expect(offered).not.toContain('copy');
    expect(offered).not.toContain('union');
  });

  test("names come from the core; Lookup's inputs take one edge each", () => {
    expect(inputPorts('mapper')).toEqual([{ id: 'in-0' }]);
    expect(outputPorts('filter').map(p => p.label)).toEqual(['true', 'false']);
    expect(inputPorts('lookup')).toEqual([
      { id: 'in-0', label: 'input', single: true },
      { id: 'in-1', label: 'lookup', single: true },
    ]);
  });

  test('the router has its cases and the else', () => {
    expect(outputPorts('router').map(p => p.label)).toEqual(['else']);
    expect(outputPorts('router', { cases: [{}, {}] }).map(p => p.id)).toEqual(['out-0', 'out-1', 'out-2']);
  });

  test('Start: one output, End: one input; they are not in the palette', () => {
    expect([inputPorts('start'), outputPorts('start')]).toEqual([[], [{ id: 'out-0' }]]);
    expect([inputPorts('end'), outputPorts('end')]).toEqual([[{ id: 'in-0' }], []]);
    expect(componentInfo('start')?.label).toBe('Start');
    expect(paletteSections().flatMap(s => s.components.map(c => c.type))).not.toContain('end');
  });

  test('an unknown type has no ports', () => {
    expect(componentInfo('nope')).toBeUndefined();
    expect(inputPorts('nope')).toEqual([]);
  });
});
