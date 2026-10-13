// A .dgm file opened as text: the suggestions as it is typed.
//
// The colours come from the grammar in syntaxes/, which VS Code reads without
// running anything here. What needs the extension is what needs the folder —
// the parts a drawing's libraries declare, the files a `use` line can name —
// and @docpresenter/diagram decides what fits where; this only reads files and
// hands its answers to the editor.

import { completeDiagram, parseDiagram, partsOf, type Completion, type CompletionContext, type Part } from '@docpresenter/diagram';
import * as vscode from 'vscode';
import { hostLocale } from './l10n.js';

export const DGM_LANGUAGE = 'dgm';

/**
 * Typed characters after which something new can start: a space after an id,
 * the quote of a `use`, the colon of a property, a brace or a semicolon in a
 * list, a bracket of settings, and the characters a connector is made of.
 */
const TRIGGERS = [' ', '"', ':', '{', ';', '(', ',', '-', '>', '.', '/'];

const KINDS: Readonly<Record<Completion['kind'], vscode.CompletionItemKind>> = {
  section: vscode.CompletionItemKind.Module,
  keyword: vscode.CompletionItemKind.Keyword,
  shape: vscode.CompletionItemKind.Struct,
  connector: vscode.CompletionItemKind.Operator,
  id: vscode.CompletionItemKind.Variable,
  part: vscode.CompletionItemKind.Class,
  container: vscode.CompletionItemKind.Module,
  setting: vscode.CompletionItemKind.Property,
  property: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.EnumMember,
  library: vscode.CompletionItemKind.File,
  snippet: vscode.CompletionItemKind.Snippet,
};

const IGNORED = '**/{node_modules,out,dist,.git}/**';

export function registerDgmLanguage(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    { language: DGM_LANGUAGE },
    { provideCompletionItems: (document, position) => suggest(document, position) },
    ...TRIGGERS,
  );
}

/** What fits at the cursor, as VS Code shows it. */
export async function suggest(
  document: vscode.TextDocument, position: vscode.Position,
): Promise<vscode.CompletionItem[]> {
  const text = document.getText();
  const locale = hostLocale();
  let found = completeDiagram(text, position.line, position.character, { locale });
  // The folder is read only where its answer is asked for: after a shape's id
  // (the parts) and inside a `use` line's quotes (the libraries).
  const parts = found.some(one => one.kind === 'shape') ? await reachableParts(document.uri, text) : undefined;
  const libraries = found.some(one => one.kind === 'library') ? await librariesFor(document.uri) : undefined;
  if (parts || libraries) {
    const more: CompletionContext = { locale, ...(parts && { parts }), ...(libraries && { libraries }) };
    found = completeDiagram(text, position.line, position.character, more);
  }
  return found.map(one => item(one, position));
}

function item(one: Completion, position: vscode.Position): vscode.CompletionItem {
  const made = new vscode.CompletionItem(one.label, KINDS[one.kind]);
  made.insertText = new vscode.SnippetString(one.insert);
  made.range = new vscode.Range(new vscode.Position(position.line, one.from), position);
  if (one.detail !== undefined) made.detail = one.detail;
  if (one.sort !== undefined) made.sortText = one.sort;
  if (one.again) made.command = { title: '', command: 'editor.action.triggerSuggest' };
  return made;
}

/**
 * The parts the drawing can reach, read through its `use` lines.
 *
 * The file is being typed, so it may not read; then only its `use` lines are
 * taken, which is all a library comes from. A library that cannot be read
 * leaves the list without its parts rather than without suggestions.
 */
async function reachableParts(uri: vscode.Uri, text: string): Promise<ReadonlyMap<string, Part> | undefined> {
  const files = new Map<string, string>();
  // `partsOf` reads synchronously, so every file it could ask for is read
  // first. Paths are relative to this drawing, as the build resolves them.
  const waiting = usesOf(text);
  while (waiting.length > 0) {
    const path = waiting.shift()!;
    if (files.has(path) || path === 'default' || path === 'icons') continue;
    const source = await readText(vscode.Uri.joinPath(uri, '..', ...path.split('/')));
    if (source === undefined) continue;
    files.set(path, source);
    waiting.push(...usesOf(source));
  }
  const read = (path: string): string | undefined => files.get(path);
  try {
    return partsOf(parseDiagram(text), read);
  } catch {
    try {
      return partsOf(parseDiagram(usesOf(text).map(path => `use "${path}"`).join('\n')), read);
    } catch {
      return undefined;
    }
  }
}

function usesOf(text: string): string[] {
  return [...text.matchAll(/^\s*use\s+"([^"]+)"\s*$/gm)].map(found => found[1]!);
}

/** The workspace's files of parts, as a `use` line in this file would write them. */
async function librariesFor(uri: vscode.Uri): Promise<string[]> {
  const here = vscode.workspace.asRelativePath(uri, false).split('\\').join('/');
  const folder = here.split('/').slice(0, -1);
  const found: string[] = [];
  for (const one of await vscode.workspace.findFiles('**/*.dgm', IGNORED)) {
    const path = vscode.workspace.asRelativePath(one, false).split('\\').join('/');
    if (path === here) continue;
    // A library declares parts; a drawing that only uses some is not one.
    const source = await readText(one);
    if (source === undefined || !/^\s*parts\b[^{]*\{\s*$/m.test(source)) continue;
    found.push(relativeTo(folder, path.split('/')));
  }
  return found.sort();
}

/** `to` written from inside `folder`, both as segments from the workspace root. */
function relativeTo(folder: readonly string[], to: readonly string[]): string {
  let same = 0;
  while (same < folder.length && same < to.length - 1 && folder[same] === to[same]) same++;
  return [...folder.slice(same).map(() => '..'), ...to.slice(same)].join('/');
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}
