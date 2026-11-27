/**
 * Hands a file to whatever the system opens it with.
 *
 * `vscode.env.openExternal` passes a `file:` URI to the shell as a URL, and
 * on Windows a URL whose path holds non-ASCII letters (日本語.xlsx) arrives
 * percent-encoded: the shell then looks for a file named `%E6%97%A5…` and
 * says it is not there. A local file is therefore opened by its path with
 * the system's own opener; a remote one (WSL, SSH, a container) still goes
 * through `openExternal`, since its path means nothing on this machine.
 */

import * as vscode from 'vscode';
import { spawn } from 'node:child_process';

export function openWithSystem(file: vscode.Uri): Thenable<boolean> {
  if (file.scheme !== 'file' || vscode.env.remoteName) return vscode.env.openExternal(file);
  const path = file.fsPath;
  const [command, args] = process.platform === 'win32'
    ? ['explorer.exe', [path]]
    : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]];
  return new Promise<boolean>(resolve => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', () => resolve(vscode.env.openExternal(file)));
      // explorer.exe exits with 1 even when it opened the file, so the exit
      // code says nothing; that it started is all there is to know.
      child.on('spawn', () => { child.unref(); resolve(true); });
    } catch {
      resolve(vscode.env.openExternal(file));
    }
  });
}
