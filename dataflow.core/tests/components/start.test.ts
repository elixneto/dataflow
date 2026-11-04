import {expect, test} from 'bun:test';
import {componentIssues, componentSettings, componentSummary, settingVisible, startConfig, startParameters, START_SETTINGS} from '../../src/index';

test("the Start's settings: Accepts input, the default input (only when it accepts one) and the parameters", () => {
  expect(componentSettings('start')).toBe(START_SETTINGS);
  const input = START_SETTINGS.find(f => f.key === 'testInput')!;
  expect(settingVisible(input, {}, START_SETTINGS)).toBe(false);
  expect(settingVisible(input, {acceptsInput: true}, START_SETTINGS)).toBe(true);
});

test("the Start's config, cleaned: the flow's parameters come from it (ExecutableFlow.parameters)", () => {
  const config = {acceptsInput: true, testInput: '{"n": 5}', parameters: [{name: ' since ', type: 'number', default: '10', required: true}, {name: 'tag', type: 'odd'}]};
  expect(startConfig(config)).toEqual({
    acceptsInput: true, testInput: '{"n": 5}',
    parameters: [{name: 'since', type: 'number', default: '10', required: true}, {name: 'tag', type: 'text', default: ''}],
  });
  expect(startParameters([{type: 'mapper', config: {}}, {type: 'start', config}])).toEqual(startConfig(config).parameters);
  expect(startParameters([])).toEqual([]);
});

test("the Start's issues: parameter names valid and unique, defaults of their type, the input as JSON", () => {
  expect(componentIssues('start', {})).toEqual([]);
  expect(componentIssues('start', {
    acceptsInput: true, testInput: '{oops',
    parameters: [{name: '1a', type: 'text'}, {name: 'n', type: 'number', default: 'ten'}, {name: 'n', type: 'boolean', default: 'yes'}],
  })).toEqual([
    'parameter 1 "1a" is not a valid name (letters, digits and _, not starting with a digit).',
    'parameter "n": "ten" is not a number.',
    'has the parameter "n" more than once.',
    'parameter "n": "yes" is not true or false.',
    'has a default input that is not valid JSON.',
  ]);
  // a component's issues come from its own validate
  expect(componentIssues('filter', {})).toEqual(['has no condition.']);
});

test("the Start's summary: its input and parameters", () => {
  expect(componentSummary('start', {})).toEqual([]);
  expect(componentSummary('start', {acceptsInput: true, parameters: [{name: 'since', type: 'number', default: '10', required: true}, {name: 'tag', type: 'text', default: 'a'}]})).toEqual([
    {title: 'Input', lines: [{value: 'Accepts input', code: false}]},
    {title: 'Parameters', lines: [{label: 'since', value: 'number = 10 (required)', code: true}, {label: 'tag', value: 'text = "a"', code: true}]},
  ]);
});

test("the code editor's $PARAMETERS is typed from the Start's parameters", async () => {
  const {scriptGlobals, SCRIPT_GLOBALS} = await import('../../src/index');
  expect(scriptGlobals([])).toBe(SCRIPT_GLOBALS);
  const typed = scriptGlobals([{name: 'since', type: 'number', default: '10'}, {name: 'tag', type: 'text', default: ''}]);
  expect(typed).toContain('declare const $PARAMETERS: {\n  "since": number\n  "tag": string\n}');
  expect(typed).not.toContain('Record<string, string | number | boolean>');
});
