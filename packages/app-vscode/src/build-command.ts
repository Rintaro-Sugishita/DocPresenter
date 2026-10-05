// The build, run from inside VS Code.
//
// `@docpresenter/build` never opens a file — it is handed a workspace — so the
// same build that runs in the CLI runs here over `vscode.workspace.fs`, with
// no second implementation to keep in step.
//
// PDF is not written here. The page has to be laid out by a browser before it
// can be paginated (design/pdf-engine.md), and the one in reach is the WebView
// — which is the next step, not this one. Until then the build says so rather
// than writing a PDF that was never measured.

import * as vscode from 'vscode';
import { build, type Workspace } from '@docpresenter/build';

const MEDIA: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
const IGNORED = '**/{node_modules,out,dist,.git}/**';

/**
 * @param shipped The theme the extension carries, for a workspace with none of
 * its own. The workspace's own wins, as in the CLI: a team that writes a theme
 * is saying something, and shipping one is only so that nobody has to.
 */
export async function runBuild(output: vscode.OutputChannel, shipped?: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('DocPresenter: フォルダを開いてから実行してください');
    return;
  }
  const root = folder.uri;
  output.clear();
  output.show(true);

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

  const workspace: Workspace = {
    list: () => [...text.keys(), ...data.keys()],
    read: path => text.get(path),
    dataUrl: path => data.get(path),
  };
  const outDir = vscode.workspace.getConfiguration('docpresenter').get<string>('outDir')
    ?? 'out/build';

  const result = await build(workspace, {
    outDir,
    style: theme => text.get(`themes/${theme}/theme.css`) ?? shipped,
    builtAt: new Date().toISOString(),
  });

  for (const trouble of result.diagnostics) {
    const where = trouble.path ? `${trouble.path}: ` : '';
    output.appendLine(`  ${trouble.severity === 'error' ? '✗' : '!'} ${where}${trouble.message}`);
  }
  for (const artifact of result.artifacts) {
    const bytes = artifact.bytes ?? new TextEncoder().encode(artifact.text);
    const uri = vscode.Uri.joinPath(root, ...artifact.path.split('/'));
    await vscode.workspace.fs.writeFile(uri, bytes);
    output.appendLine(`${artifact.path}（${artifact.root} → ${artifact.format}、`
      + `${(bytes.length / 1024).toFixed(0)} KB）`);
  }
  output.appendLine(`ルート ${result.graph.roots.length} 件 / 成果物 ${result.artifacts.length} 件`);
  if (result.diagnostics.some(one => one.message.includes('pdf'))) {
    output.appendLine('PDF はこの版では書けません。'
      + 'ターミナルで `node tools/build.mjs --in .` を使ってください。');
  }
}
