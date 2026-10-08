// The workspace, as the build sees it.
//
// `@docpresenter/build` never opens a file — it is handed a workspace — so
// both the build command and the export buttons read the folder once, here,
// over `vscode.workspace.fs`, and hand the same shape to the same build.

import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import type { Workspace } from '@docpresenter/build';

const MEDIA: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
const IGNORED = '**/{node_modules,out,dist,.git}/**';

export interface ReadWorkspace {
  readonly workspace: Workspace;
  /** Every text file, by workspace path — the build's own view of the folder. */
  readonly text: ReadonlyMap<string, string>;
}

export async function readWorkspace(): Promise<ReadWorkspace> {
  const uris = await vscode.workspace.findFiles('**/*', IGNORED);
  const text = new Map<string, string>();
  const data = new Map<string, string>();
  for (const uri of uris) {
    const path = vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (MEDIA[extension]) {
      data.set(path, `data:${MEDIA[extension]};base64,${Buffer.from(bytes).toString('base64')}`);
    } else {
      try { text.set(path, new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { /* 2 進のものは文書に出ない */ }
    }
  }
  return {
    text,
    workspace: {
      list: () => [...text.keys(), ...data.keys()],
      read: path => text.get(path),
      dataUrl: path => data.get(path),
    },
  };
}

/**
 * The commit the folder is at, and whether its files are that commit. Empty
 * when it is not a repository or git is not there: the build then says nothing
 * about a commit rather than a wrong one.
 */
export async function gitState(folder: string): Promise<{ commit?: string; clean?: boolean }> {
  const git = (args: readonly string[]): Promise<string | undefined> => new Promise(done => {
    execFile('git', [...args], { cwd: folder, encoding: 'utf8' }, (error, out) => done(error ? undefined : out));
  });
  const commit = (await git(['rev-parse', 'HEAD']))?.trim();
  if (!commit) return {};
  const status = await git(['status', '--porcelain']);
  return status === undefined ? { commit } : { commit, clean: status.trim() === '' };
}

/** Where artifacts go, as the setting says. */
export function outDirOf(): string {
  return vscode.workspace.getConfiguration('docpresenter').get<string>('outDir') ?? 'out/build';
}
