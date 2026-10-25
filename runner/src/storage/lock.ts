import {readFileSync, unlinkSync, writeFileSync} from 'node:fs';

/*
 * One process at a time on the local database folder (PGlite): two of them writing the same files corrupt it.
 * Opening writes `<folder>.lock` with the PID and the start time; another live process holding it is an error that
 * names it; a lock left by a process that is gone (killed, crashed) is taken over. The clean close removes it.
 * Not used with DATABASE_URL: a real Postgres has its own locking.
 */

type Lock = {pid: number; startedAt: string};

/** whether the process exists (on Windows a PID can be reused, so a lock naming a live process is never taken over) */
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as {code?: string}).code === 'EPERM';
  }
}

function read(file: string): Lock | null {
  try {
    const lock = JSON.parse(readFileSync(file, 'utf8')) as Lock;
    return Number.isInteger(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}

export const lockFile = (folder: string) => `${folder.replace(/[\\/]+$/, '')}.lock`;

/** Takes the folder for this process; throws if another live process has it. Returns the function that releases it. */
export function lockFolder(folder: string, log: (message: string) => void = console.log): () => void {
  const file = lockFile(folder);
  const mine: Lock = {pid: process.pid, startedAt: new Date().toISOString()};
  for (let attempt = 0; attempt < 2; attempt++) {
    const held = read(file);
    if (held && held.pid !== process.pid && alive(held.pid)) {
      throw new Error(`${folder} is in use by another process (PID ${held.pid}, since ${held.startedAt}). Stop it first; `
        + `if that process is not a runner, delete ${file}.`);
    }
    if (held && held.pid !== process.pid) log(`Taking over the lock of ${folder} left by PID ${held.pid} (no longer running).`);
    try {
      if (held) unlinkSync(file);
      // wx: if another process took it between the read and here, this fails and the loop reads again
      writeFileSync(file, JSON.stringify(mine), {flag: 'wx'});
      return () => {
        if (read(file)?.pid === process.pid) {
          try {
            unlinkSync(file);
          } catch {
            // already gone
          }
        }
      };
    } catch (e) {
      if ((e as {code?: string}).code !== 'EEXIST' && (e as {code?: string}).code !== 'ENOENT') throw e;
    }
  }
  throw new Error(`Could not take the lock of ${folder} (${file}).`);
}
