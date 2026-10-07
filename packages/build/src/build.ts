// The build: roots in, artifacts out.
//
// Everything a format writer needs is prepared once here — the expanded
// document, its numbering, its diagnostics — because a document built to two
// formats must be the same document in both. A PDF whose figure numbers differ
// from the HTML's is worse than no PDF.

import {
  expandDocument, fencesOf, isAddress, parseDocument, resolveDocument, viewOf,
  type DiffMarks, type DocumentFile, type ResolvedDocument,
} from '@docpresenter/markdown';
import { writePptx } from '@docpresenter/pptx';
import { DEFAULT_LOCALE, describeError, type Locale } from '@docpresenter/base';
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
        workspace, root, prepared, format, outDir, options, diagnostics, marks, inlined, pictures);
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
      severity: d.severity, message: d.message, path: root.path, span: d.span,
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
  pictures: ReadonlyMap<string, MermaidPicture>,
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
    : workspace.read(`themes/${theme}/theme.css`);
  if (style === undefined) {
    diagnostics.push({
      severity: 'error', path: root.path, ...said(locale, 'build.noTheme', { theme }),
    });
    return undefined;
  }

  try {
    return await writer({
      workspace, root, prepared, style, options, diagnostics, inlined, pictures,
      ...(marks === undefined ? {} : { marks }),
      out: `${outDir}/${basename(root.path)}`,
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

/** `docs/auth-design.md` becomes `auth-design`. */
function basename(path: string): string {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.replace(/\.[^.]+$/, '');
}
