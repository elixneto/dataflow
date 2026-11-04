import {expect, test} from 'bun:test';
import {canMoveFolder, childrenOf, folderPath, isFolderVisible, itemCount, siblingNames, subtreeIds, validateName, type TreeFolder} from '../../src/folders/folder-tree';

const folder = (id: string, parentId: string | null, archivedAt: Date | null = null): TreeFolder => ({id, parentId, name: id, archivedAt});

// a > b > c, and d at the root
const folders = [folder('a', null), folder('b', 'a'), folder('c', 'b'), folder('d', null)];

test('names: trimmed, required, at most 100 characters, unique among siblings ignoring case', () => {
  expect(validateName('  Import  ', [])).toEqual({value: 'Import'});
  expect(validateName('   ', []).error).toBe('Required');
  expect(validateName('x'.repeat(101), []).error).toBe('At most 100 characters');
  expect(validateName('IMPORT', [{name: 'import'}]).error).toBe('Already in use');
});

test('a folder path goes from the root down; the root has none', () => {
  expect(folderPath(folders, 'c').map(f => f.id)).toEqual(['a', 'b', 'c']);
  expect(folderPath(folders, null)).toEqual([]);
  expect([...subtreeIds(folders, 'a')].sort()).toEqual(['a', 'b', 'c']);
});

test('a folder cannot move into itself or anything under it', () => {
  expect(canMoveFolder(folders, 'a', 'a')).toBe(false);
  expect(canMoveFolder(folders, 'a', 'c')).toBe(false);
  expect(canMoveFolder(folders, 'c', 'a')).toBe(true);
  expect(canMoveFolder(folders, 'b', null)).toBe(true);
  expect(canMoveFolder(folders, 'b', 'missing')).toBe(false);
});

test('an archived folder hides everything under it', () => {
  const archived = folders.map(f => (f.id === 'a' ? {...f, archivedAt: new Date()} : f));

  expect(isFolderVisible(archived, 'c')).toBe(false);
  expect(isFolderVisible(archived, 'd')).toBe(true);
  expect(isFolderVisible(archived, null)).toBe(true);
  expect(canMoveFolder(archived, 'd', 'b')).toBe(false);
});

test('children and siblings: only active items in the same folder, by name, without the one renamed', () => {
  const contents = {
    folders,
    flows: [
      {id: 'f1', folderId: 'a', name: 'Zeta', archivedAt: null},
      {id: 'f2', folderId: 'a', name: 'alpha', archivedAt: null},
      {id: 'f3', folderId: 'a', name: 'Old', archivedAt: new Date()},
    ],
  };

  expect(childrenOf(contents, 'a').flows.map(f => f.name)).toEqual(['alpha', 'Zeta']);
  expect(itemCount(contents, 'a')).toBe(3);
  expect(siblingNames(contents, 'folder', null).map(f => f.name)).toEqual(['a', 'd']);
  expect(siblingNames(contents, 'flow', 'a', 'f1').map(f => f.name)).toEqual(['alpha']);
});
