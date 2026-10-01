// The reference graph: which files a build root pulls in, and what is wrong.
//
// Two scans, and they are not the same scan. Roots are looked for across the
// whole workspace, because a document declares itself a root in its own
// frontmatter and nothing else knows where they are. What goes into one
// artifact is the transitive closure of `@import` from that root, and nothing
// else: a file nobody imports is not part of anybody's build, which is worth
// saying out loud rather than quietly leaving out.

import { parseDiagram } from '@docpresenter/diagram';
import {
  isAddress, isBuildRoot, joinPath, parseDocument, type DocumentFile,
} from '@docpresenter/markdown';
import type { BuildDiagnostic, Workspace } from './workspace.js';

export interface Root {
  readonly path: string;
  readonly document: DocumentFile;
  /** The formats its frontmatter asks for. */
  readonly formats: readonly string[];
}

export interface ReferenceGraph {
  readonly roots: readonly Root[];
  /** Every file each root reaches, the root itself first. */
  readonly closure: ReadonlyMap<string, readonly string[]>;
  /** Files no root reaches and which are not roots themselves. */
  readonly orphans: readonly string[];
  readonly diagnostics: readonly BuildDiagnostic[];
}

const MARKDOWN = /\.md$/i;
/** Files that are content rather than something a document would import. */
const NOT_CONTENT = /(^|\/)(node_modules|dist|out|\.git)\//;

export function readGraph(workspace: Workspace): ReferenceGraph {
  const diagnostics: BuildDiagnostic[] = [];
  const files = workspace.list().filter(path => !NOT_CONTENT.test(path));

  const parsed = new Map<string, DocumentFile>();
  for (const path of files.filter(p => MARKDOWN.test(p))) {
    const source = workspace.read(path);
    if (source === undefined) continue;
    try {
      parsed.set(path, parseDocument(source));
    } catch (error) {
      // A document that will not parse is only a build failure when something
      // asks for it; until then it is a warning, so that a half-written note in
      // the repository does not stop every other document being built.
      diagnostics.push({
        severity: 'warning', path,
        message: `読めない: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const roots: Root[] = [];
  for (const [path, document] of parsed) {
    if (isBuildRoot(document)) {
      roots.push({ path, document, formats: document.frontmatter.output });
    }
  }
  roots.sort((a, b) => a.path.localeCompare(b.path));

  const present = new Set(files);
  const closure = new Map<string, readonly string[]>();
  const reached = new Set<string>();
  for (const root of roots) {
    const found = walk(root, workspace, parsed, present, diagnostics);
    closure.set(root.path, found);
    for (const path of found) reached.add(path);
  }

  if (roots.length === 0) {
    diagnostics.push({
      severity: 'warning', path: '',
      message: 'frontmatter に output を持つ文書が無い。ビルドするものが何も無い',
    });
  }

  const orphans = files
    .filter(path => CONTENT.test(path) && !reached.has(path))
    .sort();
  for (const path of orphans) {
    diagnostics.push({
      severity: 'warning', path,
      message: 'どの成果物にも含まれていない',
    });
  }

  return { roots, closure, orphans, diagnostics };
}

/** Extensions a document can import, and so the ones an orphan can be. */
const CONTENT = /\.(md|dgm|table|mmd|ermlx|csv|png|jpe?g|gif|svg)$/i;

/** The files one root reaches, depth first, with each one listed once. */
function walk(
  root: Root, workspace: Workspace, parsed: ReadonlyMap<string, DocumentFile>,
  present: ReadonlySet<string>, diagnostics: BuildDiagnostic[],
): readonly string[] {
  const found: string[] = [];
  const open: string[] = [];

  const visit = (path: string, document: DocumentFile): void => {
    open.push(path);
    if (!found.includes(path)) found.push(path);

    for (const block of document.blocks) {
      if (block.kind !== 'import') continue;
      // A picture on the web is not part of the workspace: it has no file to
      // find and no closure to walk. The build takes it in when it writes.
      if (isAddress(block.path)) continue;
      const target = joinPath(path, block.path);

      if (open.includes(target)) {
        diagnostics.push({
          severity: 'error', path,
          message: `参照が循環している: ${[...open, target].join(' → ')}`,
          span: block.span,
        });
        continue;
      }
      if (!present.has(target)) {
        diagnostics.push({
          severity: 'error', path,
          message: `参照先が見つからない: ${target}`,
          span: block.span,
        });
        continue;
      }
      if (!found.includes(target)) found.push(target);

      // Only a document has imports of its own to follow. A drawing has one
      // kind of reference — the image an overlay annotates — and it is followed
      // here so that the image is not reported as a file nobody uses.
      const included = MARKDOWN.test(target) ? parsed.get(target) : undefined;
      if (included) { visit(target, included); continue; }
      const image = overlayImage(target, workspace);
      if (image !== undefined && !found.includes(image)) found.push(image);
    }
    open.pop();
  };

  visit(root.path, root.document);
  return found;
}

/** The image a `.dgm` overlay annotates, if that is what the file is. */
function overlayImage(path: string, workspace: Workspace): string | undefined {
  if (!/\.dgm$/i.test(path)) return undefined;
  const source = workspace.read(path);
  if (source === undefined) return undefined;
  try {
    const diagram = parseDiagram(source);
    return diagram.image === undefined ? undefined : joinPath(path, diagram.image);
  } catch {
    // A drawing that will not parse is reported where it is rendered, with the
    // source beside it; failing the whole scan here would say less, later.
    return undefined;
  }
}
