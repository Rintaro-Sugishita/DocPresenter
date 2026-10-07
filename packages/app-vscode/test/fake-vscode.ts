// Enough of the VS Code API to run the extension without VS Code.
//
// The extension cannot be exercised in this repository's checks any other way
// — there is no editor to launch — and "it compiles" is not a claim that it
// works. So the half that matters is run against a workspace held in a map:
// an edit that arrives from the WebView really does rewrite a file here, in
// exactly the range it named, and the test reads the file back.
//
// Nothing here is a mock of behaviour we wish for. Each piece does what the
// real API documents: `applyEdit` splices the range, `positionAt` counts UTF-16
// units, `asRelativePath` strips the folder.

export class Position {
  constructor(readonly line: number, readonly character: number) {}
}

export class Range {
  constructor(readonly start: Position, readonly end: Position) {}
}

export class Uri {
  private constructor(readonly path: string) {}
  static file(path: string): Uri { return new Uri(path); }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri([base.path, ...parts].filter(one => one !== '').join('/'));
  }
  get fsPath(): string { return this.path; }
  toString(): string { return `file://${this.path}`; }
}

export class WorkspaceEdit {
  readonly changes: { uri: Uri; range: Range; text: string }[] = [];
  readonly renames: { from: Uri; to: Uri; overwrite: boolean }[] = [];
  replace(uri: Uri, range: Range, text: string): void {
    this.changes.push({ uri, range, text });
  }
  renameFile(from: Uri, to: Uri, options: { overwrite?: boolean } = {}): void {
    this.renames.push({ from, to, overwrite: options.overwrite ?? false });
  }
}

const ROOT = Uri.file('/w');
/** The workspace: every file, by path from the root. */
export const held = new Map<string, string>();
/** Files written through `fs.writeFile` rather than through an edit. */
export const written = new Map<string, Uint8Array>();
export const saved: string[] = [];
/** How the dialogs answer, for a test that drives a command. */
export const picks: {
  dialog?: Uri[] | undefined;
  quick?: (<T>(items: readonly T[]) => T[] | undefined | Promise<T[] | undefined>) | undefined;
} = {};
export const shown: string[] = [];

export class TextDocument {
  /** Nothing here is typed into by hand, so nothing is ever unsaved. */
  readonly isDirty = false;
  constructor(readonly uri: Uri, private body: string) {}
  getText(): string { return this.body; }
  positionAt(offset: number): Position {
    const before = this.body.slice(0, offset);
    const line = before.split('\n').length - 1;
    return new Position(line, offset - (before.lastIndexOf('\n') + 1));
  }
  offsetAt(at: Position): number {
    const lines = this.body.split('\n');
    let offset = 0;
    for (let i = 0; i < at.line; i += 1) offset += (lines[i]?.length ?? 0) + 1;
    return offset + at.character;
  }
  replace(range: Range, text: string): void {
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    this.body = this.body.slice(0, start) + text + this.body.slice(end);
    held.set(relative(this.uri), this.body);
    for (const listen of changed) listen({ document: this });
  }
  async save(): Promise<boolean> { saved.push(relative(this.uri)); return true; }
}

const open = new Map<string, TextDocument>();
const changed: ((event: { document: TextDocument }) => void)[] = [];
const configured: ((event: { affectsConfiguration(key: string): boolean }) => void)[] = [];
let configuration: Record<string, unknown> = {};

function relative(uri: Uri): string {
  return uri.path.startsWith(`${ROOT.path}/`) ? uri.path.slice(ROOT.path.length + 1) : uri.path;
}

