/** a place in the run panel's JSON tree: keys and array indexes from the list of envelopes down */
export type Path = (string | number)[];

/** children shown at a time in a long array or object */
export const PAGE = 100;

/**
 * A path inside an envelope as an expression: its first key is `$key`, then `.name` or `["odd name"]` or `[0]`. The
 * envelope's own index (the list of envelopes) is not part of it.
 */
export function expressionPath(path: Path): string {
  const [, first, ...rest] = path;
  if (first === undefined) {
    return '$';
  }

  const head = typeof first === 'string' && /^[A-Za-z_]\w*$/.test(first) ? `$${first}` : `$[${JSON.stringify(first)}]`;
  return rest.reduce<string>(
    (text, part) => text + (typeof part === 'number' ? `[${part}]` : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`),
    head,
  );
}

/** `{…} 12 keys`, `[…] 1 item` */
export function summaryOf(value: object): string {
  const n = Array.isArray(value) ? value.length : Object.keys(value).length;
  return Array.isArray(value) ? `[…] ${n} item${n === 1 ? '' : 's'}` : `{…} ${n} key${n === 1 ? '' : 's'}`;
}
