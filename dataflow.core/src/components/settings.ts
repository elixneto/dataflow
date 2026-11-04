import type {SettingCondition, SettingField} from '#types/setting-field.type';
import {START} from '#engine/constants';
import type {Issue} from '#types/issue.type';
import {COMPONENTS} from './index';
import {START_SETTINGS, validateStart} from './start';

/*
 * The settings a component declares (ComponentLogic.settings), read the same way by the editor (the form), the server
 * and the runner: what is shown, what a new component starts with, what a new list item starts with.
 */

/** the settings of a component type, the Start's included ([] for one that declares none) */
export function componentSettings(type: string): SettingField[] {
  return type === START ? START_SETTINGS : (COMPONENTS[type]?.settings ?? []);
}

/** the configuration issues of a component type, the Start's included */
export function componentIssues(type: string, config: Record<string, unknown>): Issue[] {
  return type === START ? validateStart(config) : (COMPONENTS[type]?.validate(config) ?? []);
}

/** whether a setting shows, given the values of its level and their settings (its `when`; an unset value counts as its default) */
export function settingVisible(field: SettingField, values: Record<string, unknown>, fields: SettingField[]): boolean {
  return settingConditions(field).every(when => {
    const other = fields.find(f => f.key === when.key);
    return when.values.includes(values[when.key] ?? (other ? settingDefault(other) : undefined));
  });
}

/** a setting's `when`, as a list */
export const settingConditions = (field: SettingField): SettingCondition[] => (field.when === undefined ? [] : Array.isArray(field.when) ? field.when : [field.when]);

/** what a setting starts with: its default, or the empty value of its kind */
export function settingDefault(field: SettingField): unknown {
  if (field.default !== undefined) return structuredClone(field.default);
  switch (field.kind) {
    case 'list':
    case 'grid': return [];
    case 'boolean': return false;
    case 'value': return {value: '', expression: false};
    case 'number': return field.min ?? 0;
    case 'select': return field.options?.[0]?.value ?? '';
    default: return '';
  }
}

/** the values a new item (a list's) or a new component starts with */
export function settingsDefaults(fields: SettingField[]): Record<string, unknown> {
  return Object.assign({}, ...fields.map(f => (f.spread ? (settingDefault(f) as Record<string, unknown>) : {[f.key]: settingDefault(f)})));
}

/** a setting's value in its level's values (a spread one: the level's own `value` and `expression`) */
export function settingValue(field: SettingField, values: Record<string, unknown>): unknown {
  if (field.spread) {
    const fallback = settingDefault(field) as {value: string; expression: boolean};
    return {
      value: typeof values.value === 'string' ? values.value : fallback.value,
      expression: typeof values.expression === 'boolean' ? values.expression : fallback.expression,
    };
  }
  return values[field.key] ?? settingDefault(field);
}

/** the level's values with this setting changed (a spread one writes the level's `value` and `expression`) */
export function withSetting(field: SettingField, values: Record<string, unknown>, value: unknown): Record<string, unknown> {
  return field.spread ? {...values, ...(value as Record<string, unknown>)} : {...values, [field.key]: value};
}
