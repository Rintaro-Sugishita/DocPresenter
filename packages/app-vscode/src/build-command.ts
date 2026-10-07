// The build, run from inside VS Code.
//
// `@docpresenter/build` never opens a file — it is handed a workspace — so the
// same build that runs in the CLI runs here over `vscode.workspace.fs`, with
// no second implementation to keep in step. The commands go through
// export-command.ts, which also opens a WebView to lay pages out for the PDF;
// this is the same write-out with whatever browser the caller can give it —
// none, in which case the PDF is skipped and the output says where to get it.

import * as vscode from 'vscode';
import { writeOut, type WriteOutOptions } from './export-command.js';
import { t } from './l10n.js';

/**
 * @param shipped The theme the extension carries, for a workspace with none of
 * its own. The workspace's own wins, as in the CLI: a team that writes a theme
 * is saying something, and shipping one is only so that nobody has to.
 */
export async function runBuild(
  output: WriteOutOptions['output'], shipped?: string,
  options: Pick<WriteOutOptions, 'renderer' | 'media' | 'formats'> = {},
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.[0]) {
    void vscode.window.showErrorMessage(`DocPresenter: ${t('vscode.noFolder')}`);
    return;
  }
  output.show(true);
  await writeOut({ output, ...(shipped === undefined ? {} : { shipped }), ...options });
}
