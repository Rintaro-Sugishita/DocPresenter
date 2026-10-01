// Pulls an included document into the one that includes it.
//
// A build root may `@import` another `.md`, and the result has to be one
// document: numbering runs over the whole of it, `---` breaks a page wherever
// it was written, and a reference reaches across the seam. So expansion
// produces a document of the same shape as a parsed one, and everything
// downstream — numbering, sheets, rendering — works without knowing that more
// than one file was involved.
//
// Two things are rewritten on the way through. Every import path becomes
// workspace-relative, so that a path written inside an included file still
// points where its author meant it to; and every block from an included file
// carries `doc`, because a byte range means nothing without the file it ranges
// over.

import { joinPath } from '../html/path.js';
import { isAddress } from '../html/render.js';
import { parseDocument } from './parse.js';
import type { Block, DocumentFile, Import } from './model.js';

/** Reads a file by its workspace-relative path. */
export type DocumentReader = (path: string) => string | undefined;

export interface Expansion {
  /** The root document with every included document folded into its blocks. */
  readonly document: DocumentFile;
  /** Every file that took part, the root first, in the order they were reached. */
  readonly documents: readonly string[];
  readonly diagnostics: readonly ExpansionDiagnostic[];
}

export interface ExpansionDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** The file the problem is in. */
  readonly path: string;
  readonly span: { readonly start: number; readonly end: number };
}

const DOCUMENT = /\.md$/i;

export function expandDocument(
  root: DocumentFile, rootPath: string, read: DocumentReader,
): Expansion {
  const documents: string[] = [rootPath];
  const diagnostics: ExpansionDiagnostic[] = [];

  /** The chain of files currently being expanded, so a cycle is caught in it. */
  const open: string[] = [];

  const expand = (document: DocumentFile, path: string): Block[] => {
    open.push(path);
    const blocks: Block[] = [];
    for (const block of document.blocks) {
      if (block.kind !== 'import') {
        blocks.push(at(block, path, rootPath));
        continue;
      }
      // An address is not a path. Resolving it against the document's folder
      // would turn `https://…` into `https:/…` — a file nobody has.
      if (isAddress(block.path)) { blocks.push(at(block, path, rootPath)); continue; }
      const target = joinPath(path, block.path);
      const rewritten: Import = { ...at(block, path, rootPath), path: target };

      if (!DOCUMENT.test(target)) { blocks.push(rewritten); continue; }

      if (open.includes(target)) {
        diagnostics.push({
          severity: 'error', path,
          message: `参照が循環している: ${[...open, target].join(' → ')}`,
          span: block.span,
        });
        continue;
      }
      const source = read(target);
      if (source === undefined) {
        diagnostics.push({
          severity: 'error', path,
          message: `参照先が見つからない: ${target}`,
          span: block.span,
        });
        continue;
      }
      let included: DocumentFile;
      try {
        included = parseDocument(source);
      } catch (error) {
        diagnostics.push({
          severity: 'error', path,
          message: `${target} を読めない: ${error instanceof Error ? error.message : String(error)}`,
          span: block.span,
        });
        continue;
      }
      if (!documents.includes(target)) documents.push(target);
      // The included document's own frontmatter is not carried over: the root
      // decides the theme and the outputs. Its blocks are what is wanted.
      blocks.push(...expand(included, target));
    }
    open.pop();
    return blocks;
  };

  const blocks = expand(root, rootPath);
  return {
    document: { frontmatter: root.frontmatter, blocks },
    documents,
    diagnostics,
  };
}

/**
 * Marks a block with the file it came from. The root's own blocks are left
 * unmarked: `doc` answers "which other file", and setting it everywhere would
 * put the root's path on every element of every output for nothing.
 */
function at<T extends Block>(block: T, path: string, rootPath: string): T {
  return path === rootPath ? block : { ...block, doc: path };
}
