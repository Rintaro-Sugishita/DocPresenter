// A screen drawing written out as the start of the real screen: an HTML page,
// or a WPF window in XAML. Only a `free` drawing is a screen; a flow has no
// controls to write.

import { describeError } from '@docpresenter/base';
import { parseDiagram, screenToHtml, screenToXaml, withParts } from '@docpresenter/diagram';
import * as vscode from 'vscode';
import { librariesUsed } from './dgm-language.js';
import { activeTabUri, isDiagram } from './export-svg.js';
import { hostLocale, t } from './l10n.js';

export type ScreenFormat = 'html' | 'xaml';

/** A class name for the window, from the file's: `login-screen` → `LoginScreenWindow`. */
export function windowClass(stem: string): string {
  const words = stem.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const name = words.map(word => word[0]!.toUpperCase() + word.slice(1)).join('') || 'Main';
  return `App.${/^\p{L}/u.test(name) ? name : `_${name}`}Window`;
}

export async function exportScreen(format: ScreenFormat, uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? activeTabUri();
  if (!target || !isDiagram(target)) {
    void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.notDiagram')}`);
    return;
  }
  const path = vscode.workspace.asRelativePath(target, false);
  const source = (await vscode.workspace.openTextDocument(target)).getText();
  const stem = target.path.split('/').pop()?.replace(/\.dgm$/i, '') || 'screen';
  let text: string;
  try {
    const files = await librariesUsed(target, source);
    const drawing = withParts(parseDiagram(source), used => files.get(used));
    if (drawing.mode !== 'free') {
      void vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.screen.notFree')}`);
      return;
    }
    text = format === 'html'
      ? screenToHtml(drawing, { title: stem, locale: hostLocale() })
      : screenToXaml(drawing, { title: stem, className: windowClass(stem), locale: hostLocale() });
  } catch (error) {
    void vscode.window.showErrorMessage(`DocPresenter Diagram: ${t('diagramExt.svg.unreadable', {
      path, message: describeError(error, hostLocale()),
    })}`);
    return;
  }
  const extension = format === 'html' ? 'html' : 'xaml';
  const offered = target.scheme === 'untitled' ? undefined : target.with({ path: target.path.replace(/\.dgm$/i, `.${extension}`) });
  const chosen = await vscode.window.showSaveDialog({
    ...(offered === undefined ? {} : { defaultUri: offered }),
    filters: format === 'html' ? { HTML: ['html'] } : { XAML: ['xaml'] },
    saveLabel: t(format === 'html' ? 'diagramExt.screen.saveHtml' : 'diagramExt.screen.saveXaml'),
  });
  if (!chosen) return;
  await vscode.workspace.fs.writeFile(chosen, new TextEncoder().encode(text));
  const open = t('diagramExt.screen.open');
  const picked = await vscode.window.showInformationMessage(`DocPresenter Diagram: ${t('diagramExt.svg.done', {
    path: vscode.workspace.asRelativePath(chosen, false),
  })}`, open);
  if (picked === open) await vscode.window.showTextDocument(chosen);
}
