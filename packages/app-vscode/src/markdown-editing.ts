// Writing a document as text, in VS Code's own editor.
//
// The page's text box and this editor behave alike: Enter carries a list on,
// Tab and Shift+Tab move list items in and out, Ctrl+B / Ctrl+I / Ctrl+E mark
// bold, italic and code, and `@` and `@import "` offer what can go there. What
// each does is decided in @docpresenter/markdown (editing.ts) and base
// (toggleInline); this only applies it. `docpresenter.markdownEditing` turns
// the keys off, for someone who has another extension doing the same.

import * as vscode from 'vscode';
import { toggleInline, type InlineMark } from '@docpresenter/base';
import {
  completionContext, enterInList, IMPORTABLE, indentListItems, joinPath, labelCandidates, type TextChange,
} from '@docpresenter/markdown';
import { inDocument } from './paths.js';
import { hostLocale, t } from './l10n.js';

const IGNORED = '**/{node_modules,out,dist,.git}/**';

export function registerMarkdownEditing(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerTextEditorCommand('docpresenter.markdown.enter', editor => enter(editor)),
    vscode.commands.registerTextEditorCommand('docpresenter.markdown.indent', editor => indent(editor, false)),
    vscode.commands.registerTextEditorCommand('docpresenter.markdown.outdent', editor => indent(editor, true)),
    vscode.commands.registerTextEditorCommand('docpresenter.markdown.bold', editor => mark(editor, 'bold')),
    vscode.commands.registerTextEditorCommand('docpresenter.markdown.italic', editor => mark(editor, 'italic')),
    vscode.commands.registerTextEditorCommand('docpresenter.markdown.code', editor => mark(editor, 'code')),
    vscode.languages.registerCompletionItemProvider({ language: 'markdown' }, { provideCompletionItems }, '@', '"', '/'),
  );
}

/** Applies a change worked out on the document's text, and puts the cursor where it says. */
async function apply(editor: vscode.TextEditor, change: TextChange): Promise<void> {
  const document = editor.document;
  const range = new vscode.Range(document.positionAt(change.start), document.positionAt(change.end));
  const done = await editor.edit(edit => edit.replace(range, change.text));
  // The selection is an offset in the text after the change, which the document now is.
  if (done) {
    editor.selection = new vscode.Selection(
      document.positionAt(change.select.start), document.positionAt(change.select.end));
  }
}

async function enter(editor: vscode.TextEditor): Promise<void> {
  const document = editor.document;
  const { start, end } = offsets(editor);
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const change = enterInList(document.getText(), start, end, eol);
  if (change) await apply(editor, change);
  // Not in a list: Enter as it always is, auto-indent and all.
  else await vscode.commands.executeCommand('type', { source: 'keyboard', text: '\n' });
}

async function indent(editor: vscode.TextEditor, outdent: boolean): Promise<void> {
  const { start, end } = offsets(editor);
  const change = indentListItems(editor.document.getText(), start, end, outdent);
  if (change) await apply(editor, change);
  else await vscode.commands.executeCommand(outdent ? 'outdent' : 'tab');
}

async function mark(editor: vscode.TextEditor, which: InlineMark): Promise<void> {
  const { start, end } = offsets(editor);
  const change = toggleInline(editor.document.getText(), start, end, which);
  await apply(editor, change);
}

function offsets(editor: vscode.TextEditor): { start: number; end: number } {
  return {
    start: editor.document.offsetAt(editor.selection.start),
    end: editor.document.offsetAt(editor.selection.end),
  };
}

async function provideCompletionItems(
  document: vscode.TextDocument, position: vscode.Position,
): Promise<vscode.CompletionItem[] | undefined> {
  const text = document.getText();
  const at = document.offsetAt(position);
  const context = completionContext(text, at);
  if (!context) return undefined;
  const range = new vscode.Range(document.positionAt(context.from), position);
  const here = vscode.workspace.asRelativePath(document.uri, false).split('\\').join('/');

  if (context.kind === 'import') {
    const files = await vscode.workspace.findFiles('**/*', IGNORED, 5000);
    return files
      .map(uri => vscode.workspace.asRelativePath(uri, false).split('\\').join('/'))
      .filter(path => path !== here && IMPORTABLE.test(path))
      .sort()
      .map(path => {
        const written = inDocument(here, path);
        const item = new vscode.CompletionItem(written, vscode.CompletionItemKind.File);
        item.range = range;
        item.detail = path;
        return item;
      });
  }

  const read = await includedDocuments(document.uri, text);
  const items = labelCandidates(text, path => read.get(path), hostLocale()).map(one => {
    const item = new vscode.CompletionItem(one.label, vscode.CompletionItemKind.Reference);
    item.range = range;
    const detail = [one.number, one.caption].filter(Boolean).join(' ');
    if (detail) item.detail = detail;
    return item;
  });
  // At the start of a line, `@` may be the start of an import rather than a reference.
  if (context.lineStart) {
    const importing = new vscode.CompletionItem('import', vscode.CompletionItemKind.Keyword);
    importing.range = range;
    importing.insertText = new vscode.SnippetString('import "$1"');
    importing.detail = t('vscode.markdown.import');
    importing.command = { command: 'editor.action.triggerSuggest', title: '' };
    items.unshift(importing);
  }
  return items;
}

/**
 * The documents a document takes in, read ahead so the labels in them can be
 * offered: by the path the document writes, as `labelCandidates` reads them.
 */
async function includedDocuments(uri: vscode.Uri, text: string): Promise<Map<string, string>> {
  const folder = vscode.Uri.joinPath(uri, '..');
  const found = new Map<string, string>();
  const waiting = importsOf('document.md', text);
  while (waiting.length > 0) {
    const path = waiting.shift()!;
    if (found.has(path) || found.size > 50) continue;
    try {
      const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, ...path.split('/'))));
      found.set(path, source);
      waiting.push(...importsOf(path, source));
    } catch { /* 無い文書は、ビルドが言う */ }
  }
  return found;
}

/** The `.md` files a document takes in, as paths from the first document's folder. */
function importsOf(from: string, text: string): string[] {
  return [...text.matchAll(/^@import\s+"([^"]+\.md)"/gim)].map(found => joinPath(from, found[1]!));
}
