// The folder's problems, in VS Code's Problems panel — and on demand, all of
// them at once, without writing anything.
//
// These are the build's own findings (`checkWorkspace`), so the panel, the
// check command and an export never disagree. Some are about the folder rather
// than one file — a number is a duplicate only next to another document — so
// the whole folder is held in memory as text and checked again whenever a file
// changes. What is typed and not yet saved counts: a problem fixed in the
// editor leaves the panel before the file is saved.

import { checkWorkspace, type BuildDiagnostic, type CheckResult, type Workspace } from '@docpresenter/build';
import type { Locale } from '@docpresenter/base';
import * as vscode from 'vscode';
import { unitsBefore } from './bytes.js';
import { hostLocale, t } from './l10n.js';

const IGNORED = '**/{node_modules,out,dist,.git}/**';
/** The files whose text a check reads: documents, drawings and tables. */
const READ = /\.(md|dgm|table)$/i;
const SETTLE_MS = 500;

/**
 * Said by the check command, kept out of the panel. A file no output includes
 * is the normal state of a part being written, and would mark half the folder;
 * a folder with nothing to build is not any one file's problem.
 */
const COMMAND_ONLY = new Set(['build.orphan', 'build.noRoots']);

export function registerWorkspaceProblems(output: vscode.OutputChannel): vscode.Disposable {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return { dispose: () => undefined };
  const collection = vscode.languages.createDiagnosticCollection('docpresenter');
  const files = new Set<string>();
  const texts = new Map<string, string>();
  const pathOf = (uri: vscode.Uri): string => vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
  const uriOf = (path: string): vscode.Uri => vscode.Uri.joinPath(folder.uri, ...path.split('/'));
  const openText = (path: string): string | undefined =>
    vscode.workspace.textDocuments.find(one => !one.isClosed && pathOf(one.uri) === path)?.getText();
  const workspace: Workspace = {
    list: () => [...files],
    read: path => openText(path) ?? texts.get(path),
    dataUrl: () => undefined,
  };

  let marked = new Set<string>();
  const run = (): CheckResult => {
    const result = checkWorkspace(workspace, { locale: hostLocale() });
    const found = problemsByFile(workspace, result.diagnostics);
    for (const path of marked) if (!found.has(path)) collection.delete(uriOf(path));
    for (const [path, diagnostics] of found) collection.set(uriOf(path), diagnostics);
    marked = new Set(found.keys());
    return result;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(run, SETTLE_MS);
  };

  const readFromDisk = async (uri: vscode.Uri): Promise<void> => {
    const path = pathOf(uri);
    files.add(path);
    if (!READ.test(path)) return;
    try {
      texts.set(path, new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri)));
    } catch {
      texts.delete(path);
    }
  };
  const scanned = (async () => {
    for (const uri of await vscode.workspace.findFiles('**/*', IGNORED)) await readFromDisk(uri);
    later();
  })();

  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const ignored = (uri: vscode.Uri): boolean => /(^|\/)(node_modules|out|dist|\.git)\//.test(pathOf(uri));
  return vscode.Disposable.from(
    collection, watcher,
    vscode.commands.registerCommand('docpresenter.check', async () => {
      await scanned;
      clearTimeout(timer);
      const result = run();
      report(output, result, path => workspace.read(path));
      void vscode.commands.executeCommand('workbench.actions.view.problems');
    }),
    watcher.onDidCreate(uri => { if (!ignored(uri)) void readFromDisk(uri).then(later); }),
    watcher.onDidChange(uri => { if (!ignored(uri) && READ.test(uri.path)) void readFromDisk(uri).then(later); }),
    watcher.onDidDelete(uri => {
      const path = pathOf(uri);
      files.delete(path);
      texts.delete(path);
      later();
    }),
    // Typed and unsaved: the editor's text is read in place of the file's.
    vscode.workspace.onDidChangeTextDocument(event => { if (READ.test(event.document.uri.path)) later(); }),
    // Closed without saving: the file on disk is what is there again.
    vscode.workspace.onDidCloseTextDocument(document => {
      if (READ.test(document.uri.path)) void readFromDisk(document.uri).then(later);
    }),
    { dispose: () => clearTimeout(timer) },
  );
}

