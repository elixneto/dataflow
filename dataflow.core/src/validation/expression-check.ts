import {toError} from '#errors/normalize-error';

/** Text inside quotes or backticks: a "$x" there is text, not a variable. */
const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
const VARIABLE = /\$[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Syntax error of an expression, or null. Only compiles it (the function is never called), so it runs nothing:
 * safe in the editor, without the runner.
 */
export function expressionSyntaxError(expression: string): string | null {
  if (!expression.trim()) return null;
  try {
    new Function(`return (${expression}\n);`);
    return null;
  } catch (e) {
    return toError(e).message;
  }
}

/** The `$variables` an expression uses (only the root: `$customer.name` → `$customer`), outside strings. */
export function usedVariables(expression: string): string[] {
  return [...new Set(expression.replace(STRINGS, '').match(VARIABLE) ?? [])];
}

/** Variables the expression uses that are not among the known ones (paths: only their root counts). */
export function unknownVariables(expression: string, known: string[]): string[] {
  const roots = new Set(known.map(path => path.split('.')[0]));
  return usedVariables(expression).filter(name => !roots.has(name));
}
