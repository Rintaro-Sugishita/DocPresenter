// The build: roots in, artifacts out.
//
// Everything a format writer needs is prepared once here — the expanded
// document, its numbering, its diagnostics — because a document built to two
// formats must be the same document in both. A PDF whose figure numbers differ
// from the HTML's is worse than no PDF.

import {
  anchorFileOf, expandDocument, fencesOf, isAbout, isAddress, parseDocument, parseReviewFile, resolveDocument, viewOf,
  type DiffMarks, type DocumentFile, type ResolvedDocument,
} from '@docpresenter/markdown';
import { writePptx } from '@docpresenter/pptx';
import { DEFAULT_LOCALE, describeError, locateAnchor, type Locale } from '@docpresenter/base';
import { BUILD_MESSAGES, said } from './messages.js';
import { deckOf } from './deck.js';
import { diffOf, type Previous } from './diff.js';
import { readGraph, type ReferenceGraph, type Root } from './graph.js';
import { hasMermaid, renderPage } from './html.js';
import { asLf, type Artifact, type BuildDiagnostic, type Workspace } from './workspace.js';

/** What a format writer is given. Everything is prepared before it is called. */
export interface WriteInput {
  readonly workspace: Workspace;
  readonly root: Root;
  readonly prepared: PreparedDocument;
  /** The theme's CSS, already resolved. */
  readonly style: string;
  readonly options: BuildOptions;
  /** Where the artifact goes, without its extension. */
  readonly out: string;
  /** Anything the writer wants to say. */
  readonly diagnostics: BuildDiagnostic[];
  /** What changed since another version, when the build was told to compare. */
  readonly marks?: DiffMarks;
  /** Pictures from the web, fetched once before any writer ran. */
  readonly inlined?: ReadonlyMap<string, string>;
  /**
   * Every file the document was built from, the document first, as workspace
   * paths. A PDF carries their text so a reviewer's annotation can be traced
   * back to the bytes it is about.
   */
  readonly sources: readonly string[];
  /** Mermaid drawings as pictures, by source, made once before any writer ran. */
  readonly pictures?: ReadonlyMap<string, MermaidPicture>;
}

/**
 * Writes one format. HTML is built in; anything that needs more than strings —
 * PDF needs a browser to lay the document out — is supplied by the caller, so
 * that this package keeps no dependency on one.
 */
export type FormatWriter = (input: WriteInput) => Promise<Artifact | undefined> | Artifact | undefined;

export interface BuildOptions {
  /** Build only these roots. Everything with an `output:` when absent. */
  readonly only?: readonly string[];
  /**
   * Write these formats instead of the ones each document's `output:` asks
   * for. With `only`, a document that has no `output:` is built too.
   */
  readonly formats?: readonly string[];
  /** Where artifacts go. `dist` by default. */
  readonly outDir?: string;
  /** Theme name to fall back on when a document names none. */
  readonly theme?: string;
  /**
   * Where a theme's CSS comes from. A workspace may carry its own themes and
   * the product ships some of its own, and only the caller knows which is
   * which — the same reason images are fetched through the workspace.
   */
  readonly style?: (theme: string) => string | undefined;
  readonly commit?: string;
  /**
   * False when the working tree held changes the commit does not: the output
   * is then not that commit, and an anchor into it says so.
   */
  readonly clean?: boolean;
  /**
   * Whether a PDF carries the review so far as annotations a customer can read
   * and reply to. On unless turned off — a copy for delivery, say.
   */
  readonly reviewNotes?: boolean;
  readonly builtAt?: string;
  /**
   * Another version to mark changes against: a folder, a commit, whatever the
   * caller can read a file out of. Nothing is written into the sources.
   */
  readonly diffFrom?: { readonly name: string; readonly read: Previous };
  readonly showRemoved?: 'none' | 'strike';
  /** Writers for formats beyond `html`. */
  readonly writers?: Readonly<Record<string, FormatWriter>>;
  /**
   * The script that draws Mermaid in a delivered page. Laying a drawing out
   * needs a browser, and this package needs none, so the caller hands over the
   * script that does it — and the page does it when it is opened.
   */
  readonly mermaidScript?: string;
  /**
   * Draws one Mermaid source as a picture, for a slide. Only a caller with a
   * browser can; without one a slide shows the source instead and says so.
   */
  readonly mermaidPicture?: (source: string) => Promise<MermaidPicture | undefined>;
  /**
   * The language of the diagnostics and of what the build writes into the
   * document — the cover's labels, 目次, 図 and 表. It is the locale of whoever
   * builds; Japanese when nobody says.
   */
  readonly locale?: Locale;
}

