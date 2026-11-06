import { afterAll, beforeAll, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentSettings, scriptExports } from '@dataflow/core';
import { loadScriptContent, reloadScripts } from '../src/data/scripts/scripts-store';
import { ProjectResourcesContext } from '../src/editor/project-resources';
import { argumentsFor } from '../src/editor/script-function';
import { SettingsForm } from '../src/editor/settings-form';

const OPS = `export interface Order { total: number }
export const VAT = 0.2;
export async function withVat(order: Order, rate?: number, round = true) { return order.total * (1 + (rate ?? VAT)); }
export function none() {}`;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url, 'http://test');
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (pathname.endsWith('/scripts')) {
      return json({ scripts: [{ path: 'pricing/ops', exports: scriptExports(OPS) }, { path: 'types/only', exports: [{ name: 'T', typeOnly: true }] }], folders: [] });
    }
    return json({ path: 'pricing/ops', content: OPS, revision: 0 });
  }) as typeof fetch;
  await reloadScripts('si');
  await loadScriptContent('si', 'pricing/ops');
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const render = (values: Record<string, unknown>) =>
  renderToStaticMarkup(
    <ProjectResourcesContext.Provider value={{ projectId: 'si', connections: [], secrets: [], variables: [], flows: [] }}>
      <SettingsForm id="s" fields={componentSettings('script')} values={values} onChange={() => {}} />
    </ProjectResourcesContext.Provider>,
  );

test('the function picker lists the functions the scripts export, never their types or constants', () => {
  const html = render({});
  expect(html).toContain('<optgroup label="pricing/ops"><option value="pricing/ops#withVat">withVat</option><option value="pricing/ops#none">none</option></optgroup>');
  expect(html).not.toContain('VAT<');
  expect(html).not.toContain('types/only');
  // no function yet: no arguments
  expect(html).not.toContain('Arguments');
});

test("its arguments: one row per parameter, in order, with its type; a required one with no value is said so", () => {
  const html = render({ function: 'pricing/ops#withVat', arguments: [{ name: 'order', type: 'Order', value: '$order', expression: true }] });
  expect(html.indexOf('aria-label="argument order"')).toBeLessThan(html.indexOf('aria-label="argument rate"'));
  expect(html.indexOf('aria-label="argument rate"')).toBeLessThan(html.indexOf('aria-label="argument round"'));
  expect(html).toContain('title="Order">Order');
  expect(html).not.toContain('title="Required: give it a value"');
  expect(render({ function: 'pricing/ops#withVat' })).toContain('title="Required: give it a value"');
  expect(render({ function: 'pricing/ops#none' })).toContain('The function takes no arguments.');
});

test('arguments kept for an older signature: a note, and matching takes the values by name, in the new order', () => {
  const kept = [{ name: 'rate', type: 'number', value: '0.1', expression: false }, { name: 'gone', value: 'x', expression: false }];
  expect(render({ function: 'pricing/ops#withVat', arguments: kept })).toContain('The function&#x27;s parameters changed (gone no longer there)');
  const fn = { name: 'withVat', params: [{ name: 'order', type: 'Order', optional: false }, { name: 'rate', type: 'number', optional: true }] };
  expect(argumentsFor(fn, kept)).toEqual([
    { name: 'order', type: 'Order', value: '', expression: false },
    { name: 'rate', type: 'number', value: '0.1', expression: false },
  ]);
});