/** A check's findings as VS Code diagnostics, by file — the ones the panel shows. */
export function problemsByFile(
  workspace: Workspace, diagnostics: readonly BuildDiagnostic[],
): Map<string, vscode.Diagnostic[]> {
  const out = new Map<string, vscode.Diagnostic[]>();
  for (const one of diagnostics) {
    if (!one.path || (one.id !== undefined && COMMAND_ONLY.has(one.id))) continue;
    const text = workspace.read(one.path);
    if (text === undefined) continue;
    const diagnostic = new vscode.Diagnostic(rangeOf(one, text), one.message, SEVERITY[one.severity]);
    const list = out.get(one.path);
    if (list) list.push(diagnostic); else out.set(one.path, [diagnostic]);
  }
  return out;
}

/** The same findings checked from a workspace, for a caller with no check of its own. */
export function checkProblems(workspace: Workspace, locale: Locale): Map<string, vscode.Diagnostic[]> {
  return problemsByFile(workspace, checkWorkspace(workspace, { locale }).diagnostics);
}

const SEVERITY: Readonly<Record<BuildDiagnostic['severity'], vscode.DiagnosticSeverity>> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};
const MARK: Readonly<Record<BuildDiagnostic['severity'], string>> = { error: '✗', warning: '!', info: 'i' };

/** Every finding in the output panel, file by file, and a count that says what was read. */
function report(output: vscode.OutputChannel, result: CheckResult, read: (path: string) => string | undefined): void {
  output.clear();
  const sorted = [...result.diagnostics].sort((a, b) =>
    a.path.localeCompare(b.path) || (a.span?.start ?? (a.line ?? 0)) - (b.span?.start ?? (b.line ?? 0)));
  for (const one of sorted) {
    const text = one.path ? read(one.path) : undefined;
    const at = text === undefined ? one.path : `${one.path}:${rangeOf(one, text).start.line + 1}`;
    output.appendLine(`  ${MARK[one.severity]} ${at ? `${at}  ` : ''}${one.message}`);
  }
  const count = (severity: BuildDiagnostic['severity']): number =>
    result.diagnostics.filter(one => one.severity === severity && !COMMAND_ONLY.has(one.id ?? '')).length;
  const summary = t('vscode.check.summary', {
    documents: result.documents, drawings: result.drawings, tables: result.tables,
    errors: count('error'), warnings: count('warning'),
  });
  output.appendLine(summary);
  output.show(true);
  void (count('error') > 0
    ? vscode.window.showErrorMessage(`DocPresenter: ${summary}`)
    : vscode.window.showInformationMessage(`DocPresenter: ${summary}`));
}

/**
 * Where in the file a finding belongs. The build's ranges are bytes of the
 * text read as LF; a CR only ever ends a line, so a line and column counted in
 * the LF text are the same line and column in the file as it is.
 *
 * A file that could not be read gives the line it stopped at. A finding about
 * the number has no place of its own: it goes on the `document:` line, or on
 * the first line when there is none to point at.
 */
function rangeOf(one: BuildDiagnostic, text: string): vscode.Range {
  const lf = text.replace(/\r\n/g, '\n');
  if (one.span) return new vscode.Range(positionIn(lf, one.span.start), positionIn(lf, one.span.end));
  const lines = lf.split('\n');
  let line = 0;
  if (one.line !== undefined) {
    line = Math.max(0, Math.min(one.line - 1, lines.length - 1));
  } else {
    const frontmatter = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    const numbered = lines.slice(0, Math.max(frontmatter, 0)).findIndex(each => /^document\s*:/.test(each));
    if (numbered >= 0) line = numbered;
  }
  const body = lines[line]!;
  const lead = body.length - body.trimStart().length;
  return new vscode.Range(new vscode.Position(line, lead), new vscode.Position(line, body.length));
}

function positionIn(lf: string, byte: number): vscode.Position {
  const before = lf.slice(0, unitsBefore(lf, byte));
  const line = before.split('\n').length - 1;
  return new vscode.Position(line, before.length - (before.lastIndexOf('\n') + 1));
}
