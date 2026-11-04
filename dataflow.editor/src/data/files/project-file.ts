/*
 * A project's Files: blob storage. People upload files and flows read them; flows can also write files here. A file
 * is a path ("reports/2026/sales.csv"): the folders are the parts before the last "/". Empty folders are kept apart
 * (a folder exists once it is created, even before it holds a file).
 */

export type FileSource = 'upload' | { flowId: string; flowName: string };

export type FileEntry = {
  /** "folder/sub/name.ext", never starting or ending with "/" */
  path: string;
  size: number;
  contentType: string;
  createdAt: Date;
  createdBy: string;
  source: FileSource;
};

/** everything stored: the files and every folder path (created ones and those implied by files) */
export type FilesListing = { files: FileEntry[]; folders: string[] };

export const NAME_MAX = 255;

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/** a file or folder name's error: required, no "/", not "." or "..", at most 255 characters */
export function nameError(name: string): string | undefined {
  if (name.trim() === '') {
    return 'Required';
  }

  if (name.includes('/') || name.includes('\\')) {
    return 'No "/" or "\\"';
  }

  if (name === '.' || name === '..') {
    return 'Not a valid name';
  }

  return name.length > NAME_MAX ? `At most ${NAME_MAX} characters` : undefined;
}

/** every folder path the listing implies: created folders, and each parent of each file */
export function allFolders(listing: FilesListing): string[] {
  const folders = new Set(listing.folders);
  for (const file of listing.files) {
    for (let parent = parentOf(file.path); parent; parent = parentOf(parent)) {
      folders.add(parent);
    }
  }

  return [...folders];
}

/** what is directly inside a folder ("" = the root): its folders' names and its files, each by name */
export function contentsOf(listing: FilesListing, folder: string): { folders: string[]; files: FileEntry[] } {
  const compare = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  return {
    folders: allFolders(listing).filter(f => parentOf(f) === folder).map(fileName).sort(compare),
    files: listing.files.filter(f => parentOf(f.path) === folder).sort((a, b) => compare(fileName(a.path), fileName(b.path))),
  };
}

/** "0 B", "1.5 KB", "12 MB" */
export function humanSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
