// A picture for a shape, chosen from a file.
//
// The drawing points at the picture by a path relative to itself, so the
// picture has to be somewhere the repository keeps. One already in the
// workspace is pointed at where it is: copying it would leave two files that
// drift apart. One from outside — the desktop, a download — is copied into
// an `images` folder beside the drawing, under a name nobody there uses, and
// pointed at there.

import * as vscode from 'vscode';
import { t } from './l10n.js';

const TYPES: Readonly<Record<string, string>> = {
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

/** The path from the drawing's folder to a file, both in the workspace. */
export function relativeFrom(drawing: string, file: string): string {
  const from = drawing.split('/').slice(0, -1);
  const to = file.split('/');
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same += 1;
  return [...Array.from({ length: from.length - same }, () => '..'), ...to.slice(same)].join('/');
}

/** A file name nobody in the folder is using: `logo.png`, then `logo-2.png`. */
export function freePicture(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[\\/:*?"<>|\s]+/g, '-') || 'picture';
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : '.png';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${stem}${extension}` : `${stem}-${n}${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Asks for a picture; answers with its path as the drawing writes it, and its data for the screen. */
export async function choosePicture(drawing: vscode.Uri): Promise<{ path: string; url: string } | undefined> {
  const folder = vscode.Uri.joinPath(drawing, '..');
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false, defaultUri: folder, openLabel: t('diagramExt.picture.open'),
    filters: { [t('diagramExt.picture.filter')]: Object.keys(TYPES) },
  });
  const file = picked?.[0];
  if (!file) return undefined;
  const type = TYPES[/\.([a-z]+)$/i.exec(file.path)?.[1]?.toLowerCase() ?? ''];
  if (type === undefined) return undefined;
  const bytes = await vscode.workspace.fs.readFile(file);
  const url = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

  const inside = vscode.workspace.getWorkspaceFolder(file) !== undefined
    && vscode.workspace.getWorkspaceFolder(file)?.uri.toString() === vscode.workspace.getWorkspaceFolder(drawing)?.uri.toString();
  if (inside) {
    const path = relativeFrom(vscode.workspace.asRelativePath(drawing, false).split('\\').join('/'),
      vscode.workspace.asRelativePath(file, false).split('\\').join('/'));
    return { path, url };
  }
  const images = vscode.Uri.joinPath(folder, 'images');
  let taken = new Set<string>();
  try { taken = new Set((await vscode.workspace.fs.readDirectory(images)).map(([name]) => name.toLowerCase())); } catch { /* まだ無い */ }
  const name = freePicture(file.path.slice(file.path.lastIndexOf('/') + 1), taken);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(images, name), bytes);
  return { path: `images/${name}`, url };
}
