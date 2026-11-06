import {expect, test} from 'bun:test';
import {movedScriptPath, normalizeScriptPath, scriptImport, scriptImports, scriptModuleUri, scriptPathIssue} from '../../src/index';

test('a script path: folders and a name, each letters, numbers, - and _', () => {
  for (const ok of ['types', 'upload/types', 'apis/assets/client-v2', 'a_b/C9']) expect(scriptPathIssue(ok)).toBeNull();
  expect(scriptPathIssue('')).toBe('The path is empty.');
  expect(scriptPathIssue('upload//types')).toBe('The path has an empty folder (two slashes together).');
  expect(scriptPathIssue('upload/my types')).toContain('"my types" is not a valid name');
  expect(scriptPathIssue('-x')).toContain('starting with a letter or a number');
  expect(scriptPathIssue('a/../b')).toContain('".." is not a valid name');
  expect(scriptPathIssue('x'.repeat(201))).toContain('longer than 200');
});

test('what is typed becomes the path: no slashes at the ends, no .ts, forward slashes', () => {
  expect(normalizeScriptPath('  /upload\\types.ts/ ')).toBe('upload/types');
});

test('the import and the module of a script; the scripts some code imports', () => {
  expect(scriptImport('upload/types')).toBe('@myproject/scripts/upload/types');
  expect(scriptModuleUri('upload/types')).toBe('file:///myproject/scripts/upload/types.ts');
  const code = `import {type A} from '@myproject/scripts/upload/types';
import * as c from "@myproject/scripts/apis/client";
import '@myproject/scripts/setup';
const later = await import('@myproject/scripts/upload/types');
import {x} from './not-a-script';`;
  expect(scriptImports(code)).toEqual(['upload/types', 'apis/client', 'setup']);
});

test('a rename or a move of a folder takes what is inside it', () => {
  expect(movedScriptPath('upload/types', 'upload', 'files/upload')).toBe('files/upload/types');
  expect(movedScriptPath('upload', 'upload', 'transfer')).toBe('transfer');
  expect(movedScriptPath('uploads/types', 'upload', 'x')).toBe('uploads/types');
});

test('what a script exports (to offer it for import), and the import line', async () => {
  const {scriptExports, scriptImportLine} = await import('../../src/index');
  const code = `export interface IUploadInitResponse { file: string }
export type Id = string;
export async function uploadIdOf(r: IUploadInitResponse) { return r.file; }
export const LIMIT = 10;
export class Client {}
function hidden() {}
const a = 1, b = 2;
export { a, b as bee };
export type { Other } from './elsewhere';`;
  expect(scriptExports(code)).toEqual([
    {name: 'IUploadInitResponse', typeOnly: true},
    {name: 'Id', typeOnly: true},
    {name: 'uploadIdOf', typeOnly: false, function: true},
    {name: 'LIMIT', typeOnly: false},
    {name: 'Client', typeOnly: false},
    {name: 'a', typeOnly: false},
    {name: 'bee', typeOnly: false},
  ]);
  expect(scriptImportLine('upload/types', 'IUploadInitResponse', true)).toBe("import type { IUploadInitResponse } from '@myproject/scripts/upload/types';");
  expect(scriptImportLine('upload/types', 'uploadIdOf', false)).toBe("import { uploadIdOf } from '@myproject/scripts/upload/types';");
});

test('the names some code already has (imported or declared): another import of one would clash', async () => {
  const {boundNames} = await import('../../src/index');
  const code = `import type { IUploadInitResponse, Other as Renamed } from '@myproject/scripts/upload/types';
import Default, * as All from '@myproject/scripts/x';
import { type Kind } from '@myproject/scripts/kinds';
interface Local {}
const limit = 1;
async function process($input: Data) { return null; }`;
  const names = boundNames(code);
  for (const name of ['IUploadInitResponse', 'Renamed', 'Default', 'All', 'Kind', 'Local', 'limit', 'process']) expect(names.has(name)).toBe(true);
  expect(names.has('Other')).toBe(false);
  expect(names.has('IItem')).toBe(false);
});

test('a script is at most 1 MB', async () => {
  const {MAX_SCRIPT_BYTES, scriptContentIssue} = await import('../../src/index');
  expect(scriptContentIssue('export const a = 1;')).toBeNull();
  expect(scriptContentIssue('x'.repeat(MAX_SCRIPT_BYTES))).toBeNull();
  expect(scriptContentIssue('é'.repeat(MAX_SCRIPT_BYTES / 2 + 1))).toBe('The script takes 1.0 MB (at most 1 MB).');
});

test('the scripts some code needs: what it imports and, through them, what they import; what is missing and who wants it', async () => {
  const {scriptClosure} = await import('../../src/index');
  const scripts = {
    'upload/types': `export interface A {}`,
    'upload/headers': `import type { A } from '@myproject/scripts/upload/types';\nimport { x } from '@myproject/scripts/gone';`,
    'loop/a': `import '@myproject/scripts/loop/b';`,
    'loop/b': `import '@myproject/scripts/loop/a';`,
    'unused/big': `export const big = 1;`,
  };
  const code = `import { h } from '@myproject/scripts/upload/headers';\nimport '@myproject/scripts/loop/a';\nimport '@myproject/scripts/nope';`;
  expect(scriptClosure(code, scripts)).toEqual({
    paths: ['loop/a', 'loop/b', 'upload/headers', 'upload/types'],
    missing: [{from: 'upload/headers', path: 'gone'}, {from: null, path: 'nope'}],
  });
  expect(scriptClosure('async function process() {}', scripts)).toEqual({paths: [], missing: []});
});
