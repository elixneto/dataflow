import {validateName} from '../folders/folder-tree';
import {CONNECTION_TYPES, visibleFields, type ConnectionTypeName} from './connection-types';

/*
 * A connection profile's rules, shared by the editor (errors as you type) and the server (which enforces them).
 * Secrets and variables are named by the same rule, so a flow reads them as SECRETS['name'] / ENV_VARIABLES['name'].
 */

export type ProfileFields = {name: string; type: ConnectionTypeName; config: Record<string, string>};

/** A secret's or variable's name: a letter first, then letters, digits, - and _ (no accents or spaces), at most 64. */
export const SECRET_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** The name's error (the rule above; unique among `existing` ignoring case, without `exceptId`), or undefined. */
export function secretNameError(name: string, existing: {name: string; id?: string}[], exceptId?: string): string | undefined {
  if (name === '') return 'Required';
  if (!SECRET_NAME.test(name)) return 'Start with a letter; then only letters, digits, - and _ (no accents or spaces, at most 64)';
  return existing.some(s => s.name.toLowerCase() === name.toLowerCase() && (exceptId === undefined || s.id !== exceptId)) ? 'Already in use' : undefined;
}

export const secretValueError = (value: string) => (value === '' ? 'Required' : undefined);

export const VARIABLE_VALUE_MAX = 10_000;

/** A variable may be empty (e.g. a feature off); only very long values are refused. */
export const variableValueError = (value: string) => (value.length > VARIABLE_VALUE_MAX ? `At most ${VARIABLE_VALUE_MAX} characters` : undefined);

export const isConnectionType = (type: string): type is ConnectionTypeName => CONNECTION_TYPES.some(t => t.type === type);

/**
 * The fields' errors ({} = valid): a known type; name required and unique in the project (ignoring case); each required
 * field of the type filled; a number field holds digits; a secret field names one of `secretNames`. Fields that do not
 * apply (their `when` does not match) are dropped from the returned config.
 */
export function validateProfile(
  fields: ProfileFields,
  others: {name: string; id: string}[],
  secretNames: string[],
  exceptId?: string,
): {value: ProfileFields; errors: Record<string, string>} {
  const errors: Record<string, string> = {};
  const name = validateName(fields.name, others.filter(o => o.id !== exceptId));
  if (name.error) errors.name = name.error;
  if (!isConnectionType(fields.type)) return {value: {...fields, name: name.value}, errors: {...errors, type: 'Unknown type'}};

  const config: Record<string, string> = {};
  for (const field of visibleFields(fields.type, fields.config)) {
    // a select left out takes its default (profiles saved before the option existed)
    const value = String(fields.config[field.key] ?? (field.kind === 'select' ? (field.default ?? '') : '')).trim();
    config[field.key] = value;
    if (field.required && value === '') errors[field.key] = field.kind === 'secret' ? 'Choose a secret' : 'Required';
    else if (field.kind === 'secret' && value !== '' && !secretNames.includes(value)) errors[field.key] = 'Unknown secret';
    else if (field.kind === 'number' && value !== '' && !/^\d+$/.test(value)) errors[field.key] = 'A whole number';
    else if (field.kind === 'select' && value !== '' && !field.options?.some(o => o.value === value)) errors[field.key] = 'Not an option';
  }

  return {value: {name: name.value, type: fields.type, config}, errors};
}
