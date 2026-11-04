import { expect, test } from 'bun:test';
import {
  createFolder,
  createScript,
  deleteScriptPath,
  newPathIssue,
  projectScripts,
  renameScriptPath,
  saveScript,
  scriptFolders,
} from '../src/data/scripts/scripts-mock';

const paths = (projectId: string) => projectScripts(projectId).scripts.map(s => s.path);

test("the mock of a project's scripts (until the server keeps them): the core's path rules, nested folders", () => {
  const project = 'p-scripts-test';
  // the example the project starts with: an interface and a helper, and a script that imports it
  expect(paths(project)).toEqual(['upload/headers', 'upload/types']);
  expect(projectScripts(project).scripts[0]!.code).toContain("from '@myproject/scripts/upload/types'");

  expect(newPathIssue(project, 'upload/types')).toBe('A script with this path already exists.');
  expect(newPathIssue(project, 'upload')).toBe('A folder with this path already exists.');
  expect(newPathIssue(project, 'upload/types/inner')).toBe('A script cannot hold other scripts: pick another folder.');
  expect(newPathIssue(project, 'bad name')).toContain('is not a valid name');
  expect(newPathIssue(project, '/apis/assets/client.ts')).toBeNull();

  expect(createScript(project, '/apis/assets/client.ts')).toBe('apis/assets/client');
  createFolder(project, 'empty/inner');
  expect(scriptFolders(projectScripts(project))).toEqual(['apis', 'apis/assets', 'empty', 'empty/inner', 'upload']);
  saveScript(project, 'apis/assets/client', 'export const x = 1;');
  expect(projectScripts(project).scripts.find(s => s.path === 'apis/assets/client')!.code).toBe('export const x = 1;');
});

test('a folder renamed (moved) takes its scripts and folders; deleted, everything in it goes', () => {
  const project = 'p-scripts-move';
  createScript(project, 'apis/assets/client');
  createFolder(project, 'apis/empty');
  expect(renameScriptPath(project, 'apis', 'services/http')).toBe('services/http');
  expect(paths(project)).toEqual(['services/http/assets/client', 'upload/headers', 'upload/types']);
  expect(projectScripts(project).folders).toEqual(['services/http/empty']);

  deleteScriptPath(project, 'services');
  expect(paths(project)).toEqual(['upload/headers', 'upload/types']);
  expect(projectScripts(project).folders).toEqual([]);
});