/** A Mermaid drawing as a picture: a PNG data URL and its size in pixels. */
export interface MermaidPicture {
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

export interface BuildResult {
  readonly artifacts: readonly Artifact[];
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly graph: ReferenceGraph;
}

/** A document ready for any writer: expanded, numbered, and checked. */
export interface PreparedDocument {
  readonly root: string;
  readonly document: DocumentFile;
  readonly resolved: ResolvedDocument;
  readonly diagnostics: readonly BuildDiagnostic[];
}

export async function build(
  given: Workspace, options: BuildOptions = {},
): Promise<BuildResult> {
  const workspace = asLf(given);
  const locale = options.locale ?? DEFAULT_LOCALE;
  const graph = readGraph(workspace, locale);
  const diagnostics: BuildDiagnostic[] = [];
  const artifacts: Artifact[] = [];
  const outDir = options.outDir ?? 'dist';

  const wanted: Root[] = options.only === undefined
    ? [...graph.roots]
    : graph.roots.filter(root => options.only!.includes(root.path));

  if (options.only !== undefined) {
    for (const asked of options.only) {
      if (graph.roots.some(root => root.path === asked)) continue;
      // Asked for by name and told what to write, a document needs no `output:`
      // of its own: the person pressing "PDF" on it has said what they want.
      const named = options.formats === undefined ? undefined : namedRoot(workspace, asked);
      if (named) { wanted.push(named); continue; }
      diagnostics.push({
        severity: 'error', path: asked, ...said(locale, 'build.notRoot'),
      });
    }
  }

  for (const root of wanted) {
    const prepared = prepare(workspace, root, locale);
    diagnostics.push(...prepared.diagnostics);
    if (prepared.diagnostics.some(d => d.severity === 'error')) continue;

    const marks = options.diffFrom === undefined ? undefined : diffOf({
      workspace,
      previous: options.diffFrom.read,
      files: graph.closure.get(root.path) ?? [root.path],
      from: options.diffFrom.name,
      root: root.path,
      ...(options.showRemoved === undefined ? {} : { showRemoved: options.showRemoved }),
    });

    // Pictures on the web are taken in once, before any writer runs: every
    // format needs the same bytes, and fetching the same address per format
    // would be three requests for one picture.
    const inlined = await takeIn(workspace, prepared, diagnostics);
    // Drawn once, for the same reason: only a slide needs them as pictures.
    const pictures = (options.formats ?? root.formats).includes('pptx')
      ? await drawMermaid(workspace, prepared, options, diagnostics)
      : new Map<string, MermaidPicture>();

    for (const format of options.formats ?? root.formats) {
      const artifact = await write(
        workspace, root, prepared, format, outDir, options, diagnostics, marks, inlined, pictures,
        graph.closure.get(root.path) ?? [root.path]);
      if (artifact) artifacts.push(artifact);
    }
  }

  return { artifacts, diagnostics: [...graph.diagnostics, ...diagnostics], graph };
}

/** A document that is not a root, built because it was named. */
function namedRoot(workspace: Workspace, path: string): Root | undefined {
  const source = workspace.read(path);
  if (source === undefined) return undefined;
  try {
    const document = parseDocument(source);
    return { path, document, formats: document.frontmatter.output };
  } catch {
    return undefined;
  }
}

/** Expands and numbers one root, so that every writer starts from the same thing. */
export function prepare(given: Workspace, root: Root, locale: Locale = DEFAULT_LOCALE): PreparedDocument {
  const workspace = asLf(given);
  const diagnostics: BuildDiagnostic[] = [];
  const expansion = expandDocument(root.document, root.path, path => workspace.read(path), locale);
  for (const d of expansion.diagnostics) {
    diagnostics.push({ severity: d.severity, message: d.message, path: d.path, span: d.span });
  }

  const resolved = resolveDocument(expansion.document, locale);
  for (const d of resolved.diagnostics) {
    diagnostics.push({
      severity: d.severity, message: d.message, path: d.doc ?? root.path, span: d.span,
    });
  }
  return { root: root.path, document: expansion.document, resolved, diagnostics };
}

/**
 * Fetches every `http(s)` picture the document points at.
 *
 * Nothing is written to the workspace — the document keeps saying the address —
 * but the output carries the bytes, so the file that is delivered needs no
 * network. A picture that cannot be had is reported and the figure says so;
 * it is never quietly left as a link.
 */
export async function takeIn(
  workspace: Workspace, prepared: PreparedDocument, diagnostics: BuildDiagnostic[],
): Promise<ReadonlyMap<string, string>> {
  const addresses = new Set<string>();
  for (const block of prepared.document.blocks) {
    if (block.kind === 'import' && isAddress(block.path)) addresses.add(block.path);
  }
  const inlined = new Map<string, string>();
  if (addresses.size === 0) return inlined;
  const { locale } = prepared.resolved;
  if (!workspace.inline) {
    diagnostics.push({
      severity: 'warning', path: prepared.root,
      ...said(locale, 'build.cannotInline', { count: addresses.size }),
    });
    return inlined;
  }
  for (const address of addresses) {
    const data = await workspace.inline(address).catch(() => undefined);
    if (data === undefined) {
      diagnostics.push({
        severity: 'warning', path: prepared.root,
        ...said(locale, 'build.inlineFailed', { address }),
      });
      continue;
    }
    inlined.set(address, data);
  }
  return inlined;
}

/**
 * The Mermaid sources a document shows as drawings: its Mermaid code blocks
 * and the `.mmd` files it takes in, except those the author chose to show as
 * code only.
 */
export function mermaidSources(given: Workspace, document: DocumentFile): string[] {
  const workspace = asLf(given);
  const found = new Set<string>();
  for (const block of document.blocks) {
    if (block.kind === 'prose') {
      for (const fence of fencesOf(block.text)) {
        if (fence.language === 'mermaid' && viewOf(fence.attributes.get('view')) !== 'code') {
          found.add(fence.content);
        }
      }
    } else if (block.kind === 'import' && /\.(mmd|mermaid)$/i.test(block.path)
      && viewOf(block.attributes.get('view')) !== 'code') {
      const source = workspace.read(block.path);
      if (source !== undefined) found.add(source);
    }
  }
  return [...found];
}

/** Every drawing a slide will show, made once. */
async function drawMermaid(
  workspace: Workspace, prepared: PreparedDocument, options: BuildOptions,
  diagnostics: BuildDiagnostic[],
): Promise<Map<string, MermaidPicture>> {
  const pictures = new Map<string, MermaidPicture>();
  const sources = mermaidSources(workspace, prepared.document);
  const { locale } = prepared.resolved;
  if (sources.length === 0) return pictures;
  if (!options.mermaidPicture) {
    diagnostics.push({
      severity: 'warning', path: prepared.root,
      ...said(locale, 'build.noMermaidPicture', { count: sources.length }),
    });
    return pictures;
  }
  for (const source of sources) {
    try {
      const picture = await options.mermaidPicture(source);
      if (picture) pictures.set(source, picture);
    } catch (error) {
      diagnostics.push({
        severity: 'warning', path: prepared.root,
        ...said(locale, 'build.mermaidFailed', { message: describeError(error, locale) }),
      });
    }
  }
  return pictures;
}

async function write(
  workspace: Workspace, root: Root, prepared: PreparedDocument, format: string,
  outDir: string, options: BuildOptions, diagnostics: BuildDiagnostic[],
  marks: DiffMarks | undefined, inlined: ReadonlyMap<string, string>,
  pictures: ReadonlyMap<string, MermaidPicture>, sources: readonly string[],
): Promise<Artifact | undefined> {
  const builtIn: Record<string, FormatWriter | undefined> = { html, pptx };
  const { locale } = prepared.resolved;
  const writer = builtIn[format] ?? options.writers?.[format];
  if (!writer) {
    // P6: a format that is asked for and not written is said out loud rather
    // than passed over in silence.
    diagnostics.push({
      severity: 'warning', path: root.path,
      ...said(locale, 'build.noWriter', { format }),
    });
    return undefined;
  }

  const theme = root.document.frontmatter.theme ?? options.theme ?? 'default';
  const style = options.style
    ? options.style(theme)
    : themeOf(path => workspace.read(path), theme);
  if (style === undefined) {
    diagnostics.push({
      severity: 'error', path: root.path, ...said(locale, 'build.noTheme', { theme }),
    });
    return undefined;
  }

  try {
    return await writer({
      workspace, root, prepared, style, options, diagnostics, inlined, pictures, sources,
      ...(marks === undefined ? {} : { marks }),
      out: `${outDir}/${outputStem(root.path)}`,
    });
  } catch (error) {
    diagnostics.push({
      severity: 'error', path: root.path,
      ...said(locale, 'build.writeFailed', { format, message: describeError(error, locale) }),
    });
    return undefined;
  }
}

/**
 * Where a PDF came from, for the review map it carries: the files it was built
 * from as the build read them (LF), and the commit. A PDF writer passes this to
 * `writePdf` as `review`.
 */
export function reviewSourceOf(input: WriteInput): {
  document: string; number?: string; commit?: string; clean?: boolean; files: Record<string, string>;
  notes: ReviewNoteSource[]; locale: Locale;
} {
  const files: Record<string, string> = {};
  for (const path of input.sources) {
    const text = input.workspace.read(path);
    if (text !== undefined) files[path] = text;
  }
  return {
    document: input.root.path,
    ...(input.options.commit === undefined ? {} : { commit: input.options.commit }),
    ...(input.options.clean === undefined ? {} : { clean: input.options.clean }),
    files,
    ...(numberOf(input.root.document.frontmatter.raw) ? { number: numberOf(input.root.document.frontmatter.raw)! } : {}),
    notes: input.options.reviewNotes === false ? []
      : reviewNotesOf(input.workspace, input.root.path, numberOf(input.root.document.frontmatter.raw)),
    locale: input.prepared.resolved.locale,
  };
}

/**
 * Where a workspace keeps a theme, in the order they are looked for: the
 * team's own, set up with the folder (`.docpresenter/themes/<name>/`), then a
 * `themes/<name>/` at the root.
 */
export function themePaths(theme: string): string[] {
  return [`.docpresenter/themes/${theme}/theme.css`, `themes/${theme}/theme.css`];
}

/** A workspace's own theme, or undefined when it has none and the shipped one applies. */
export function themeOf(read: (path: string) => string | undefined, theme: string): string | undefined {
  for (const path of themePaths(theme)) {
    const css = read(path);
    if (css !== undefined) return css;
  }
  return undefined;
}

/** A document's number from its frontmatter, or undefined. */
function numberOf(raw: Readonly<Record<string, unknown>>): string | undefined {
  const value = raw['document'];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

/** A comment the PDF carries, where its words are now (pdf/src/review-notes.ts). */
export interface ReviewNoteSource {
  readonly key: string;
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly body: string;
  readonly status: string;
  readonly author?: string;
  readonly date?: string;
  readonly replies: { key: string; body: string; author?: string; date?: string }[];
}

/**
 * The comments made on a document, from every review file in the workspace,
 * each where its words are now (design/review-model.md §3.2). One whose words
 * are gone is left out of the PDF; it stays in the review file.
 */
export function reviewNotesOf(workspace: Workspace, document: string, number?: string): ReviewNoteSource[] {
  const read = asLf(workspace);
  const notes: ReviewNoteSource[] = [];
  for (const round of workspace.list().filter(path => /\.review\.yml$/i.test(path)).sort()) {
    for (const comment of parseReviewFile(read.read(round) ?? '', round)) {
      if (!isAbout(comment, document, number) || comment.status === 'orphaned') continue;
      const file = anchorFileOf(comment, document);
      if (!file || comment.start === undefined || comment.end === undefined || comment.quote === undefined) continue;
      const current = read.read(file);
      if (current === undefined) continue;
      const at = locateAnchor({ start: comment.start, end: comment.end, quote: comment.quote }, current);
      if (at.state === 'lost') continue;
      const key = `dp-review:${round}#${comment.id}`;
      notes.push({
        key, file, start: at.start, end: at.end,
        body: comment.body, status: comment.status,
        ...(comment.author ? { author: comment.author } : {}),
        ...(comment.date ? { date: comment.date } : {}),
        // The answer first, then what was said after it, as a thread reads.
        replies: [
          ...(comment.reply ? [{ key: `${key}/answer`, body: comment.reply }] : []),
          ...comment.replies.map((reply, i) => ({
            key: `${key}/r${i + 1}`, body: reply.body,
            ...(reply.author ? { author: reply.author } : {}), ...(reply.date ? { date: reply.date } : {}),
          })),
        ],
      });
    }
  }
  return notes;
}

/**
 * Slides. Built in rather than injected because, unlike the PDF, nothing here
 * needs a browser: the drawing model already holds the shapes, which is the
 * whole point of the format (design/pptx-model.md §1.1).
 */
function pptx(input: WriteInput): Artifact {
  const { root, prepared } = input;
  const raw = root.document.frontmatter.raw;
  const title = String(raw['title'] ?? root.path);
  const { locale } = prepared.resolved;
  const foot = [raw['document'],
    raw['version'] ? BUILD_MESSAGES.in(locale)('build.foot.version', { version: String(raw['version']) }) : '']
    .filter(value => value !== undefined && value !== '').join('　');
  const deck = deckOf({
    root: root.path,
    workspace: input.workspace,
    document: prepared.document,
    resolved: prepared.resolved,
    title,
    ...(foot ? { foot } : {}),
    ...(input.marks === undefined ? {} : { marks: input.marks }),
    ...(input.pictures === undefined ? {} : { pictures: input.pictures }),
  });
  for (const message of deck.diagnostics) {
    input.diagnostics.push({ severity: 'warning', path: root.path, message });
  }
  return {
    path: `${input.out}.pptx`, bytes: writePptx(deck), root: root.path, format: 'pptx',
  };
}

/** The built-in writer. Everything it needs is a string. */
function html(input: WriteInput): Artifact {
  const { root, prepared, options } = input;
  const text = renderPage({
    workspace: input.workspace,
    document: prepared.document,
    resolved: prepared.resolved,
    style: input.style,
    root: root.path,
    ...(input.inlined === undefined ? {} : { inlined: input.inlined }),
    ...(input.marks === undefined ? {} : { marks: input.marks }),
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    ...(options.builtAt === undefined ? {} : { builtAt: options.builtAt }),
    ...(options.mermaidScript === undefined ? {} : { mermaidScript: options.mermaidScript }),
  });
  // P6: a drawing that will show as its source is said out loud.
  if (options.mermaidScript === undefined && hasMermaid(text)) {
    input.diagnostics.push({
      severity: 'warning', path: root.path,
      ...said(prepared.resolved.locale, 'build.noMermaidScript'),
    });
  }
  return { path: `${input.out}.html`, text, root: root.path, format: 'html' };
}

/**
 * Where a document's exports go under the output folder: its own path, so
 * documents in folders keep their folders and two `design.md` in two folders
 * never write over each other. Nothing is left off, so the output folder
 * mirrors the workspace whatever writes it (VS Code, the CLI, the web page):
 * `docs/order/design.md` becomes `docs/order/design`.
 */
export function outputStem(path: string): string {
  return path.replace(/^\.?\/+/, '').replace(/\.[^./]+$/, '');
}
