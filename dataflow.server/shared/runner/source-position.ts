/*
 * Where an error of a TypeScript component happened, in the code the user wrote: the runner runs a bundle (types
 * stripped, the scripts it imports inlined), so a stack names the bundle's lines. Its source map (Bun.build's) takes a
 * bundle position back to the component's code or the project script it is in.
 */

/** a source map as Bun.build writes it (version 3) */
export type SourceMap = { sources: string[]; mappings: string };

/** a position in the code as written: which source (as the map names it) and its line, from 1 */
export type SourcePosition = { source: string; line: number };

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** the numbers of a mapping segment (Base64 VLQ) */
function decodeSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) return values;
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

/** the original position of a bundle position (`line` from 1, `column` from 1, as a stack gives them), or null */
export function originalPosition(map: SourceMap, line: number, column: number): SourcePosition | null {
  const lines = map.mappings.split(';');
  let source = 0;
  let originalLine = 0;
  let found: SourcePosition | null = null;
  for (let l = 0; l < lines.length && l < line; l++) {
    let generatedColumn = 0;
    for (const segment of lines[l]!.split(',')) {
      const values = decodeSegment(segment);
      if (values.length < 4) continue;
      generatedColumn += values[0]!;
      source += values[1]!;
      originalLine += values[2]!;
      // on the error's line: the last segment that starts at or before its column (the first one when none does)
      if (l === line - 1 && (generatedColumn <= column - 1 || !found)) {
        found = { source: map.sources[source] ?? '', line: originalLine + 1 };
      }
    }
  }
  return found;
}

/** the first frame of a stack in the bundle (`(component.ts:LINE:COL)`), as numbers */
export function bundleFrame(stack: string, filename: string): { line: number; column: number } | null {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}:(\\d+):(\\d+)`).exec(stack);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : null;
}
