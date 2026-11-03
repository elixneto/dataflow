import {expect, test} from 'bun:test';
import {expressionSyntaxError, unknownVariables, usedVariables} from '#validation/expression-check';
import {dataVariables, mergeSamples} from '#envelope/available-variables';

test('syntax: compiles without running', () => {
  expect(expressionSyntaxError('$customer.name.toUpperCase()')).toBeNull();
  expect(expressionSyntaxError('')).toBeNull();
  expect(expressionSyntaxError('$a +')).not.toBeNull();
  expect(expressionSyntaxError('$a.b)')).not.toBeNull();
  // never executed: a throw only matters at run time
  expect(expressionSyntaxError('(() => { throw new Error("x"); })()')).toBeNull();
});

test('used and unknown variables ignore strings and use only the root', () => {
  expect(usedVariables('$customer.name + " $notVar " + `$also` + \'$too\' + $PARAMETERS.x')).toEqual(['$customer', '$PARAMETERS']);
  expect(unknownVariables('$customer.name + $order.total', ['$customer', '$customer.name', '$PARAMETERS.limit'])).toEqual(['$order']);
});

test('variables from samples: merged keys, nested paths, type and example', () => {
  const shape = mergeSamples([{id: 1, customer: {name: 'Ana'}}, {id: 2, customer: {city: 'Rio'}, tags: ['a'], empty: null}]);
  const variables = dataVariables(shape);
  expect(variables.map(v => v.path)).toEqual(['$id', '$customer', '$customer.name', '$customer.city', '$tags', '$empty']);
  expect(variables.find(v => v.path === '$customer.name')).toEqual({path: '$customer.name', type: 'string', example: '"Ana"'});
  expect(variables.find(v => v.path === '$customer')?.type).toBe('object');
  expect(variables.find(v => v.path === '$tags')).toEqual({path: '$tags', type: 'array', example: '["a"]'});
});
