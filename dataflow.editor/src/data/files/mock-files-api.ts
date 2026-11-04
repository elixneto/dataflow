import { mockUser } from '@/auth/mock-user';
import { failure, later, ok } from '@/data/mock-api';
import type { ApiResult } from '@/lib/api';
import { allFolders, contentsOf, fileName, join, nameError, parentOf, type FileEntry, type FilesListing } from './project-file';

/*
 * MOCK: a project's Files in this tab's memory until dataflow.server stores them (same answers as the future api).
 * Only the name, size and type of an upload are kept, not its content, so Download waits for the server.
 * Uploading a file with a name already in that folder replaces it (blob storage: the newest wins).
 */

const DAY = 24 * 60 * 60 * 1000;
const byProject = new Map<string, FilesListing>();

function listingOf(projectId: string): FilesListing {
  let listing = byProject.get(projectId);
  if (!listing) {
    const file = (path: string, size: number, contentType: string, days: number, source: FileEntry['source'] = 'upload'): FileEntry => ({
      path,
      size,
      contentType,
      createdAt: new Date(Date.now() - days * DAY),
      createdBy: source === 'upload' ? 'ana' : 'flow',
      source,
    });
    listing = {
      folders: ['inbox'],
      files: [
        file('partners/prices.csv', 48_213, 'text/csv', 6),
        file('partners/catalog.json', 1_204_331, 'application/json', 9),
        file('reports/2026-11/daily-sales.csv', 12_877, 'text/csv', 0.1, { flowId: 'sample', flowName: 'Daily report' }),
        file('readme.txt', 812, 'text/plain', 30),
      ],
    };
    byProject.set(projectId, listing);
  }

  return listing;
}

const copy = (listing: FilesListing): FilesListing => ({ folders: [...listing.folders], files: listing.files.map(f => ({ ...f })) });

const folderExists = (listing: FilesListing, folder: string) => folder === '' || allFolders(listing).includes(folder);

/** everything stored in the project's Files */
export function listFiles(projectId: string): Promise<ApiResult<FilesListing>> {
  return later(ok(copy(listingOf(projectId))));
}

/** uploads files into a folder; a file with the same name there is replaced */
export function uploadFiles(projectId: string, folder: string, uploads: { name: string; size: number; type: string }[]): Promise<ApiResult<{ paths: string[] }>> {
  const listing = listingOf(projectId);
  if (!folderExists(listing, folder)) {
    return later(failure('not-found', 'Folder not found.'));
  }

  const invalid = uploads.find(u => nameError(u.name));
  if (invalid) {
    return later(failure('validation', `"${invalid.name}": ${nameError(invalid.name)}.`));
  }

  const paths = uploads.map(upload => {
    const path = join(folder, upload.name);
    listing.files = listing.files.filter(f => f.path !== path);
    listing.files.push({
      path,
      size: upload.size,
      contentType: upload.type || 'application/octet-stream',
      createdAt: new Date(),
      createdBy: mockUser.id,
      source: 'upload',
    });
    return path;
  });

  return later(ok({ paths }), 400);
}

/** a new, empty folder; its name must not be taken by a folder or file next to it */
export function createFileFolder(projectId: string, parent: string, name: string): Promise<ApiResult<{ path: string }>> {
  const listing = listingOf(projectId);
  const error = nameError(name);
  if (error) {
    return later(failure('validation', 'The request has invalid fields.', { name: error }));
  }

  const here = contentsOf(listing, parent);
  const taken = [...here.folders, ...here.files.map(f => fileName(f.path))];
  if (taken.some(n => n.toLowerCase() === name.trim().toLowerCase())) {
    return later(failure('conflict', 'The request has invalid fields.', { name: 'Already in use' }));
  }

  const path = join(parent, name.trim());
  listing.folders.push(path);
  return later(ok({ path }));
}

export function deleteFile(projectId: string, path: string): Promise<ApiResult<{ path: string }>> {
  const listing = listingOf(projectId);
  if (!listing.files.some(f => f.path === path)) {
    return later(failure('not-found', 'File not found.'));
  }

  listing.files = listing.files.filter(f => f.path !== path);
  // the folder it was in stays, even if empty now
  const parent = parentOf(path);
  if (parent && !listing.folders.includes(parent)) {
    listing.folders.push(parent);
  }

  return later(ok({ path }));
}

/** deletes the folder and everything in it */
export function deleteFileFolder(projectId: string, path: string): Promise<ApiResult<{ path: string }>> {
  const listing = listingOf(projectId);
  if (!path || !folderExists(listing, path)) {
    return later(failure('not-found', 'Folder not found.'));
  }

  const inside = (p: string) => p === path || p.startsWith(`${path}/`);
  listing.files = listing.files.filter(f => !inside(f.path));
  listing.folders = listing.folders.filter(f => !inside(f));
  return later(ok({ path }));
}
