import { expect, test } from 'bun:test';
import { evaluate } from '#shared/runner/evaluate';

test('a field the envelope lacks is undefined: it can be tested; reading into it fails naming it', () => {
  expect(evaluate('!$shipments ? 9999 : $shipments.length', { $id: 1 })).toBe(9999);
  expect(evaluate('!$shipments ? 9999 : $shipments.length', { $shipments: [1, 2] })).toBe(2);
  expect(() => evaluate('$shipments.length', { $id: 1 })).toThrow(/^Expression "\$shipments\.length": .* \(not in this envelope: \$shipments\)$/);
});
