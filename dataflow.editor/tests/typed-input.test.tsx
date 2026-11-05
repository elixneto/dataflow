import { afterAll, beforeAll, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentSettings } from '@dataflow/core';
import { loadScriptContent, reloadScripts } from '../src/data/scripts/scripts-store';
import { ProjectResourcesContext } from '../src/editor/project-resources';
import { SettingsForm } from '../src/editor/settings-form';

const ORDER = `export interface Order {
  id: number;
  customerName: string;
  active: boolean;
  status: 'new' | 'paid' | 'shipped';
  tags: string[];
  items: { sku: string; qty: number }[];
  notes?: string;
}
export function total(order: Order) { return order.items.length; }
export enum Priority { Low = 'low', High = 'high' }
export type Discount = { type: 'percent'; percent: number } | { type: 'coupon'; code: string };
export interface Extras {
  notes: Record<string, string>;
  size: [number, string];
  discount: Discount;
  priority: Priority;
}`;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url, 'http://test');
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (pathname.endsWith('/scripts')) {
      return json({ scripts: [{ path: 'orders/types', exports: [{ name: 'Order', typeOnly: true }, { name: 'total', typeOnly: false }] }], folders: ['orders'] });
    }
    return json({ path: 'orders/types', content: ORDER, revision: 0 });
  }) as typeof fetch;
  await reloadScripts('tp');
  await loadScriptContent('tp', 'orders/types');
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const render = (values: Record<string, unknown>) =>
  renderToStaticMarkup(
    <ProjectResourcesContext.Provider value={{ projectId: 'tp', connections: [], secrets: [], variables: [], flows: [] }}>
      <SettingsForm id="s" fields={componentSettings('start')} values={values} onChange={() => {}} />
    </ProjectResourcesContext.Provider>,
  );

test("the Start's input type lists the scripts' types only, never a function", () => {
  const html = render({ acceptsInput: true });
  expect(html).toContain('<option value="" selected="">None (JSON)</option>');
  expect(html).toContain('<optgroup label="orders/types"><option value="orders/types#Order">Order</option></optgroup>');
  expect(html).not.toContain('total');
  // no type: the JSON editor, as before
  expect(html).toContain('Default input (JSON)');
});

test('with a type, the default input is a form of it: text, number, true/false, a choice, lists with Add and Remove', () => {
  const testInput = JSON.stringify({ id: 7, customerName: 'Ana', active: true, status: 'paid', tags: ['a', 'b'], items: [{ sku: 'X1', qty: 2 }] });
  const html = render({ acceptsInput: true, inputType: 'orders/types#Order', testInput });
  expect(html).toContain('aria-label="Default input view"');
  expect(html).toMatch(/id="s-testInput-id" type="number"[^>]*value="7"/);
  expect(html).toContain('value="Ana"');
  expect(html).toMatch(/aria-label="true"[^>]*name="s-testInput-active" checked=""/);
  expect(html).toContain('<option value="&quot;paid&quot;" selected="">paid</option>');
  expect(html.match(/aria-label="Remove item \d"/g)?.length).toBe(3);
  expect(html.match(/Add item/g)?.length).toBe(2);
  expect(html).toContain('value="X1"');
  // an optional field can be left out
  expect(html).toContain('aria-label="Send notes"');
});

test('records as keys and values, tuples by position, a discriminated union by its tag, an enum as a choice', () => {
  const testInput = JSON.stringify({ notes: { color: 'red' }, size: [3, 'cm'], discount: { type: 'coupon', code: 'WELCOME' }, priority: 'high' });
  const html = render({ acceptsInput: true, inputType: 'orders/types#Extras', testInput });
  // the record: its key, its value, Remove and Add entry
  expect(html).toMatch(/aria-label="Key of entry 1"[^>]*value="color"/);
  expect(html).toContain('value="red"');
  expect(html).toContain('aria-label="Remove entry 1"');
  expect(html).toContain('Add entry');
  // the tuple: one control per position
  expect(html).toMatch(/id="s-testInput-size-0" type="number"[^>]*value="3"/);
  expect(html).toMatch(/id="s-testInput-size-1"[^>]*value="cm"/);
  // the union: the tag chosen and that variant's fields only
  expect(html).toContain('<option value="&quot;coupon&quot;" selected="">coupon</option>');
  expect(html).toContain('value="WELCOME"');
  expect(html).not.toContain('s-testInput-discount-percent');
  // the enum
  expect(html).toContain('<option value="&quot;high&quot;" selected="">high</option>');
  // what was typed differs from the empty value: Reset is offered
  expect(html).toContain('>Reset</button>');
});

test("a default input that does not fit the type says why, as the server would when the run starts", () => {
  const html = render({ acceptsInput: true, inputType: 'orders/types#Order', testInput: JSON.stringify({ id: 'x', customerName: 'Ana', active: true, status: 'lost', tags: [], items: [] }) });
  expect(html).toContain('aria-label="Input issues"');
  expect(html).toContain('input.id: expected a number, got text &quot;x&quot;.');
  expect(html).toContain('input.status: expected one of &quot;new&quot;, &quot;paid&quot;, &quot;shipped&quot;, got text &quot;lost&quot;.');
  expect(render({ acceptsInput: true, inputType: 'orders/types#Order', testInput: JSON.stringify({ id: 1, customerName: 'Ana', active: true, status: 'new', tags: [], items: [] }) })).not.toContain('Input issues');
});

test('a default input that is a list: one envelope per item, each checked; the form says to edit it as JSON (it never turns it into one object)', () => {
  const one = { id: 1, customerName: 'Ana', active: true, status: 'new', tags: [], items: [] };
  const html = render({ acceptsInput: true, inputType: 'orders/types#Order', testInput: JSON.stringify([one, { ...one, id: 'x' }]) });
  expect(html).toContain('A list of 2 envelope(s), each one Order: edit it in the JSON view.');
  expect(html).toContain('input[1].id: expected a number, got text &quot;x&quot;.');
  expect(html).not.toContain('id="s-testInput-customerName"');
});

test('lists and records are not marked required: they go as [] or {} until items are added; text and numbers are', () => {
  const html = render({ acceptsInput: true, inputType: 'orders/types#Extras', testInput: JSON.stringify({ notes: {}, size: [1, 'a'], discount: { type: 'percent', percent: 1 }, priority: 'low' }) });
  const marked = (name: string) => new RegExp(`for="s-testInput-${name}"[^>]*>${name}</label><span[^>]*aria-label="Required"`).test(html);
  expect(marked('notes')).toBe(false);
  expect(marked('size')).toBe(true);
  const order = render({ acceptsInput: true, inputType: 'orders/types#Order', testInput: JSON.stringify({ id: 1, customerName: 'Ana', active: true, status: 'new', tags: [], items: [] }) });
  const markedOrder = (name: string) => new RegExp(`for="s-testInput-${name}"[^>]*>${name}</label><span[^>]*aria-label="Required"`).test(order);
  expect([markedOrder('tags'), markedOrder('items'), markedOrder('id'), markedOrder('customerName')]).toEqual([false, false, true, true]);
});
