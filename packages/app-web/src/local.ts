// A folder on the reader's own computer, read in the browser.
//
// A web page cannot open a path it is given as text — `\\server\share\docs`
// or `file://` — so the reader hands the folder over themselves: picked with
// the folder dialog (Chrome, Edge), or dragged onto the page (every desktop
// browser). A shared folder on the company network can be handed over the
// same way, as long as the computer can see it. Nothing is sent anywhere and
// no server is involved (design/web-viewer.md §8).
//
// The two ways give two different objects — a FileSystemDirectoryHandle and a
// FileSystemDirectoryEntry — so both are turned into one small tree first.

import { dataUrl } from './hosts/index.js';
import type { FileSource } from './view.js';

/** One file or folder, whichever way it was handed over. */
export interface FolderNode {
  readonly name: string;
  readonly kind: 'file' | 'directory';
  /** What a folder holds. */
  children(): Promise<readonly FolderNode[]>;
  /** What a file holds. */
  file(): Promise<Blob>;
}

/** What a folder's `.git` says about the commit the files came from. */
export interface GitHead {
  readonly branch?: string;
  readonly sha?: string;
}

/** A folder read in: its files, and the commit it was checked out at when that can be told. */
export interface LocalFolder extends FileSource {
  readonly name: string;
  /** True when there were more files than were read. */
  readonly truncated: boolean;
  readonly git: GitHead;
}

/** Folders that hold no documents and can hold a great many files. */
const SKIPPED = new Set(['node_modules', '.git', '.svn', '.hg']);

/** Past this many files a folder is not a set of documents; stop and say so. */
export const MOST_LOCAL_FILES = 20_000;

/**
 * Reads the folder's file list. The files themselves are read when the
 * document asks for them, as the hosts' files are.
 */
export async function readFolder(
  root: FolderNode, progress?: (count: number) => void, most = MOST_LOCAL_FILES,
): Promise<LocalFolder> {
  const files = new Map<string, FolderNode>();
  let git: FolderNode | undefined;
  let truncated = false;

  const walk = async (folder: FolderNode, prefix: string): Promise<void> => {
    const children = await folder.children();
    const folders: Promise<void>[] = [];
    for (const child of children) {
      if (child.kind === 'directory') {
        if (prefix === '' && child.name === '.git') git = child;
        if (SKIPPED.has(child.name)) continue;
        folders.push(walk(child, `${prefix}${child.name}/`));
      } else if (files.size >= most) {
        truncated = true;
      } else {
        files.set(`${prefix}${child.name}`, child);
      }
    }
    progress?.(files.size);
    // Folders side by side are read side by side: over a network share each
    // listing is a round trip.
    await Promise.all(folders);
  };
  await walk(root, '');

  const paths = [...files.keys()].sort();
  const blob = (path: string): Promise<Blob | undefined> => {
    const node = files.get(path);
    return node ? node.file() : Promise.resolve(undefined);
  };
  return {
    name: root.name,
    paths,
    truncated,
    git: git ? await headOf(git).catch(() => ({})) : {},
    text: async path => (await blob(path))?.text(),
    image: async path => {
      const found = await blob(path);
      return found === undefined ? undefined : dataUrl(path, new Uint8Array(await found.arrayBuffer()));
    },
  };
}

/**
 * The branch and commit `.git` says the folder is at. Only what can be read
 * without Git: `HEAD`, the branch's ref file, or `packed-refs`. A `.git` that
 * is a file (a worktree, a submodule) points elsewhere, and says nothing here.
 */
export async function headOf(git: FolderNode): Promise<GitHead> {
  const head = (await textAt(git, ['HEAD']))?.trim();
  if (head === undefined) return {};
  const named = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  if (!named) return /^[0-9a-f]{40}$/i.test(head) ? { sha: head.toLowerCase() } : {};
  const branch = named[1]!;
  const loose = (await textAt(git, ['refs', 'heads', ...branch.split('/')]))?.trim();
  if (loose && /^[0-9a-f]{40}$/i.test(loose)) return { branch, sha: loose.toLowerCase() };
  const packed = await textAt(git, ['packed-refs']);
  const line = packed?.split(/\r?\n/).find(one => one.endsWith(` refs/heads/${branch}`));
  const sha = line?.slice(0, 40);
  return sha && /^[0-9a-f]{40}$/i.test(sha) ? { branch, sha: sha.toLowerCase() } : { branch };
}

async function textAt(folder: FolderNode, path: readonly string[]): Promise<string | undefined> {
  let here: FolderNode | undefined = folder;
  for (const [i, name] of path.entries()) {
    if (here?.kind !== 'directory') return undefined;
    here = (await here.children()).find(child => child.name === name);
    if (here === undefined || (i < path.length - 1 && here.kind !== 'directory')) return undefined;
  }
  return here?.kind === 'file' ? (await here.file()).text() : undefined;
}

// --- The two ways a folder is handed over ---------------------------------------

/** What the folder dialog and a Chromium drop give. */
interface DirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
}
interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

