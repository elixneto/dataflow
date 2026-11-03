/*
 * What every use case returns: a value, or an expected error (a business rule said no). Unexpected failures (the
 * database is down, a bug) are not results: they are thrown and the api answers 500.
 */

export type UseCaseErrorCode = 'validation' | 'forbidden' | 'not-found' | 'conflict';

export type UseCaseError = {
  code: UseCaseErrorCode;
  message: string;
  /** per field, for validation errors: {name: 'Required'} */
  fields?: Record<string, string>;
};

export type UseCaseResult<T = void> = { ok: true; value: T } | { ok: false; error: UseCaseError };

export const success = <T = void>(value: T): UseCaseResult<T> => ({ ok: true, value });

export const fail = (code: UseCaseErrorCode, message: string, fields?: Record<string, string>): UseCaseResult<never> => ({
  ok: false,
  error: fields ? { code, message, fields } : { code, message },
});
