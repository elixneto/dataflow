import { expect, test } from 'bun:test';
import { createEvaluate, evaluate } from '#shared/runner/evaluate';

test('a field the envelope lacks is undefined: it can be tested; reading into it fails naming it', () => {
  expect(evaluate('!$shipments ? 9999 : $shipments.length', { $id: 1 })).toBe(9999);
  expect(evaluate('!$shipments ? 9999 : $shipments.length', { $shipments: [1, 2] })).toBe(2);
  expect(() => evaluate('$shipments.length', { $id: 1 })).toThrow(/^Expression "\$shipments\.length": .* \(not in this envelope: \$shipments\)$/);
});

test("a run's evaluator sees only the current envelope's variables, never the previous call's", () => {
  const run = createEvaluate();
  expect(run('$a + 1', { $a: 1 })).toBe(2);
  expect(run('typeof $a', { $b: 2 })).toBe('undefined');
  expect(run('(globalThis.leaked = 5, leaked)', {})).toBe(5);
  expect(run('typeof leaked', {})).toBe('undefined');
  expect(run('$a * 2', { $a: 21 })).toBe(42);
  expect(run('$a + $b', { $b: 1, $a: 2 })).toBe(3);
});

test('a function an expression returns keeps seeing its own envelope, as with a context per call', () => {
  const run = createEvaluate();
  const keep = run('() => $a', { $a: 1 }) as () => unknown;
  const getter = run('({ get total() { return $a * 10; } })', { $a: 2 }) as { total: number };
  run('$a', { $a: 99 });
  expect(keep()).toBe(1);
  expect(getter.total).toBe(20);
});

test('what an expression returns stays writable for whoever gets it', () => {
  const run = createEvaluate();
  const made = run('({ a: 1, list: [1] })', {}) as { a: number; list: number[]; toString: () => string };
  made.toString = () => 'mine';
  made.list.push(2);
  expect(String(made)).toBe('mine');
  expect(made.list).toEqual([1, 2]);
});

test('built-in global names stay what they are for the next expression; runs never share a context', () => {
  const run = createEvaluate();
  run('(Math = null, JSON = 1)', {});
  expect(run('Math.max(1, 2)', {})).toBe(2);
  expect(run('JSON.stringify([1])', {})).toBe('[1]');
  run('(Object.prototype.polluted = 1)', {});
  expect(createEvaluate()('({}).polluted', {})).toBeUndefined();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test('errors keep their type and message; a syntax error is an error of the expression; an endless loop times out', () => {
  const run = createEvaluate();
  const failure = (expression: string, variables: Record<string, unknown> = {}) => {
    try {
      run(expression, variables);
    } catch (e) {
      return e as Error;
    }

    throw new Error(`"${expression}" did not fail`);
  };
  expect(failure('$a.b.c', { $a: {} }).name).toBe('TypeError');
  expect(failure('1 +').message).toMatch(/^Expression "1 \+":/);
  expect(failure('(() => { while (true) {} })()').message).toMatch(/^Expression/);
  expect(run('$x ?? "after the failures"', {})).toBe('after the failures');
});
