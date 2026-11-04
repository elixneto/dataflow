import { describe, expect, test } from 'bun:test';
import { COMPONENTS } from '@dataflow/core';
import { componentInfo, paletteSections } from '../src/editor/catalog';
import { inputPorts, outputPorts } from '../src/editor/ports';

describe('component ports (from @dataflow/core)', () => {
  test('the palette offers exactly the core components', () => {
    const offered = paletteSections().flatMap(s => s.components.map(c => c.type));
    expect(offered.sort()).toEqual(Object.keys(COMPONENTS).sort());
  });

  test('fixed ports, with their names', () => {
    expect(inputPorts('mapper')).toEqual([{ id: 'in-0', label: undefined }]);
    expect(outputPorts('filter').map(p => p.label)).toEqual(['true', 'false']);
    expect(inputPorts('lookup').map(p => p.label)).toEqual(['input', 'lookup']);
  });

  test('chosen port counts stay within the limits; the router has its cases and the else', () => {
    const union = COMPONENTS.union!.variableInputs!;
    expect(inputPorts('union')).toHaveLength(union.min);
    expect(inputPorts('union', { [union.key]: 1000 })).toHaveLength(union.max);
    expect(outputPorts('router').map(p => p.label)).toEqual(['else']);
    expect(outputPorts('router', { cases: [{}, {}] }).map(p => p.id)).toEqual(['out-0', 'out-1', 'out-2']);
  });

  test('an unknown type has no ports', () => {
    expect(componentInfo('nope')).toBeUndefined();
    expect(inputPorts('nope')).toEqual([]);
  });
});