/** A folder from `showDirectoryPicker`, or from a drop in Chrome and Edge. */
export function nodeOfHandle(handle: DirectoryHandle | FileHandle): FolderNode {
  return {
    name: handle.name,
    kind: handle.kind,
    async children() {
      if (handle.kind !== 'directory') return [];
      const found: FolderNode[] = [];
      for await (const child of handle.values()) found.push(nodeOfHandle(child));
      return found;
    },
    file: () => (handle.kind === 'file' ? handle.getFile() : Promise.reject(new Error(`${handle.name} is a folder`))),
  };
}

/** What a drop gives in every browser (`webkitGetAsEntry`). */
interface Entry {
  readonly name: string;
  readonly isDirectory: boolean;
  createReader?(): { readEntries(done: (entries: Entry[]) => void, failed: (error: unknown) => void): void };
  file?(done: (file: File) => void, failed: (error: unknown) => void): void;
}

/** A folder dropped on the page. */
export function nodeOfEntry(entry: Entry): FolderNode {
  return {
    name: entry.name,
    kind: entry.isDirectory ? 'directory' : 'file',
    async children() {
      if (!entry.isDirectory || !entry.createReader) return [];
      const reader = entry.createReader();
      const found: FolderNode[] = [];
      // A reader hands its entries over in batches, until an empty one.
      for (;;) {
        const batch = await new Promise<Entry[]>((done, failed) => reader.readEntries(done, failed));
        if (batch.length === 0) return found;
        found.push(...batch.map(nodeOfEntry));
      }
    },
    file: () => new Promise<Blob>((done, failed) => {
      if (!entry.file) { failed(new Error(`${entry.name} is a folder`)); return; }
      entry.file(done, failed);
    }),
  };
}

// --- Remembering the folder (Chrome, Edge) ----------------------------------------
//
// A folder cannot travel in a link. What the browser can do is keep the
// handle, so that the next visit opens the same folder after one click on
// "allow" — the browser's own question, which the page cannot skip.

const DB = 'docpresenter-viewer';
const STORE = 'folders';
const LAST = 'last';

function database(win: Window): Promise<IDBDatabase> {
  return new Promise((done, failed) => {
    const request = win.indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => done(request.result);
    request.onerror = () => failed(request.error);
  });
}

/** Keeps the handle of the folder last opened. Quietly does nothing where it cannot. */
export async function rememberFolder(win: Window, handle: unknown): Promise<void> {
  try {
    const db = await database(win);
    await new Promise<void>((done, failed) => {
      const put = db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, LAST);
      put.onsuccess = () => done();
      put.onerror = () => failed(put.error);
    });
    db.close();
  } catch { /* Not kept: the reader picks the folder again next time. */ }
}

/** The handle of the folder last opened, if the browser kept one. */
export async function recallFolder(win: Window): Promise<(DirectoryHandle & PermissionAsking) | undefined> {
  try {
    const db = await database(win);
    const handle = await new Promise<unknown>((done, failed) => {
      const get = db.transaction(STORE, 'readonly').objectStore(STORE).get(LAST);
      get.onsuccess = () => done(get.result);
      get.onerror = () => failed(get.error);
    });
    db.close();
    return handle && typeof handle === 'object' && (handle as DirectoryHandle).kind === 'directory'
      ? handle as DirectoryHandle & PermissionAsking : undefined;
  } catch {
    return undefined;
  }
}

/** A kept handle asks again before it reads. */
export interface PermissionAsking {
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>;
}

/** Asks to read a kept folder again. Must run in a click: the browser asks the reader. */
export async function mayRead(handle: PermissionAsking): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  if (await handle.queryPermission({ mode: 'read' }) === 'granted') return true;
  return await handle.requestPermission({ mode: 'read' }) === 'granted';
}

/** The folder dialog, where the browser has one. */
export function folderPicker(win: Window): (() => Promise<DirectoryHandle>) | undefined {
  const pick = (win as Window & { showDirectoryPicker?: (options?: object) => Promise<DirectoryHandle> }).showDirectoryPicker;
  return typeof pick === 'function' ? () => pick.call(win, { mode: 'read', id: 'docpresenter' }) : undefined;
}

/**
 * The folder in a drop, taken while the drop event lasts (its items are gone
 * afterwards). A Chromium drop also gives a handle, which can be remembered.
 */
export function droppedFolder(event: DragEvent): { node: Promise<FolderNode | undefined>; handle: Promise<unknown> } | undefined {
  const item = [...(event.dataTransfer?.items ?? [])].find(one => one.kind === 'file');
  if (!item) return undefined;
  const asHandle = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle?.();
  const entry = item.webkitGetAsEntry() as Entry | null;
  const handle = (asHandle ?? Promise.resolve(undefined)).catch(() => undefined);
  const node = handle.then(found => {
    if (found && typeof found === 'object' && (found as DirectoryHandle).kind === 'directory') return nodeOfHandle(found as DirectoryHandle);
    return entry?.isDirectory ? nodeOfEntry(entry) : undefined;
  });
  return { node, handle };
}
