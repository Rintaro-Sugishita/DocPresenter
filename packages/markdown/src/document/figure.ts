// Changing what a figure is called: its file, its caption, its label.
//
// All three live in the document as text — the path and the attributes on the
// `@import` line, and the label again in every `@label` that refers to it — so
// renaming is rewriting those places and nothing else. The places can be far
// apart, but each is rewritten in place: the result is one replacement whose
// text is the original with only those bytes changed, and the diff shows the
// lines that name the figure and no others.

import { LocalizedError, sliceBytes } from '@docpresenter/base';
import { setImportAttribute } from './attributes.js';
import { parseDocument } from './parse.js';
import { joinPath } from '../html/path.js';
import type { ByteSpan } from './model.js';
import { md } from '../messages.js';

/** One place to rewrite, in bytes of the text it was measured on. */
export interface Replacement {
  readonly span: ByteSpan;
  readonly text: string;
}

/** What a label may look like. The prefix says what kind of thing it names. */
export const LABEL_PATTERN = /^(fig|tbl|sec|req|des|tst)-[A-Za-z0-9_-]+$/;

/** The label prefix a figure of this kind takes: `fig` for a drawing, `tbl` for a table. */
export function labelPrefixFor(path: string): 'fig' | 'tbl' {
  return /\.(table|csv)$/i.test(path) ? 'tbl' : 'fig';
}

const LINE = /^(\s*)(@import\s+"([^"]+)"|!\[([^\]]*)\]\(([^)]+)\))(\s*(?:\{.*\})?\s*)$/;

