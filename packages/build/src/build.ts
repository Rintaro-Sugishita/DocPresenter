// The build: roots in, artifacts out.
//
// Everything a format writer needs is prepared once here — the expanded
// document, its numbering, its diagnostics — because a document built to two
// formats must be the same document in both. A PDF whose figure numbers differ
// from the HTML's is worse than no PDF.

import {
  expandDocument, isAddress, resolveDocument,
  type DiffMarks, type DocumentFile, type ResolvedDocument,
} from '@docpresenter/markdown';
import { writePptx } from '@docpresenter/pptx';
import { deckOf } from './deck.js';
import { diffOf, type Previous } from './diff.js';
import { readGraph, type ReferenceGraph, type Root } from './graph.js';
import { renderPage } from './html.js';
import type { Artifact, BuildDiagnostic, Workspace } from './workspace.js';

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
  workspace: Workspace, options: BuildOptions = {},
): Promise<BuildResult> {
  const graph = readGraph(workspace);
  const diagnostics: BuildDiagnostic[] = [];
  const artifacts: Artifact[] = [];
  const outDir = options.outDir ?? 'dist';

  const wanted = options.only === undefined
    ? graph.roots
    : graph.roots.filter(root => options.only!.includes(root.path));

  if (options.only !== undefined) {
    for (const asked of options.only) {
      if (!graph.roots.some(root => root.path === asked)) {
        diagnostics.push({
          severity: 'error', path: asked,
          message: 'ビルドルートではない（frontmatter に output が無い）',
        });
      }
    }
  }

  for (const root of wanted) {
    const prepared = prepare(workspace, root);
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

    for (const format of root.formats) {
      const artifact = await write(
        workspace, root, prepared, format, outDir, options, diagnostics, marks, inlined);
      if (artifact) artifacts.push(artifact);
    }
  }

  return { artifacts, diagnostics: [...graph.diagnostics, ...diagnostics], graph };
}

/** Expands and numbers one root, so that every writer starts from the same thing. */
export function prepare(workspace: Workspace, root: Root): PreparedDocument {
  const diagnostics: BuildDiagnostic[] = [];
  const expansion = expandDocument(root.document, root.path, path => workspace.read(path));
  for (const d of expansion.diagnostics) {
    diagnostics.push({ severity: d.severity, message: d.message, path: d.path, span: d.span });
  }

  const resolved = resolveDocument(expansion.document);
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
  if (!workspace.inline) {
    diagnostics.push({
      severity: 'warning', path: prepared.root,
      message: `外部の画像を取り込めない器で建てている（${addresses.size} 件）`,
    });
    return inlined;
  }
  for (const address of addresses) {
    const data = await workspace.inline(address).catch(() => undefined);
    if (data === undefined) {
      diagnostics.push({
        severity: 'warning', path: prepared.root,
        message: `外部の画像を取り込めなかった: ${address}`,
      });
      continue;
    }
    inlined.set(address, data);
  }
  return inlined;
}

async function write(
  workspace: Workspace, root: Root, prepared: PreparedDocument, format: string,
  outDir: string, options: BuildOptions, diagnostics: BuildDiagnostic[],
  marks: DiffMarks | undefined, inlined: ReadonlyMap<string, string>,
): Promise<Artifact | undefined> {
  const builtIn: Record<string, FormatWriter | undefined> = { html, pptx };
  const writer = builtIn[format] ?? options.writers?.[format];
  if (!writer) {
    // P6: a format that is asked for and not written is said out loud rather
    // than passed over in silence.
    diagnostics.push({
      severity: 'warning', path: root.path,
      message: `${format} 出力はこの環境では書けない（書き手が渡されていない）`,
    });
    return undefined;
  }

  const theme = root.document.frontmatter.theme ?? options.theme ?? 'default';
  const style = options.style
    ? options.style(theme)
    : workspace.read(`themes/${theme}/theme.css`);
  if (style === undefined) {
    diagnostics.push({
      severity: 'error', path: root.path, message: `テーマが見つからない: ${theme}`,
    });
    return undefined;
  }

  try {
    return await writer({
      workspace, root, prepared, style, options, diagnostics, inlined,
      ...(marks === undefined ? {} : { marks }),
      out: `${outDir}/${basename(root.path)}`,
    });
  } catch (error) {
    diagnostics.push({
      severity: 'error', path: root.path,
      message: `${format} を書けなかった: ${error instanceof Error ? error.message : String(error)}`,
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
  const foot = [raw['document'], raw['version'] ? `版 ${String(raw['version'])}` : '']
    .filter(value => value !== undefined && value !== '').join('　');
  const deck = deckOf({
    workspace: input.workspace,
    document: prepared.document,
    resolved: prepared.resolved,
    title,
    ...(foot ? { foot } : {}),
    ...(input.marks === undefined ? {} : { marks: input.marks }),
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
  });
  return { path: `${input.out}.html`, text, root: root.path, format: 'html' };
}

/** `docs/auth-design.md` becomes `auth-design`. */
function basename(path: string): string {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.replace(/\.[^.]+$/, '');
}
