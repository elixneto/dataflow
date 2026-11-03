/** Names that cannot be DATA keys (they are the system variables in expressions). */
export const RESERVED_NAMES = ['WORKFLOW_CURRENT_RUN', 'PARAMETERS', 'SECRETS', 'DATA'];

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Issue with the name of an output key (or a field), or null if it is fine. */
export function nameIssue(name: string): string | null {
  if (!name) return 'has no name';
  if (!IDENTIFIER.test(name)) return `"${name}" is not a valid name (letters, digits and _, not starting with a digit)`;
  if (RESERVED_NAMES.includes(name)) return `"${name}" is a reserved name`;
  return null;
}