/** Sets or removes the `#label` on an `@import` line, keeping everything else as written. */
export function setImportLabel(line: string, label: string | undefined): string {
  const found = LINE.exec(line);
  if (!found) return line;
  const [, lead, head, , , , tail] = found;
  const inside = /\{(.*)\}/.exec(tail!)?.[1] ?? '';
  const rest = inside.replace(/#[A-Za-z0-9_-]+/, '').trim();
  const parts = [...(label ? [`#${label}`] : []), ...(rest === '' ? [] : [rest])];
  return `${lead}${head}${parts.length === 0 ? '' : ` {${parts.join(' ')}}`}`;
}

/** Points an `@import` line at another path, keeping its attributes. */
export function setImportPath(line: string, path: string): string {
  const found = LINE.exec(line);
  if (!found) return line;
  const [, lead, , , alt, , tail] = found;
  const head = found[3] !== undefined ? `@import "${path}"` : `![${alt}](${path})`;
  return `${lead}${head}${tail}`;
}

/** What a figure is to be called. Absent means "leave as it is"; an empty string removes. */
export interface FigureNames {
  /** The path as the document should write it. */
  readonly path?: string;
  readonly caption?: string;
  readonly label?: string;
}

/**
 * Takes out the `@import` line at `span`, with the blank lines that kept it
 * apart from what follows — so the paragraphs either side end up one blank
 * line apart, as they were before it was put there.
 */
export function removeImportLine(source: string, span: ByteSpan): Replacement {
  const bytes = new TextEncoder().encode(source);
  const NL = 10;
  let start = span.start;
  let end = span.end;
  // The line break after it, and one blank line after that.
  for (let breaks = 0; breaks < 2 && bytes[end] === NL; breaks++) end++;
  // At the end of the file there is nothing after it to keep apart from, so
  // the blank line before it goes instead.
  if (end >= bytes.length) {
    while (start > 0 && bytes[start - 1] === NL && bytes[start - 2] === NL) start--;
  }
  return { span: { start, end }, text: '' };
}

/**
 * Renames the figure whose `@import` line is at `span`.
 *
 * A new label is carried into every `@label` in the document that pointed at
 * the old one. A new path is written on every line that imports the same file
 * — a document may show one drawing twice. Throws a `FigureNameError` with the
 * reason when the names cannot be used.
 */
export function renameFigure(source: string, span: ByteSpan, names: FigureNames): Replacement | undefined {
  const document = parseDocument(source);
  const block = document.blocks.find(one =>
    one.kind === 'import' && one.span.start === span.start && one.span.end === span.end);
  if (!block || block.kind !== 'import') throw new FigureNameError('notFound');

  const replacements: Replacement[] = [];
  let line = sliceBytes(source, span.start, span.end);
  const oldLabel = block.label;

  if (names.label !== undefined && names.label !== (oldLabel ?? '')) {
    const label = names.label;
    if (label !== '') {
      if (!LABEL_PATTERN.test(label)) throw new FigureNameError('badLabel', { label });
      const prefix = labelPrefixFor(names.path ?? block.path);
      if (!label.startsWith(`${prefix}-`)) throw new FigureNameError('wrongPrefix', { label, prefix });
      const taken = document.blocks.some(one =>
        (one.kind === 'import' || one.kind === 'heading') && one !== block && one.label === label);
      if (taken) throw new FigureNameError('labelTaken', { label });
    }
    const references = oldLabel === undefined ? [] : document.blocks.flatMap(one =>
      (one.kind === 'prose' || one.kind === 'heading' ? one.references : [])
        .filter(reference => reference.document === undefined && reference.label === oldLabel));
    if (label === '' && references.length > 0) {
      throw new FigureNameError('labelInUse', { label: oldLabel!, count: references.length });
    }
    line = setImportLabel(line, label === '' ? undefined : label);
    for (const reference of references) {
      replacements.push({ span: reference.span, text: `@${label}` });
    }
  }

  if (names.caption !== undefined) {
    const caption = names.caption.replace(/"/g, '');
    // A caption that is already there is rewritten where it stands; only a new
    // one goes at the end, which is where `setImportAttribute` puts it.
    const written = /(\scaption\s*=\s*)("[^"]*"|\S+?)(?=[\s}])/.exec(line);
    if (written && caption !== '') {
      line = line.slice(0, written.index) + `${written[1]}"${caption}"`
        + line.slice(written.index + written[0].length);
    } else {
      line = setImportAttribute(line, 'caption', caption === '' ? undefined : caption);
    }
  }

  if (names.path !== undefined && names.path !== block.path) {
    if (names.path === '' || /["\s]/.test(names.path)) throw new FigureNameError('badPath', { path: names.path });
    line = setImportPath(line, names.path);
    for (const other of document.blocks) {
      if (other === block || other.kind !== 'import' || other.path !== block.path) continue;
      const text = sliceBytes(source, other.span.start, other.span.end);
      replacements.push({ span: other.span, text: setImportPath(text, names.path) });
    }
  }

  if (line !== sliceBytes(source, span.start, span.end)) replacements.push({ span, text: line });
  return merge(source, replacements);
}

/**
 * Every `@import` in a document that names `from` (a workspace path), pointed
 * at `to` instead. `documentPath` is where the document sits, which is what
 * the paths it writes are relative to.
 */
export function retargetImports(
  source: string, documentPath: string, from: string, to: string,
): Replacement[] {
  const replacements: Replacement[] = [];
  for (const block of parseDocument(source).blocks) {
    if (block.kind !== 'import' || joinPath(documentPath, block.path.replace(/^\.\//, '')) !== from) continue;
    const text = sliceBytes(source, block.span.start, block.span.end);
    replacements.push({ span: block.span, text: setImportPath(text, relativeTo(documentPath, to)) });
  }
  return replacements;
}

/** A workspace path, written the way a document at `documentPath` refers to it. */
export function relativeTo(documentPath: string, path: string): string {
  const from = documentPath.split('/').slice(0, -1);
  const to = path.split('/');
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same += 1;
  return [...Array.from({ length: from.length - same }, () => '..'), ...to.slice(same)].join('/');
}

/**
 * Several replacements as one: the smallest range that holds them all, and the
 * original text in it with each one applied. What lies between them is copied
 * as it was, so it does not show in the diff.
 */
export function merge(source: string, replacements: readonly Replacement[]): Replacement | undefined {
  if (replacements.length === 0) return undefined;
  const sorted = [...replacements].sort((a, b) => a.span.start - b.span.start);
  const start = sorted[0]!.span.start;
  const end = Math.max(...sorted.map(one => one.span.end));
  let text = '';
  let at = start;
  for (const one of sorted) {
    if (one.span.start < at) throw new Error('overlapping replacements');
    text += sliceBytes(source, at, one.span.start) + one.text;
    at = one.span.end;
  }
  text += sliceBytes(source, at, end);
  return { span: { start, end }, text };
}

export type FigureNameProblem =
  | 'notFound' | 'badLabel' | 'wrongPrefix' | 'labelTaken' | 'labelInUse' | 'badPath';

/** Why a figure could not be renamed, in the author's language through `describeError`. */
export class FigureNameError extends LocalizedError {
  constructor(
    readonly problem: FigureNameProblem,
    readonly detail: Readonly<Record<string, string | number>> = {},
  ) {
    super(md(`markdown.figure.${problem}`, detail));
    this.name = 'FigureNameError';
  }
}
