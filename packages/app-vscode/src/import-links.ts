// `@import "…"` as a link, in VS Code's own editor.
//
// A document opened as text names its figures and tables by path; Ctrl+click
// on the path opens the file, as it does for a link in Markdown. A path is
// read the way the build reads it (joinPath): relative to the document, or —
// written with a leading `/` — from the top of the workspace folder. A path
// that is absolute on this machine (`C:\…`, `/home/…`) is taken as written.

import * as vscode from 'vscode';
import { t } from './l10n.js';

/** Where an `@import` path sits in the text: the characters inside the quotes. */
export interface ImportLink {
  readonly start: number;
  readonly end: number;
  readonly path: string;
}

/** Every `@import "…"` at the start of a line, outside fenced code. */
export function importLinks(text: string): ImportLink[] {
  const links: ImportLink[] = [];
  let fence: string | undefined;
  let offset = 0;
  for (const line of text.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (marker.startsWith(fence)) fence = undefined;
    } else if (fence === undefined) {
      const found = /^(\s*@import\s+")([^"]+)"/.exec(line);
      if (found) {
        const start = offset + found[1]!.length;
        links.push({ start, end: start + found[2]!.length, path: found[2]! });
      }
    }
    offset += line.length + 1;
  }
  return links;
}

/** What kind of path was written, which decides where it is looked for. */
export function pathKind(path: string): 'address' | 'machine' | 'workspace' | 'relative' {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return 'address';
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')) return 'machine';
  if (path.startsWith('/')) return 'workspace';
  return 'relative';
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

/** The file an `@import` path names, from the document that writes it. */
export async function importTarget(document: vscode.Uri, path: string): Promise<vscode.Uri | undefined> {
  switch (pathKind(path)) {
    case 'address': return vscode.Uri.parse(path);
    case 'machine': return vscode.Uri.file(path);
    case 'workspace': {
      // From the top of the folder the document is in, as the build reads it;
      // a path that is not there is a path on this machine.
      const folder = vscode.workspace.getWorkspaceFolder(document);
      const inFolder = folder && vscode.Uri.joinPath(folder.uri, ...path.split('/').filter(Boolean));
      if (inFolder && await exists(inFolder)) return inFolder;
      return vscode.Uri.file(path);
    }
    case 'relative': {
      const parts = path.split(/[\\/]/).filter(part => part !== '' && part !== '.');
      return vscode.Uri.joinPath(document, '..', ...parts);
    }
  }
}

export function registerImportLinks(): vscode.Disposable {
  return vscode.languages.registerDocumentLinkProvider({ language: 'markdown' }, {
    async provideDocumentLinks(document) {
      const text = document.getText().replace(/\r\n/g, '\n');
      // Offsets were counted on LF text; a CRLF document has one more
      // character per line before each, which positionAt on the LF text gives.
      const lines = text.split('\n');
      const starts: number[] = [];
      let at = 0;
      for (const line of lines) { starts.push(at); at += line.length + 1; }
      const position = (offset: number): vscode.Position => {
        let line = 0;
        while (line + 1 < starts.length && starts[line + 1]! <= offset) line += 1;
        return new vscode.Position(line, offset - starts[line]!);
      };
      const links: vscode.DocumentLink[] = [];
      for (const found of importLinks(text)) {
        const target = await importTarget(document.uri, found.path);
        if (!target) continue;
        const link = new vscode.DocumentLink(new vscode.Range(position(found.start), position(found.end)), target);
        link.tooltip = t('vscode.import.open', { path: found.path });
        links.push(link);
      }
      return links;
    },
  });
}
