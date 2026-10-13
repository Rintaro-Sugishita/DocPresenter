// What one document needs, fetched, and the document set from it.
//
// The build reads files synchronously (`Workspace.read`), and a browser cannot.
// So the page renders the document over what it holds, notes every file the
// renderer asked for and did not get, fetches those, and renders again — until
// nothing new is asked for. The rules for what a document pulls in (imports,
// overlay images, part libraries, the theme) stay in the build and the
// renderer: this file never learns them, so it cannot drift from them
// (design/web-viewer.md §2.3).

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import {
  prepare, renderPage, said, themeOf, type BuildDiagnostic, type PreparedDocument, type Workspace,
} from '@docpresenter/build';
import { isAddress, parseDocument } from '@docpresenter/markdown';

/** Where the files come from: in the page, GitHub at one commit. */
export interface FileSource {
  /** Every file there is, as paths from the repository root. */
  readonly paths: readonly string[];
  text(path: string): Promise<string | undefined>;
  image(path: string): Promise<string | undefined>;
}

/** Files fetched so far. A path that could not be had is kept as undefined. */
export interface Held {
  readonly texts: Map<string, string | undefined>;
  readonly images: Map<string, string | undefined>;
}

/** Past this many files a document is not one document; stop and say so. */
export const MOST_FILES = 400;

/**
 * A workspace over the files held, which notes what the renderer asked for
 * and was not yet given. A path that is not in the repository is never noted:
 * the build reports it missing, which is the truth.
 */
export function heldWorkspace(
  source: Pick<FileSource, 'paths'>, held: Held, wanted?: { texts: Set<string>; images: Set<string> },
): Workspace {
  const present = new Set(source.paths);
  return {
    list: () => source.paths,
    read: path => {
      if (held.texts.has(path)) return held.texts.get(path);
      if (present.has(path)) wanted?.texts.add(path);
      return undefined;
    },
    dataUrl: path => {
      if (held.images.has(path)) return held.images.get(path);
      if (present.has(path)) wanted?.images.add(path);
      return undefined;
    },
  };
}

/**
 * Fetches what `render` asks for until it asks for nothing new. `render` is
 * the same function that sets the page, so whatever it reads is what is
 * fetched. `progress` hears the count as it grows.
 */
export async function gather(
  source: FileSource, render: (workspace: Workspace) => void,
  progress?: (count: number) => void, most = MOST_FILES,
): Promise<{ held: Held; complete: boolean }> {
  const held: Held = { texts: new Map(), images: new Map() };
  for (;;) {
    const wanted = { texts: new Set<string>(), images: new Set<string>() };
    render(heldWorkspace(source, held, wanted));
    if (wanted.texts.size === 0 && wanted.images.size === 0) return { held, complete: true };
    if (held.texts.size + held.images.size + wanted.texts.size + wanted.images.size > most) {
      return { held, complete: false };
    }
    await Promise.all([
      ...[...wanted.texts].map(async path => {
        held.texts.set(path, await source.text(path).catch(() => undefined));
      }),
      ...[...wanted.images].map(async path => {
        held.images.set(path, await source.image(path).catch(() => undefined));
      }),
    ]);
    progress?.(held.texts.size + held.images.size);
  }
}

/** What the page shows for one document. */
export interface Composed {
  /** The path the build sees as the document. A drawing gets one made up for it. */
  readonly root: string;
  readonly prepared: PreparedDocument;
  /** The theme's CSS. */
  readonly style: string;
  /** The page's body, as the build writes it for HTML. */
  readonly body: string;
  readonly title: string;
  readonly diagnostics: readonly BuildDiagnostic[];
}

export interface ComposeOptions {
  readonly locale?: Locale;
  /** The theme shipped with the page, for a document whose repository has none. */
  readonly shippedTheme: string;
  /** Pictures from the web, already fetched. */
  readonly inlined?: ReadonlyMap<string, string>;
}

