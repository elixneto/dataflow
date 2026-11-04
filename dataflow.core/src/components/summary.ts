import {connectionUse} from '../connections/connection-access';
import {connectionType, type ConnectionTypeName} from '../connections/connection-types';
import {aggregateConfig} from './aggregate';
import {startConfig} from './start';
import {dataGridConfig} from './datagrid';
import {distinctKeys} from './distinct';
import {filterCondition} from './filter';
import {flowInvokerConfig} from './flow';
import {httpConfig} from './http-request';
import {limitConfig} from './limit';
import {logConfig} from './log';
import {lookupConfig} from './lookup';
import {mapperFields} from './mapper';
import {mongoDeleteConfig} from './mongodb-delete';
import {mongoPipelineConfig} from './mongodb-pipeline';
import {mongoUpsertConfig} from './mongodb-upsert';
import {routerCases} from './router';
import {sortKeys} from './sort';
import {splitList} from './split';
import {sqlServerConfig} from './sqlserver';
import {typescriptConfig} from './typescript';

/*
 * What a component does, at a glance, read from its config with each component's own helpers (so it shows what will
 * really run): the fields a Mapper writes, a Router's cases, a Filter's condition, a Log's message... The editor shows
 * it apart from the card (the card has a fixed size); here it is only text, the editor decides how it looks.
 */

/** one line: a name (a field, a case, a level) and its value; `code` when the value is an expression or code */
export type SummaryLine = {label?: string; value: string; code?: boolean};

export type SummarySection = {title: string; lines: SummaryLine[]};

/** any config value as text: a string as it is, a fixed-or-expression field by its value, anything else as JSON */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'value' in value) return textOf((value as {value: unknown}).value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** a fixed value shown as text in quotes, an expression as written */
const shown = (value: unknown, expression = true) => (expression ? textOf(value) : JSON.stringify(textOf(value)));
const section = (title: string, lines: SummaryLine[]): SummarySection[] => (lines.length > 0 ? [{title, lines}] : []);
const single = (title: string, value: string, code = true): SummarySection[] => (value.trim() ? [{title, lines: [{value, code}]}] : []);
const collection = (database: string, name: string) => single('Collection', [database, name].filter(Boolean).join('.'), false);

/**
 * How it gets in: the profile's name (`nameOf` turns an id into it: the core does not know the project's
 * profiles nor its flows) or what its own fields say (host and database, the authentication).
 */
function connection(type: ConnectionTypeName, config: Record<string, unknown>, nameOf?: (id: string) => string | undefined): SummarySection[] {
  const use = connectionUse(type, config);
  if ('profile' in use) return [{title: 'Connection', lines: [{value: nameOf?.(use.profile) ?? use.profile}]}];
  if (type === 'http-client' && (use.inline.auth ?? 'none') === 'none') return [];
  return single('Connection', connectionType(type).summary(use.inline), false);
}

/** the sections for a component of this type and config ([] when nothing is set yet); every value is text */
export function componentSummary(type: string, config: Record<string, unknown>, nameOf?: (id: string) => string | undefined): SummarySection[] {
  const asText = (line: SummaryLine): SummaryLine => (line.label === undefined ? {...line, value: textOf(line.value)} : {...line, label: textOf(line.label), value: textOf(line.value)});
  return sections(type, config, nameOf).map(s => ({...s, lines: s.lines.map(asText)}));
}

function sections(type: string, config: Record<string, unknown>, nameOf?: (id: string) => string | undefined): SummarySection[] {
  switch (type) {
    case 'start': {
      const {acceptsInput, testInput, parameters} = startConfig(config);
      return [
        ...(acceptsInput ? [{title: 'Input', lines: [{value: testInput.trim() || 'Accepts input', code: testInput.trim() !== ''}]}] : []),
        ...section('Parameters', parameters.map(p => ({
          label: p.name,
          value: `${p.type}${p.default !== '' ? ` = ${p.type === 'text' ? JSON.stringify(p.default) : p.default}` : ''}${p.required ? ' (required)' : ''}`,
          code: true,
        }))),
      ];
    }
    case 'discard':
      return [{title: 'Discard', lines: [{value: 'Drops every envelope'}]}];
    case 'mapper':
      return section('Fields', mapperFields(config).map(f => ({label: `$${f.target}`, value: shown(f.value, f.expression), code: true})));
    case 'filter':
      return single('Condition', filterCondition(config));
    case 'router':
      return section('Cases', routerCases(config).map((c, i) => ({label: c.label?.trim() || `case ${i + 1}`, value: c.condition, code: true})));
    case 'log': {
      const {level, message} = logConfig(config);
      return message.trim() ? [{title: 'Message', lines: [{label: level, value: message, code: true}]}] : [];
    }
    case 'sort':
      return section('Keys', sortKeys(config).filter(k => k.value.trim()).map(k => ({label: k.direction, value: k.value, code: true})));
    case 'limit': {
      const {mode, count} = limitConfig(config);
      return [{title: 'Limit', lines: [{value: `${mode === 'top' ? 'First' : 'Last'} ${count}`}]}];
    }
    case 'distinct':
      return section('Keys', distinctKeys(config).map(k => ({value: k, code: true})));
    case 'lookup':
      return section('Keys', lookupConfig(config).keys.map(k => ({label: k.main, value: k.lookup, code: true})));
    case 'aggregate': {
      const {size, field} = aggregateConfig(config);
      return [{title: 'Batches', lines: [{value: `${size} per batch, in $${field}`}]}];
    }
    case 'split':
      return single('List', splitList(config));
    case 'datagrid': {
      const {columns, rows} = dataGridConfig(config);
      return [
        ...section('Columns', columns.map(c => ({label: c.type, value: c.name, code: true}))),
        ...(rows.length > 0 ? [{title: 'Rows', lines: [{value: String(rows.length)}]}] : []),
      ];
    }
    case 'sqlserver': {
      return [...connection('sqlserver', config, nameOf), ...single('Query', sqlServerConfig(config).sql)];
    }
    case 'mongodb-pipeline': {
      const {database, collection: name, pipeline} = mongoPipelineConfig(config);
      return [...connection('mongodb', config, nameOf), ...collection(database, name), ...single('Pipeline', pipeline)];
    }
    case 'mongodb-upsert': {
      const {database, collection: name, filter} = mongoUpsertConfig(config);
      return [...connection('mongodb', config, nameOf), ...collection(database, name), ...section('Match on', filter.map(k => ({value: JSON.stringify(k), code: true})))];
    }
    case 'mongodb-delete': {
      const {database, collection: name, filter} = mongoDeleteConfig(config);
      return [...connection('mongodb', config, nameOf), ...collection(database, name), ...single('Filter', filter)];
    }
    case 'http-request': {
      const {method, url} = httpConfig(config);
      return url.value.trim() ? [{title: 'Request', lines: [{label: method, value: shown(url.value, url.expression), code: true}]}, ...connection('http-client', config, nameOf)] : [];
    }
    case 'typescript':
      return single('Code', typescriptConfig(config).code);
    case 'flow': {
      const {flowId, parameters} = flowInvokerConfig(config);
      return [...single('Flow', flowId ? (nameOf?.(flowId) ?? flowId) : '', false), ...section('Parameters', parameters.map(p => ({label: p.name, value: shown(p.value, p.expression), code: true})))];
    }
    default:
      return [];
  }
}
