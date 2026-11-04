/*
 * A project's scripts: TypeScript modules in folders (nested), that a TypeScript component (or another script) imports
 * by their path: `import {...} from '@myproject/scripts/upload/types'`. The path is the folders and the name, without
 * `.ts`; each part letters, numbers, `-` and `_`. One source of truth for the editor (the Scripts tab, Monaco) and the
 * runner (resolving the imports).
 */

/** where the project's scripts live for the TypeScript tools (Monaco, the runner's bundle): their one name, change it here */
export const SCRIPT_MODULE_DIR = 'myproject/scripts';

/** what an import starts with to name a project script */
export const SCRIPT_IMPORT_PREFIX = `@${SCRIPT_MODULE_DIR}/`;

/** the longest a path may be (all its parts) */
export const MAX_SCRIPT_PATH = 200;

const PART = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** what is typed for a path, as the path: no spaces around, no slashes at the ends, no `.ts` */
export const normalizeScriptPath = (text: string): string =>
  text
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.ts$/i, '');

/** What is wrong with a script's (or a folder's) path, or null. */
export function scriptPathIssue(path: string): string | null {
  if (!path) return 'The path is empty.';
  if (path.length > MAX_SCRIPT_PATH) return `The path is longer than ${MAX_SCRIPT_PATH} characters.`;
  const bad = path.split('/').find(part => !PART.test(part));
  if (bad !== undefined) {
    return bad === ''
      ? 'The path has an empty folder (two slashes together).'
      : `"${bad}" is not a valid name: use letters, numbers, - and _ (starting with a letter or a number).`;
  }
  return null;
}

/** the import that names a script: '@myproject/scripts/upload/types' */
export const scriptImport = (path: string) => `${SCRIPT_IMPORT_PREFIX}${path}`;

/** where the script lives for the TypeScript tools (Monaco's model, the runner's bundle) */
export const scriptModuleUri = (path: string) => `file:///${SCRIPT_MODULE_DIR}/${path}.ts`;

/** the prefix as it is written in a regular expression */
const PREFIX_PATTERN = SCRIPT_IMPORT_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** the paths of the project scripts some code imports (`from '@myproject/scripts/...'`, `import('@myproject/scripts/...')`) */
export function scriptImports(code: string): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])` + PREFIX_PATTERN + String.raw`([^'"]+)\1`, 'g');
  for (const match of code.matchAll(pattern)) found.add(match[2]!);
  return [...found];
}

/** whether `path` is `folder` or inside it */
export const insideScriptFolder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** `path` moved from the folder (or script) `from` to `to` (a rename or a move); unchanged when it is not inside */
export const movedScriptPath = (path: string, from: string, to: string) => (insideScriptFolder(path, from) ? `${to}${path.slice(from.length)}` : path);

/** a name a script exports; `typeOnly`: an interface or a type (imported with `import type`) */
export type ScriptExport = {name: string; typeOnly: boolean};

/** The names a script exports (`export interface X`, `export function y`...): what the editor offers to import. */
export function scriptExports(code: string): ScriptExport[] {
  const found = new Map<string, ScriptExport>();
  const pattern = /^[ \t]*export[ \t]+(?:declare[ \t]+)?(interface|type|(?:async[ \t]+)?function\*?|const|let|var|(?:abstract[ \t]+)?class|enum)[ \t]+([A-Za-z_$][\w$]*)/gm;
  for (const match of code.matchAll(pattern)) {
    const name = match[2]!;
    if (!found.has(name)) found.set(name, {name, typeOnly: match[1] === 'interface' || match[1] === 'type'});
  }
  // export { a, b as c } (not re-exports from elsewhere: those are another script's)
  for (const match of code.matchAll(/^[ \t]*export[ \t]+(type[ \t]+)?\{([^}]*)\}(?![ \t]*from)/gm)) {
    for (const part of match[2]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).at(-1)?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name) && !found.has(name)) found.set(name, {name, typeOnly: Boolean(match[1])});
    }
  }
  return [...found.values()];
}

/** the import line that brings `name` from a script */
export const scriptImportLine = (path: string, name: string, typeOnly: boolean) =>
  `import ${typeOnly ? 'type ' : ''}{ ${name} } from '${scriptImport(path)}';`;

/**
 * The names some code already has: imported (`import {a, b as c}`, `import d`, `import * as e`) or declared
 * (`interface`, `type`, `function`, `class`, `enum`, `const`/`let`/`var`). An import of another one with the same name
 * would clash: the editor does not offer it.
 */
export function boundNames(code: string): Set<string> {
  const names = new Set<string>();
  const id = String.raw`[A-Za-z_$][\w$]*`;
  for (const match of code.matchAll(/^[ \t]*import\s+(?:type\s+)?([^'";]*?)\s+from\s*['"][^'"]+['"]/gm)) {
    const clause = match[1]!;
    const braces = /\{([^}]*)\}/.exec(clause);
    for (const part of braces?.[1]?.split(',') ?? []) {
      const name = part.replace(/^\s*type\s+/, '').trim().split(/\s+as\s+/).at(-1)?.trim();
      if (name && new RegExp(`^${id}$`).test(name)) names.add(name);
    }
    // the default import and `* as name`, outside the braces
    const outside = clause.replace(/\{[^}]*\}/, '');
    for (const name of outside.matchAll(new RegExp(id, 'g'))) {
      if (name[0] !== 'type' && name[0] !== 'as') names.add(name[0]);
    }
  }
  const declared = new RegExp(String.raw`\b(?:interface|type|(?:async\s+)?function\*?|class|enum|const|let|var)\s+(` + id + ')', 'g');
  for (const match of code.matchAll(declared)) names.add(match[1]!);
  return names;
}
