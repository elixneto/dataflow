import {afterAll, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {lockFile, lockFolder} from '../../src/storage/lock';

// always in a temporary folder of the system, never runner/data.local
const root = mkdtempSync(join(tmpdir(), 'dataflow-lock-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));

/** a PID that no process has */
const DEAD_PID = 2_147_483_646;

test('the lock is taken with the PID and released on close', () => {
  const folder = join(root, 'a');
  const release = lockFolder(folder, () => undefined);
  expect(JSON.parse(readFileSync(lockFile(folder), 'utf8')).pid).toBe(process.pid);
  // the same process opening again (e.g. after a failed open) is not blocked by itself
  lockFolder(folder, () => undefined)();
  release();
  expect(existsSync(lockFile(folder))).toBe(false);
});

test('another live process holding the folder is an error that names it', () => {
  const folder = join(root, 'b');
  writeFileSync(lockFile(folder), JSON.stringify({pid: process.ppid, startedAt: '2026-10-25T10:00:00.000Z'}));
  expect(() => lockFolder(folder, () => undefined)).toThrow(`PID ${process.ppid}`);
  // the other process's lock stays
  expect(JSON.parse(readFileSync(lockFile(folder), 'utf8')).pid).toBe(process.ppid);
});

test('a lock left by a process that is gone is taken over', () => {
  const folder = join(root, 'c');
  writeFileSync(lockFile(folder), JSON.stringify({pid: DEAD_PID, startedAt: '2026-10-25T10:00:00.000Z'}));
  const logs: string[] = [];
  const release = lockFolder(folder, m => logs.push(m));
  expect(logs).toEqual([`Taking over the lock of ${folder} left by PID ${DEAD_PID} (no longer running).`]);
  expect(JSON.parse(readFileSync(lockFile(folder), 'utf8')).pid).toBe(process.pid);
  release();
  // an unreadable lock file counts as no lock
  writeFileSync(lockFile(folder), 'not json');
  lockFolder(folder, () => undefined)();
  expect(existsSync(lockFile(folder))).toBe(false);
});
