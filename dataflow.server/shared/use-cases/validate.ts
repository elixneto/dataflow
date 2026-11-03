import type { z } from 'zod';
import { fail, success, type UseCaseResult } from './use-case-result';

/**
 * Parses `input` with a zod schema. A failure becomes a 'validation' result with one message per field (the first
 * issue of each path), so a handler starts with:
 *
 *   const parsed = validate(CreateProjectCommand, input);
 *   if (!parsed.ok) return parsed;
 */
export function validate<S extends z.ZodType>(schema: S, input: unknown): UseCaseResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return success(parsed.data);
  }

  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join('.') || '_';
    fields[path] ??= issue.message;
  }

  return fail('validation', 'The request has invalid fields.', fields);
}
