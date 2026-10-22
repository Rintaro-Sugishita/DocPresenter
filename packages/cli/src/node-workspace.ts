// The build's workspace over a folder on disk, and what Git says about it.
//
// The build never opens a file itself (it runs in a browser too); this is the
// Node side of it, as tools/build.mjs has it.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { Workspace } from '@docpresenter/build';
import { listFiles } from '@docpresenter/dgm';

const BINARY = /\.(png|jpe?g|gif|webp)$/i;
const MEDIA: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

export function nodeWorkspace(root: string, fetched?: (address: string, bytes: number) => void): Workspace {
  const files = listFiles(root);
  const inside = (path: string) => join(root, path);
  return {
    list: () => files,
    read(path) {
      try {
        if (BINARY.test(path)) return undefined;   // binaries travel as data URLs
        if (!statSync(inside(path)).isFile()) return undefined;
        return readFileSync(inside(path), 'utf8');
      } catch { return undefined; }
    },
    dataUrl(path) {
      const type = MEDIA[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];
      if (!type) return undefined;
      try {
        return `data:${type};base64,${readFileSync(inside(path)).toString('base64')}`;
      } catch { return undefined; }
    },
    // A picture on the web goes into the artifact, never into the workspace:
    // a delivered file does not reach out (packages/build/src/workspace.ts).
    async inline(address) {
      const response = await fetch(address, { redirect: 'follow' });
      if (!response.ok) return undefined;
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!Object.values(MEDIA).includes(type)) return undefined;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) return undefined;
      fetched?.(address, bytes.length);
      return `data:${type};base64,${bytes.toString('base64')}`;
    },
  };
}

/**
 * The other version to mark changes against: a folder is read straight,
 * anything else is asked of Git, from the root.
 */
export function previousVersion(root: string, from: string, cwd = process.cwd()):
  { readonly name: string; readonly read: (path: string) => string | undefined } {
  const folder = isAbsolute(from) ? from : resolve(cwd, from);
  let isFolder = false;
  try { isFolder = statSync(folder).isDirectory(); } catch { isFolder = false; }
  if (isFolder) {
    return {
      name: from,
      read: path => { try { return readFileSync(join(folder, path), 'utf8'); } catch { return undefined; } },
    };
  }
  return {
    name: from,
    read: path => {
      const shown = spawnSync('git', ['show', `${from}:./${path}`], { cwd: root, encoding: 'utf8' });
      return shown.status === 0 ? shown.stdout : undefined;
    },
  };
}

/** The commit the root is at, and whether the root's files are that commit. */
export function gitState(root: string): { commit?: string; clean?: boolean } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    try {
      const status = execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { commit, clean: status.trim() === '' };
    } catch { return { commit }; }
  } catch { return {}; }
}
