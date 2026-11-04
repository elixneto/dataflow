import {expect, test} from 'bun:test';
import {aggregateConfig, COMPONENTS, componentSettings, limitConfig, logConfig, lookupConfig, splitList, settingConditions, settingDefault, settingsDefaults, settingVisible, type SettingField} from '../../src/index';

const DECLARED = ['filter', 'log', 'limit', 'mapper', 'router', 'sort', 'distinct', 'lookup', 'split', 'aggregate', 'sqlserver', 'mongodb-pipeline', 'mongodb-upsert', 'mongodb-delete', 'http-request', 'typescript', 'datagrid', 'flow'];

test('every component declares its settings', () => {
  for (const type of DECLARED) expect(`${type}: ${componentSettings(type).length > 0}`).toBe(`${type}: true`);
  expect(componentSettings('unknown')).toEqual([]);
});

test('the declared settings are well formed: a list has its item, a select default is one of its options, keys are unique', () => {
  const check = (fields: SettingField[], where: string) => {
    expect(new Set(fields.map(f => f.key)).size).toBe(fields.length);
    for (const field of fields) {
      const at = `${where}.${field.key}`;
      if (field.kind === 'list') {
        expect(`${at}: ${(field.item ?? []).length > 0}`).toBe(`${at}: true`);
        if (field.flat) expect(`${at}: ${field.item?.length}`).toBe(`${at}: 1`);
        check(field.item ?? [], at);
      }
      if (field.kind === 'select') expect(`${at}: ${field.options?.some(o => o.value === settingDefault(field))}`).toBe(`${at}: true`);
      for (const when of settingConditions(field)) expect(`${at}: ${fields.some(f => f.key === when.key)}`).toBe(`${at}: true`);
    }
  };
  for (const [type, logic] of Object.entries(COMPONENTS)) check(logic.settings ?? [], type);
});

test("a new component's defaults are what the helpers already fall back to", () => {
  expect(settingsDefaults(componentSettings('limit'))).toEqual({mode: 'top', count: 10});
  expect(limitConfig(settingsDefaults(componentSettings('limit')))).toEqual(limitConfig({}));
  expect(logConfig(settingsDefaults(componentSettings('log')))).toEqual(logConfig({}));
  expect(settingsDefaults(componentSettings('mapper'))).toEqual({fields: []});
  expect(aggregateConfig(settingsDefaults(componentSettings('aggregate')))).toEqual(aggregateConfig({}));
  expect(splitList(settingsDefaults(componentSettings('split')))).toBe(splitList({}));
  expect(lookupConfig(settingsDefaults(componentSettings('lookup')))).toEqual(lookupConfig({}));
  // a new item of a list: a Mapper field starts as an expression
  const fields = componentSettings('mapper')[0]?.item ?? [];
  expect(settingsDefaults(fields)).toEqual({target: '', value: '', expression: true});
});

test('the defaults of the required settings are what validate asks for', () => {
  expect(COMPONENTS.filter?.validate(settingsDefaults(componentSettings('filter')))).toEqual(['has no condition.']);
  expect(COMPONENTS.mapper?.validate(settingsDefaults(componentSettings('mapper')))).toEqual(['has no fields.']);
  expect(COMPONENTS.router?.validate(settingsDefaults(componentSettings('router')))).toEqual(['has no cases.']);
  expect(COMPONENTS.limit?.validate(settingsDefaults(componentSettings('limit')))).toEqual([]);
});

test('a setting with `when` shows only for those values; an unset value counts as its default', () => {
  const fields: SettingField[] = [
    {key: 'auth', label: 'Auth', kind: 'select', default: 'none', options: [{value: 'none', label: 'None'}, {value: 'bearer', label: 'Bearer'}]},
    {key: 'token', label: 'Token', kind: 'secret', when: {key: 'auth', values: ['bearer']}},
  ];
  const token = fields[1] as SettingField;
  expect(settingVisible(token, {}, fields)).toBe(false);
  expect(settingVisible(token, {auth: 'bearer'}, fields)).toBe(true);
  expect(settingVisible(fields[0] as SettingField, {}, fields)).toBe(true);
});

test("the TypeScript code's globals, for the editor's autocomplete, are the ones the runner gives the script", async () => {
  const {SCRIPT_GLOBALS} = await import('../../src/index');
  for (const name of ['type Data', '$PARAMETERS', '$SECRETS', '$VARIABLES', '$FLOW_CURRENT_RUN', 'function log']) expect(SCRIPT_GLOBALS).toContain(name);
});

test("an expression reads the project's variables as $VARIABLES (plain values, not masked)", async () => {
  const {flowRunner} = await import('../../src/index');
  const {evaluate} = await import('../helpers');
  const reached: Record<string, unknown>[] = [];
  const r = await flowRunner({
    project: 'Test', flow: 'Vars', parameters: [],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 'm', type: 'mapper', label: 'Region', config: {fields: [{target: 'region', value: '$VARIABLES.REGION', expression: true}]}},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 'm', targetPort: 'in-0'},
      {source: 'm', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  }, {mode: 'execution', id: 'vars', evaluate, variables: {REGION: 'us-east-1'}, onReachEnd: async doc => void reached.push(doc.DATA)});
  expect(r.status).toBe('completed');
  expect(reached[0]?.region).toBe('us-east-1');
});

test('a value setting in a list item is stored flat on the item ({name, value, expression}), as the core reads it', async () => {
  const {settingValue, withSetting, componentSummary, mapperFields} = await import('../../src/index');
  for (const [type, list] of [['mapper', 'fields'], ['sqlserver', 'parameters'], ['http-request', 'query'], ['http-request', 'headers'], ['flow', 'parameters'], ['mongodb-upsert', 'filter']] as const) {
    const item = componentSettings(type).find(f => f.key === list)!.item!;
    const value = item.find(f => f.kind === 'value')!;
    expect(`${type}.${list}: ${value.spread}`).toBe(`${type}.${list}: true`);
    const defaults = settingsDefaults(item);
    expect(typeof defaults.value).toBe('string');
    expect(typeof defaults.expression).toBe('boolean');
    // both modes, written and read back
    for (const mode of [{value: '$a + 1', expression: true}, {value: 'web', expression: false}]) {
      const written = withSetting(value, {name: 'x'}, mode);
      expect(written).toEqual({name: 'x', ...mode});
      expect(settingValue(value, written)).toEqual(mode);
    }
  }
  const fields = [{target: 'a', value: '$b', expression: true}, {target: 'c', value: 'web', expression: false}];
  expect(mapperFields({fields}).map(f => f.value)).toEqual(['$b', 'web']);
  // the summary is always text, even for a value left nested by an older editor
  const lines = componentSummary('mapper', {fields: [{target: 'old', value: {value: '$x', expression: true}}]})[0]!.lines;
  expect(lines).toEqual([{label: '$old', value: '$x', code: true}]);
});
