import { expect, test } from 'bun:test';
import { flowPath, projectPath, PROJECTS_PATH } from '../src/app/paths';

test('the app URLs live under /projects', () => {
  expect(PROJECTS_PATH).toBe('/projects');
  expect(projectPath('p1')).toBe('/projects/p1/flows');
  expect(projectPath('p1', 'f9')).toBe('/projects/p1/flows?folder=f9');
  expect(flowPath('p1', 'w2')).toBe('/projects/p1/flows/w2');
});
