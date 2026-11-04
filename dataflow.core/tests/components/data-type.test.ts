import {expect, test} from 'bun:test';
import {dataTypeFromSamples, scriptGlobals} from '../../src/index';

test('the type of what reached a component: primitives, nested objects, arrays of objects', () => {
  expect(dataTypeFromSamples([])).toBe('Record<string, unknown>');
  expect(dataTypeFromSamples([{id: 1, name: 'a', ok: true, none: null}])).toBe('{ id: number; name: string; ok: boolean; none: null }');
  expect(dataTypeFromSamples([{response: {status: 200, body: {data: [{ID: 'x', percent: 10}, {ID: 'y', percent: 20, late: true}]}}}]))
    .toBe('{ response: { status: number; body: { data: { ID: string; percent: number; late?: boolean }[] } } }');
  expect(dataTypeFromSamples([{tags: []}])).toBe('{ tags: unknown[] }');
});

test('a field seen with several types gets the union; one missing in some envelopes is optional; odd keys are quoted', () => {
  expect(dataTypeFromSamples([{v: 1}, {v: 'one'}, {v: null}])).toBe('{ v: number | string | null }');
  expect(dataTypeFromSamples([{a: 1}, {a: 2, b: 'x'}])).toBe('{ a: number; b?: string }');
  expect(dataTypeFromSamples([{list: [1, 'a']}])).toBe('{ list: (number | string)[] }');
  expect(dataTypeFromSamples([{'first name': 'a', '1st': 1, $ok: true}])).toBe('{ "first name": string; "1st": number; $ok: boolean }');
});

test("the TypeScript code's Data is that type; without a run, an open record", () => {
  expect(scriptGlobals([], '{ id: number }')).toContain('type Data = { id: number }');
  expect(scriptGlobals([])).toContain('type Data = Record<string, any>');
});
