import { describe, expect, test } from 'bun:test';
import vm from 'node:vm';
import { envelopeVariables, expressionScope } from '@dataflow/core';
import { createEvaluate } from '#shared/runner/evaluate';

/*
 * The run's evaluator against the reference: the evaluate the runner had before (a new node:vm context per call, the
 * envelope's variables as its globals). Every expression here must give the same value, or fail with the same kind of
 * error, through both; a change to createEvaluate that alters what a flow computes breaks this file.
 */

const reference = (expression: string, variables: Record<string, unknown>) => vm.runInNewContext(`(${expression}\n)`, expressionScope(expression, variables), { timeout: 1000 });

const variablesOf = (data: Record<string, unknown>) =>
  envelopeVariables(
    {
      FLOW_CURRENT_RUN: { id: 'run-1', mode: 'execution', project: 'p', flow: 'f', startedAt: '2026-01-01T00:00:00.000Z' },
      PARAMETERS: { size: 10, name: 'x', active: true },
      DATA: data,
    },
    { TOKEN: 's3cr3t' },
    { REGION: 'br' },
  );

const CORPUS: [string, Record<string, unknown>][] = [
  ['$price * $quantity', { price: 2.5, quantity: 4 }],
  ['`${$PARAMETERS.name}-${$FLOW_CURRENT_RUN.id}`', {}],
  ['$name.toUpperCase().slice(0, 3)', { name: 'mapper' }],
  ['$items.map(i => i.qty * 2).reduce((a, b) => a + b, 0)', { items: [{ qty: 1 }, { qty: 2 }] }],
  ['$items.filter(i => i.qty > 1).length', { items: [{ qty: 1 }, { qty: 2 }] }],
  ['({ ...$customer, full: $customer.first + " " + $customer.last })', { customer: { first: 'a', last: 'b' } }],
  ['[...new Set($tags)].sort()', { tags: ['b', 'a', 'b'] }],
  ['Object.keys($o).length', { o: { a: 1, b: 2 } }],
  ['Object.entries($o).map(([k, v]) => k + v).join(",")', { o: { a: 1, b: 2 } }],
  ['JSON.stringify($o)', { o: { a: [1, 2] } }],
  ['JSON.parse($text).x', { text: '{"x":7}' }],
  ['new Date($at).getUTCFullYear()', { at: '2025-06-01T00:00:00Z' }],
  ['new Date($at).toISOString()', { at: '2025-06-01T00:00:00Z' }],
  ['/^a/i.test($s)', { s: 'Abc' }],
  ['$s.replace(/b/g, "x")', { s: 'abcb' }],
  ['Math.round($v * 100) / 100', { v: 1.23456 }],
  ['Number($n) + parseInt("12", 10) + parseFloat("1.5")', { n: '3' }],
  ['$missing ?? "default"', {}],
  ['$a?.b?.c ?? null', { a: {} }],
  ['$SECRETS.TOKEN.length', {}],
  ['$VARIABLES.REGION', {}],
  ['$PARAMETERS.size > 5 ? "big" : "small"', {}],
  ['$PARAMETERS.active && !$PARAMETERS.missing', {}],
  ['Array.isArray($list) && $list.includes(2)', { list: [1, 2] }],
  ['$list.slice().reverse()', { list: [1, 2, 3] }],
  ['Object.assign({}, $a, { z: 1 })', { a: { y: 2 } }],
  ['typeof $fn', {}],
  ['encodeURIComponent($q)', { q: 'a b&c' }],
  ['String($n).padStart(5, "0")', { n: 42 }],
  ['$big > 2 ** 53', { big: 2 ** 53 + 2 }],
  ['(() => { const r = {}; r.total = 1; r.count = 2; return r; })()', {}],
  ['(() => { const list = []; list.push(1, 2); list.length = 1; return list; })()', {}],
  ['$x === undefined', {}],
  ['$descrição + "!"', { descrição: 'acentos' }],
  ['$_id + $id', { _id: 'a', id: 'b' }],
  ['globalThis["$" + $PARAMETERS.name]', { x: 'dynamic' }],
  ['this.$id', { id: 'via this' }],
  ['(counter = 1, counter + 1)', {}],
  ['[{ $match: { customerId: $id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]', { id: 7 }],
  ['`http://api/items/${$id}?q=${encodeURIComponent($q)}`', { id: 3, q: 'a b' }],
  ['$price * $quantity', { price: 3, quantity: 3, extra: 1 }],
  ['$price * $quantity', { quantity: 5, price: 2 }],
];

const ERRORS: [string, Record<string, unknown>][] = [
  ['$a.b.c', { a: {} }],
  ['$missing.length', {}],
  ['undefinedFunction()', {}],
  ['JSON.parse($text)', { text: 'not json' }],
  ['(() => { throw new RangeError("mine"); })()', {}],
];

const outcome = (fn: () => unknown) => {
  try {
    return { value: fn() as unknown };
  } catch (e) {
    return { error: (e as Error).name };
  }
};

describe('createEvaluate gives what the previous evaluate gave', () => {
  const run = createEvaluate();

  test.each(CORPUS.map(([expression, data]) => [expression, data] as const))('%s', (expression, data) => {
    const variables = variablesOf(data);
    const expected = outcome(() => reference(expression, variables));
    expect('error' in expected).toBe(false);
    expect(outcome(() => run(expression, variables))).toEqual(expected);
  });

  test.each(ERRORS.map(([expression, data]) => [expression, data] as const))('fails the same way: %s', (expression, data) => {
    const variables = variablesOf(data);
    const expected = outcome(() => reference(expression, variables));
    expect('error' in expected).toBe(true);
    expect(outcome(() => run(expression, variables))).toEqual(expected);
  });

  test('the same expressions again, in another order, through the same run', () => {
    for (const [expression, data] of [...CORPUS].reverse()) {
      const variables = variablesOf(data);
      expect(outcome(() => run(expression, variables))).toEqual(outcome(() => reference(expression, variables)));
    }
  });

  test('what an expression returns stays writable, and its functions keep their own envelope', () => {
    const made = run('({ a: 1 })', variablesOf({})) as Record<string, unknown>;
    made.toString = () => 'mine';
    expect(String(made)).toBe('mine');
    const keep = run('() => $a', variablesOf({ a: 1 })) as () => unknown;
    const getter = run('({ get total() { return $a * 10; } })', variablesOf({ a: 2 })) as { total: number };
    run('$a', variablesOf({ a: 99 }));
    expect(keep()).toBe((reference('() => $a', variablesOf({ a: 1 })) as () => unknown)());
    expect(getter.total).toBe(20);
  });
});
