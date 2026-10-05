// Where a file is, said two ways.
//
// The workspace holds files by their path from its root (`docs/x/y.dgm`) —
// that is what the build sees and what VS Code opens. A document refers to
// them from where it sits (`x/y.dgm`, `../shared/parts.dgm`). Both are
// written down in this product, so the translation has to be exact: the
// moment they drift, the figure on screen and the figure in the PDF are
// different files.

import { joinPath } from '@docpresenter/markdown';

/** A path as written in a document, resolved against the workspace root. */
export function inWorkspace(documentPath: string, written: string): string {
  return joinPath(documentPath, written.startsWith('./') ? written.slice(2) : written);
}

/** A workspace path, written the way the document would refer to it. */
export function inDocument(documentPath: string, path: string): string {
  const base = documentPath.includes('/')
    ? documentPath.slice(0, documentPath.lastIndexOf('/'))
    : '';
  if (base === '') return path;
  if (path === base) return '.';
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  // Up and over. Only as many `..` as the two paths differ by, so a reference
  // to a neighbouring folder reads the way somebody would have written it.
  const from = base.split('/');
  const to = path.split('/');
  let same = 0;
  while (same < from.length && same < to.length && from[same] === to[same]) same += 1;
  return [...Array.from({ length: from.length - same }, () => '..'), ...to.slice(same)].join('/');
}

/**
 * The folder a document keeps its figures and tables in.
 *
 * The convention the sample uses: `docs/auth-design.md` keeps them in
 * `docs/auth-design/`. One folder per document means a figure's name only has
 * to be unique inside the document that shows it.
 */
export function resourceFolder(documentPath: string): string {
  return documentPath.replace(/\.md$/i, '');
}

/** A name nobody in the folder is using, numbered so it reads in a diff. */
export function freeName(
  folder: string, stem: string, extension: string, taken: ReadonlySet<string>,
): string {
  for (let n = 1; ; n += 1) {
    const path = `${folder}/${stem}-${n}.${extension}`;
    if (!taken.has(path)) return path;
  }
}
