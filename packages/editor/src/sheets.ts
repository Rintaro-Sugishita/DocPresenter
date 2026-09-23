// Sheet operations. A sheet is the span between two `---`, so adding, moving
// and deleting one is arithmetic on byte ranges — there is no sheet object in
// the file to keep in step.
//
// Moving sheets rewrites the whole run between the two positions involved,
// because that is what changed. The joins inside that run are normalised to
// `\n\n---\n\n`; everything inside each sheet is carried across verbatim.

import { sheetsOf, sliceBytes, type DocumentFile, type Sheet } from '@docpresenter/core';
import type { Edit } from './edit.js';

const JOIN = '\n\n---\n\n';

export class SheetEditError extends Error {}

/** Moves the sheet at `from` (1-based) so that it ends up at `to`. */
export function moveSheet(document: DocumentFile, source: string, from: number, to: number): Edit {
  const sheets = sheetsOf(document);
  const a = at(sheets, from);
  const b = at(sheets, to);
  if (from === to) return { span: a.span, text: bodyOf(source, a), description: '移動なし' };

  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const run = sheets.slice(low - 1, high);
  const moving = run.splice(from - low, 1)[0]!;
  run.splice(to - low, 0, moving);

  return {
    span: { start: sheets[low - 1]!.span.start, end: sheets[high - 1]!.span.end },
    text: run.map(sheet => bodyOf(source, sheet)).join(JOIN),
    description: `シート「${a.title}」を ${b.index} 番目へ移動`,
  };
}

/**
 * Adds a sheet after the given one. The new sheet is empty: Excel's new sheet
 * is empty too, and a placeholder heading would only have to be deleted.
 */
export function insertSheet(document: DocumentFile, source: string, after: number): Edit {
  const sheets = sheetsOf(document);
  const previous = at(sheets, after);
  return {
    span: { start: previous.span.end, end: previous.span.end },
    text: '\n\n---\n',
    description: `シート ${after + 1} を追加`,
  };
}

/** Removes a sheet, and the separator that divided it from its neighbour. */
export function removeSheet(document: DocumentFile, source: string, index: number): Edit {
  const sheets = sheetsOf(document);
  const sheet = at(sheets, index);
  if (sheets.length === 1) {
    throw new SheetEditError('最後のシートは削除できない');
  }
  // Take the separator on the side where there is one, so the remaining
  // sheets stay divided by exactly one `---`.
  const span = index > 1
    ? { start: sheets[index - 2]!.span.end, end: sheet.span.end }
    : { start: sheet.span.start, end: sheets[index]!.span.start };
  return { span, text: '', description: `シート「${sheet.title}」を削除` };
}

/**
 * Renames a sheet by rewriting the heading it takes its name from — the name
 * is not stored anywhere else, so there is nothing else to rewrite. A sheet
 * with no heading has no name to change.
 */
export function renameSheet(
  document: DocumentFile, source: string, index: number, title: string,
): Edit {
  const sheet = at(sheetsOf(document), index);
  const heading = sheet.blocks.find(block => block.kind === 'heading');
  if (!heading || heading.kind !== 'heading') {
    throw new SheetEditError('見出しの無いシートには名前が無い（見出しを足すこと）');
  }
  const written = sliceBytes(source, heading.span.start, heading.span.end);
  const renamed = written.replace(heading.text, title);
  if (renamed === written && heading.text !== title) {
    throw new SheetEditError('見出しの書き換えに失敗した');
  }
  return {
    span: heading.span,
    text: renamed,
    description: `シート「${sheet.title}」を「${title}」に改名`,
  };
}

function at(sheets: readonly Sheet[], index: number): Sheet {
  const sheet = sheets[index - 1];
  if (!sheet) throw new SheetEditError(`シート ${index} は無い（全 ${sheets.length} 枚）`);
  return sheet;
}

function bodyOf(source: string, sheet: Sheet): string {
  return sliceBytes(source, sheet.span.start, sheet.span.end);
}
