// Where the work is: the workspace root, and the files a command was pointed at.
//
// Even one file needs its root. A drawing's parts are found from it, a
// document's `{{root}}`, its number and its review files from the root — so the
// root is found by walking up from what was named, the way Git finds its own.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { CliError } from './errors.js';

/** Folders never walked into: tools', Git's, and where exports go. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'out']);

/** A file a command works on. */
export interface Target {
  /** Absolute, as the machine names it. */
  readonly file: string;
  /** From the root, with `/`. */
  readonly path: string;
  /** Named on the command line itself, rather than found in a folder. */
  readonly named: boolean;
}

/**
 * The workspace root: `--root` when given; otherwise, walking up from the
 * first path named (or the current folder), the nearest folder with a
 * `.docpresenter/`, else the nearest with a `.git`, else the current folder.
 */
export function findRoot(given: string | undefined, paths: readonly string[], cwd = process.cwd()): string {
  if (given !== undefined) {
    const root = resolve(cwd, given);
    if (!isDirectory(root)) throw new CliError('usage', 'cli.rootMissing', { path: given });
    return root;
  }
  const first = paths[0] === undefined ? cwd : resolve(cwd, paths[0]);
  const start = isDirectory(first) ? first : dirname(first);
  return nearest(start, '.docpresenter') ?? nearest(start, '.git') ?? cwd;
}

function nearest(start: string, marker: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, marker))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * The files the paths name, those a folder holds found by walking it. Only
 * files `wanted` accepts are kept from a folder; a file named directly is kept
 * whatever it is, and the command says what it makes of it. Nothing named
 * means the whole root. A path outside the root, or not there, is a mistake.
 */
export function collectTargets(
  paths: readonly string[], root: string, wanted: (path: string) => boolean, cwd = process.cwd(),
): Target[] {
  const found = new Map<string, Target>();
  const add = (file: string, named: boolean): void => {
    const path = relative(root, file).split('\\').join('/');
    const before = found.get(path);
    if (before === undefined || (named && !before.named)) found.set(path, { file, path, named });
  };
  for (const given of paths.length > 0 ? paths : [root]) {
    const file = resolve(cwd, given);
    if (!existsSync(file)) throw new CliError('usage', 'cli.pathMissing', { path: given });
    const from = relative(root, file);
    if (from.startsWith('..') || isAbsolute(from)) {
      throw new CliError('usage', 'cli.outsideRoot', { path: given, root });
    }
    if (isDirectory(file)) {
      walk(file, inside => { if (wanted(relative(root, inside).split('\\').join('/'))) add(inside, false); });
    } else {
      add(file, true);
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Every file under the root, from it, with `/` — what a build reads. */
export function listFiles(root: string): string[] {
  const files: string[] = [];
  walk(root, file => files.push(relative(root, file).split('\\').join('/')));
  return files.sort();
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, visit);
    else if (entry.isFile()) visit(path);
  }
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}
