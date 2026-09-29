// The build: roots in, artifacts out.
//
// Everything a format writer needs is prepared once here — the expanded
// document, its numbering, its diagnostics — because a document built to two
// formats must be the same document in both. A PDF whose figure numbers differ
// from the HTML's is worse than no PDF.

import {
  expandDocument, resolveDocument, type DocumentFile, type ResolvedDocument,
} from '@docpresenter/markdown';
import { readGraph, type ReferenceGraph, type Root } from './graph.js';
import { renderPage } from './html.js';
import type { Artifact, BuildDiagnostic, Workspace } from './workspace.js';

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

export function build(workspace: Workspace, options: BuildOptions = {}): BuildResult {
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

    for (const format of root.formats) {
      const artifact = write(workspace, root, prepared, format, outDir, options, diagnostics);
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

function write(
  workspace: Workspace, root: Root, prepared: PreparedDocument, format: string,
  outDir: string, options: BuildOptions, diagnostics: BuildDiagnostic[],
): Artifact | undefined {
  if (format !== 'html') {
    // P6: a format that is asked for and not written is said out loud rather
    // than passed over in silence.
    diagnostics.push({
      severity: 'warning', path: root.path,
      message: `${format} 出力はまだ実装していない`,
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

  const text = renderPage({
    workspace,
    document: prepared.document,
    resolved: prepared.resolved,
    style,
    root: root.path,
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    ...(options.builtAt === undefined ? {} : { builtAt: options.builtAt }),
  });

  return { path: `${outDir}/${basename(root.path)}.html`, text, root: root.path, format };
}

/** `docs/auth-design.md` becomes `auth-design`. */
function basename(path: string): string {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.replace(/\.[^.]+$/, '');
}