const PICTURE = /\.(png|jpe?g|gif|svg|webp)$/i;

/** Whether the page can show the file at this path. */
export function isViewable(path: string): boolean {
  return /\.(md|dgm)$/i.test(path);
}

/**
 * The document the build is given for a path. A Markdown file is itself; a
 * drawing is set as a document of one figure that takes it in, beside it so
 * that every path the drawing writes still means what it meant.
 */
export function viewingRoot(path: string): { readonly root: string; readonly source?: string } {
  if (!/\.dgm$/i.test(path)) return { root: path };
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  return {
    root: `${path.slice(0, slash + 1)}.docpresenter-view-${name}.md`,
    source: `@import "${name}"\n`,
  };
}

/** Sets one document over a workspace, as the build's HTML writer does. */
export function compose(workspace: Workspace, path: string, options: ComposeOptions): Composed {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const viewing = viewingRoot(path);
  const read = viewing.source === undefined
    ? workspace
    : { ...workspace, read: (at: string) => (at === viewing.root ? viewing.source : workspace.read(at)) };

  const source = read.read(viewing.root) ?? '';
  const document = parseDocument(source);
  const prepared = prepare(read, { path: viewing.root, document, formats: ['html'] }, locale);
  const diagnostics = [...prepared.diagnostics];
  // A missing document is the expansion's to report; a missing drawing, table
  // or picture is the reference graph's, which the page does not run (it reads
  // every document in the repository). The same sentence, for the same thing.
  for (const block of prepared.document.blocks) {
    if (block.kind !== 'import' || isAddress(block.path) || /\.md$/i.test(block.path)) continue;
    const there = PICTURE.test(block.path) ? read.dataUrl?.(block.path) : read.read(block.path);
    if (there !== undefined) continue;
    diagnostics.push({
      severity: 'error', path: block.doc ?? viewing.root, span: block.span,
      ...said(locale, 'build.missing', { target: block.path }),
    });
  }

  // The repository's own theme when it has one, as a build in that folder would.
  const theme = document.frontmatter.theme ?? 'default';
  let style = themeOf(at => read.read(at), theme);
  if (style === undefined) {
    if (theme !== 'default') {
      diagnostics.push({ severity: 'warning', path, ...said(locale, 'build.noTheme', { theme }) });
    }
    style = options.shippedTheme;
  }

  const page = renderPage({
    workspace: read,
    document: prepared.document,
    resolved: prepared.resolved,
    style: '',
    root: viewing.root,
    ...(options.inlined === undefined ? {} : { inlined: options.inlined }),
  });
  const body = page.slice(page.indexOf('<body>') + '<body>'.length, page.lastIndexOf('</body>'));
  const raw = document.frontmatter.raw;
  const title = String(raw['title'] ?? raw['document'] ?? path.slice(path.lastIndexOf('/') + 1));
  // A drawing's made-up document is not the reader's; say things about the drawing.
  const named = viewing.source === undefined ? diagnostics
    : diagnostics.map(d => (d.path === viewing.root ? { ...d, path } : d));
  return { root: viewing.root, prepared, style, body, title, diagnostics: named };
}

/** The documents and drawings in a folder, for the folder view. */
export function viewableUnder(paths: readonly string[], folder: string): { documents: string[]; drawings: string[] } {
  const prefix = folder === '' ? '' : `${folder.replace(/\/+$/, '')}/`;
  const under = paths.filter(path => path.startsWith(prefix) && !HIDDEN.test(path)).sort();
  return {
    documents: under.filter(path => /\.md$/i.test(path)),
    drawings: under.filter(path => /\.dgm$/i.test(path)),
  };
}

/** Not documents: what tools keep, and what an agent reads (as the build's graph decides). */
const HIDDEN = /(^|\/)((node_modules|dist|out|\.git|\.docpresenter|\.github)\/|(CLAUDE|AGENTS)\.md$)/;
