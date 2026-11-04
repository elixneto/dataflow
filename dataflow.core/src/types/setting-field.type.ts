/**
 * One setting of a component, declared once in the core (the same idea as a connection profile's fields): the editor
 * builds the form from it, the server and the runner read the same defaults and rules. How it looks is the editor's.
 *
 * - text: a plain string;
 * - number: a number (min/max);
 * - select: one of `options`;
 * - boolean: on/off;
 * - expression: a string that is always an expression on the envelope (a Filter's condition, a Log's message);
 * - value: an ExpressionField `{value, expression}`, a fixed value or an expression (the fx toggle; a Mapper's value);
 * - code: a longer text in a language (SQL, JavaScript, JSON);
 * - secret: the name of one of the project's secrets (the value never goes in the flow);
 * - connection: the id of one of the project's connection profiles of `connectionType`;
 * - list: a list of items, each with the `item` settings (a Mapper's fields, a Router's cases);
 * - grid: a table, its columns (name and one of `options` as type) in `key` and its rows (text cells) in `rows`;
 * - flow: the id of another flow of the project.
 */
export type SettingKind = 'text' | 'number' | 'select' | 'boolean' | 'expression' | 'value' | 'code' | 'secret' | 'connection' | 'list' | 'grid' | 'flow';

export type SettingField = {
  key: string;
  label: string;
  kind: SettingKind;
  required?: boolean;
  /** the value a new component starts with (and what the helpers fall back to) */
  default?: unknown;
  placeholder?: string;
  /** select: the choices */
  options?: {value: string; label: string}[];
  /** number: the bounds */
  min?: number;
  max?: number;
  /** code: its language */
  language?: 'sql' | 'javascript' | 'typescript' | 'json';
  /** connection: the profile type of its own fields, when no profile is picked (e.g. 'sqlserver') */
  connectionType?: string;
  /** connection: the profile types it can pick (default: `connectionType`); an HTTP request takes any API's */
  connectionTypes?: string[];
  /** list: each item's settings */
  item?: SettingField[];
  /**
   * value, in a list's item: stored as the item's own `value` and `expression` keys (the core's `ExpressionField & {name}`,
   * e.g. a Mapper field `{target, value, expression}`), not as an object under its key
   */
  spread?: boolean;
  /** list: each item is the value of its single `item` setting, not an object (e.g. Distinct's keys: a list of expressions) */
  flat?: boolean;
  /** list: what a new item is called (e.g. 'field', 'case') */
  itemLabel?: string;
  /** shown only when another setting (of the same level) has one of these values; several: all of them */
  when?: SettingCondition | SettingCondition[];
};

export type SettingCondition = {key: string; values: unknown[]};
