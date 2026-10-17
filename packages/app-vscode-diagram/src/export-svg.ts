// A drawing saved as an SVG file: for a slide, a wiki, or anywhere a picture
// goes. The theme's drawing rules go inside it (`standaloneSvg`), so it looks
// as it does in a document wherever it is opened.

import { describeError } from '@docpresenter/base';
import { parseDiagram, renderDiagram, standaloneSvg, withParts } from '@docpresenter/diagram';
import * as vscode from 'vscode';
import { librariesUsed } from './dgm-language.js';
import { hostLocale, t } from './l10n.js';

/**
 * Asks where to save, the drawing's own folder and name offered, and writes it.
 * Pictures a part points at by path are put inside the file, so it stands alone.
 */
export async function exportSvg(extensionUri: vscode.Uri, uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? activeTabUri();
  if (!target || !/\.dgm$/i.test(target.path)) {
    void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.notDiagram')}`);
    return;
  }
  const path = vscode.workspace.asRelativePath(target, false);
  const document = await vscode.workspace.openTextDocument(target);
  const source = document.getText();
  let svg: string;
  try {
    const files = await librariesUsed(target, source);
    const drawing = withParts(parseDiagram(source), used => files.get(used));
    svg = renderDiagram(drawing, await picturesOf(target, drawing.style), undefined, hostLocale());
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter Diagram: ${t('diagramExt.svg.unreadable', {
      path, message: describeError(error, hostLocale()),
    })}`);
    return;
  }
  const theme = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'media', 'theme.css')));

  const offered = target.with({ path: target.path.replace(/\.dgm$/i, '.svg') });
  const chosen = await vscode.window.showSaveDialog({
    defaultUri: offered, filters: { SVG: ['svg'] }, saveLabel: t('diagramExt.svg.saveLabel'),
  });
  if (!chosen) return;
  await vscode.workspace.fs.writeFile(chosen, new TextEncoder().encode(standaloneSvg(svg, theme)));
  void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.svg.done', {
    path: vscode.workspace.asRelativePath(chosen, false),
  })}`);
}

/**
 * The pictures the drawing's `icon:` declarations point at by path, read and
 * turned into data URLs, as the renderer's resolver. One that cannot be read is
 * drawn as its name, which is what the renderer does without a picture.
 */
async function picturesOf(
  drawing: vscode.Uri, style: ReadonlyMap<string, ReadonlyMap<string, string>>,
): Promise<(path: string) => string> {
  const found = new Map<string, string>();
  for (const rule of style.values()) {
    const icon = rule.get('icon');
    if (icon === undefined || !/\.(svg|png)$/i.test(icon) || found.has(icon)) continue;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(drawing, '..', ...icon.split('/')));
      const type = /\.svg$/i.test(icon) ? 'image/svg+xml' : 'image/png';
      found.set(icon, `data:${type};base64,${Buffer.from(bytes).toString('base64')}`);
    } catch { /* 読めない絵は名前で描かれる */ }
  }
  return path => found.get(path) ?? path;
}

/** The file of the tab in front, when it is not a text editor — the canvas, say. */
export function activeTabUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups?.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  return input?.uri;
}