export const workspace = {
  workspaceFolders: [{ uri: ROOT, name: 'w', index: 0 }],
  getWorkspaceFolder: () => ({ uri: ROOT, name: 'w', index: 0 }),
  asRelativePath: (uri: Uri) => relative(uri),
  findFiles: async (pattern: string) => {
    // Only the part of glob this extension uses: `**/*` for everything,
    // `**/*.{a,b}` for a set of kinds, and `**/*.a` for one.
    const kinds = /\{([^}]*)\}/.exec(pattern)?.[1]?.split(',') ?? /\*\.(\w+)$/.exec(pattern)?.slice(1);
    return [...held.keys(), ...written.keys()]
      .filter((path, at, all) => all.indexOf(path) === at)
      .filter(path => kinds === undefined
        || kinds.some(kind => path.toLowerCase().endsWith(`.${kind}`)))
      .map(path => Uri.joinPath(ROOT, path));
  },
  fs: {
    readFile: async (uri: Uri) => {
      // A binary — a deck — is held as the bytes that were written.
      const bytes = written.get(relative(uri));
      if (bytes && !held.has(relative(uri))) return bytes;
      const text = held.get(relative(uri));
      if (text === undefined) throw new Error(`no such file: ${relative(uri)}`);
      return new TextEncoder().encode(text);
    },
    writeFile: async (uri: Uri, bytes: Uint8Array) => {
      written.set(relative(uri), bytes);
      held.set(relative(uri), new TextDecoder().decode(bytes));
    },
  },
  openTextDocument: async (uri: Uri) => {
    const path = relative(uri);
    const already = open.get(path);
    if (already) return already;
    const made = new TextDocument(uri, held.get(path) ?? '');
    open.set(path, made);
    return made;
  },
  applyEdit: async (edit: WorkspaceEdit) => {
    // As VS Code does: a rename onto a file that is there is refused, and the
    // whole edit with it.
    for (const one of edit.renames) {
      if (!one.overwrite && held.has(relative(one.to))) return false;
    }
    for (const one of edit.renames) {
      held.set(relative(one.to), held.get(relative(one.from)) ?? '');
      held.delete(relative(one.from));
      open.delete(relative(one.from));
    }
    for (const one of edit.changes) {
      const document = await workspace.openTextDocument(one.uri);
      document.replace(one.range, one.text);
    }
    return true;
  },
  getConfiguration: () => ({ get: (key: string) => configuration[key] }),
  onDidChangeTextDocument: (listen: (event: { document: TextDocument }) => void) => {
    changed.push(listen);
    return { dispose: () => changed.splice(changed.indexOf(listen), 1) };
  },
  onDidChangeConfiguration: (listen: (event: { affectsConfiguration(key: string): boolean }) => void) => {
    configured.push(listen);
    return { dispose: () => configured.splice(configured.indexOf(listen), 1) };
  },
};

export const window = {
  showErrorMessage: (message: string) => { shown.push(message); },
  showWarningMessage: (message: string) => { shown.push(message); },
  showInformationMessage: (message: string) => { shown.push(message); },
  /** What the next file dialog answers. */
  showOpenDialog: async () => picks.dialog,
  /** Picks what the test said to, or every item that was offered as picked. */
  showQuickPick: async <T extends { picked?: boolean }>(items: readonly T[]) =>
    picks.quick ? await picks.quick(items) : items.filter(item => item.picked),
  createOutputChannel: () => ({
    lines: [] as string[],
    clear() { this.lines.length = 0; },
    show() { /* 画面は無い */ },
    appendLine(line: string) { this.lines.push(line); },
    dispose() { /* 何も持たない */ },
  }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: async () => undefined,
};

export const Disposable = { from: () => ({ dispose: () => undefined }) };

/** VS Code's display language. Japanese, as the tests read; a test may change it. */
export const env = { language: 'ja', openExternal: async () => true };

/** Sets up a workspace for one test. */
export function give(files: Readonly<Record<string, string>>, config: Record<string, unknown> = {}): void {
  held.clear(); written.clear(); open.clear(); saved.length = 0; shown.length = 0;
  picks.dialog = undefined; picks.quick = undefined;
  changed.length = 0; configured.length = 0;
  configuration = config;
  for (const [path, text] of Object.entries(files)) held.set(path, text);
}

/** The document the editor is opened on, as VS Code would hand it over. */
export async function documentAt(path: string): Promise<TextDocument> {
  return workspace.openTextDocument(Uri.joinPath(ROOT, path));
}
