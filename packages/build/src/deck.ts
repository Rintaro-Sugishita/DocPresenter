// A document, as slides.
//
// The rule is in design/pptx-model.md and it is a rule about restraint: one
// slide holds one thing worth showing, and what makes this output worth having
// is that the drawing on it can be edited by the person who receives it. So a
// sheet becomes a slide, its first heading becomes the title, and its figure
// becomes native shapes. Prose that happens to sit beside the figure follows
// it; prose on its own becomes a slide of text.

import { parseDiagram, parseRuns, withParts, type Run } from '@docpresenter/diagram';
import {
  cellAt, describe, fencesOf, joinPath, parseTable, selectRows, sheetsOf, viewOf,
  type Block as DocBlock, type Cell, type DiffMarks, type DocumentFile,
  type MermaidView, type NumberedElement, type ResolvedDocument, type TableFile,
} from '@docpresenter/markdown';
import { drawingOf, type Block, type Deck, type Slide, type TableCell } from '@docpresenter/pptx';
import type { MermaidPicture } from './build.js';
import { asLf, type Workspace } from './workspace.js';
import { describeError } from '@docpresenter/base';
import { BUILD_MESSAGES } from './messages.js';

export interface DeckOptions {
  readonly workspace: Workspace;
  readonly document: DocumentFile;
  readonly resolved: ResolvedDocument;
  readonly title: string;
  readonly foot?: string;
  /** What changed since another version, when the build was told to compare. */
  readonly marks?: DiffMarks;
  /** Mermaid drawings as pictures, by source. A drawing not here is shown as code. */
  readonly pictures?: ReadonlyMap<string, MermaidPicture>;
}

export function deckOf(options: DeckOptions): Deck {
  const { document, resolved } = options;
  const byBlock = new Map<unknown, NumberedElement>(resolved.elements.map(e => [e.block, e]));
  const diagnostics: string[] = [];
  const slides: Slide[] = [];

  for (const sheet of sheetsOf(document, resolved)) {
    const heading = sheet.blocks.find(block => block.kind === 'heading');
    const blocks: Block[] = [];

    for (const block of sheet.blocks) {
      if (block === heading) continue;
      const made = blockOf(block, options, byBlock, diagnostics);
      if (Array.isArray(made)) blocks.push(...made);
      else if (made) blocks.push(made);
    }
    if (blocks.length === 0 && heading === undefined) continue;

    slides.push({
      title: heading?.kind === 'heading'
        ? titleOf(heading, byBlock) : undefined,
      blocks,
      ...(options.foot ? { foot: options.foot } : {}),
    });
  }

  return { title: options.title, slides, diagnostics };
}

function titleOf(heading: DocBlock, byBlock: ReadonlyMap<unknown, NumberedElement>): string {
  if (heading.kind !== 'heading') return '';
  const number = byBlock.get(heading)?.number;
  return number ? `${number} ${heading.text}` : heading.text;
}

function blockOf(
  block: DocBlock, options: DeckOptions,
  byBlock: ReadonlyMap<unknown, NumberedElement>, diagnostics: string[],
): Block | Block[] | undefined {
  if (block.kind === 'prose') return proseBlocks(block.text, options);
  if (block.kind !== 'import') return undefined;

  const source = asLf(options.workspace).read(block.path);
  const caption = captionOf(block, byBlock, options);
  const { locale } = options.resolved;
  const t = BUILD_MESSAGES.in(locale);

  if (/\.dgm$/i.test(block.path)) {
    if (source === undefined) {
      diagnostics.push(t('build.missing', { target: block.path }));
      return undefined;
    }
    try {
      const marks = options.marks?.diagrams.get(block.path)?.nodes;
      // Resolved first, so a part reaches PowerPoint as what it draws rather
      // than as a name PowerPoint has never heard of.
      const drawing = withParts(parseDiagram(source),
        used => asLf(options.workspace).read(joinPath(block.path, used)));
      return drawingOf(drawing, {
        diagnostics, locale, source: block.path, ...(marks ? { marks } : {}),
      });
    } catch (error) {
      diagnostics.push(t('build.unreadableFile', { path: block.path, message: describeError(error, locale) }));
      return undefined;
    }
  }
  if (/\.table$/i.test(block.path)) {
    if (source === undefined) {
      diagnostics.push(t('build.missing', { target: block.path }));
      return undefined;
    }
    try {
      const whole = parseTable(source);
      // A partial reference takes the rows it names, the same as it does in the
      // document; a slide showing the whole table would say something else.
      const rows = block.attributes.get('rows');
      const chosen = rows === undefined ? whole : selectRows(whole, rows);
      if (!chosen) {
        diagnostics.push(t('build.missingRange', { rows: rows ?? '' }));
        return undefined;
      }
      return tableOf(chosen);
    } catch (error) {
      diagnostics.push(t('build.unreadableFile', { path: block.path, message: describeError(error, locale) }));
      return undefined;
    }
  }
  if (/\.(png|jpe?g|gif)$/i.test(block.path)) {
    const data = options.workspace.dataUrl?.(block.path);
    if (data === undefined) {
      diagnostics.push(t('build.unreadableImage', { path: block.path }));
      return undefined;
    }
    // The slide sizes it; the proportions come from the file, which is not
    // read here, so a square is assumed and corrected by the writer's fit.
    return { kind: 'picture', data, width: 1600, height: 900 };
  }

  if (/\.(mmd|mermaid)$/i.test(block.path)) {
    if (source === undefined) {
      diagnostics.push(t('build.missing', { target: block.path }));
      return undefined;
    }
    return mermaidBlocks(source, viewOf(block.attributes.get('view')), options);
  }

  diagnostics.push(caption
    ? t('build.notSlideCaptioned', { path: block.path, caption })
    : t('build.notSlide', { path: block.path }));
  return undefined;
}

function captionOf(
  block: DocBlock, byBlock: ReadonlyMap<unknown, NumberedElement>, options: DeckOptions,
): string | undefined {
  const element = byBlock.get(block);
  return element ? describe(element, options.resolved.locale) : undefined;
}

/**
 * Prose, with its code blocks set as code and its Mermaid blocks shown the way
 * the author chose. A drawing goes on the slide as a picture: Mermaid has no
 * shapes PowerPoint could hand back, unlike a `.dgm`.
 */
function proseBlocks(text: string, options: DeckOptions): Block[] {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
  const blocks: Block[] = [];
  let paragraphs: (readonly Run[])[] = [];
  const flush = (): void => {
    if (paragraphs.length > 0) blocks.push({ kind: 'text', paragraphs });
    paragraphs = [];
  };
  const prose = (line: string): readonly Run[] => parseRuns(substitute(line, options.resolved));
  let at = 0;
  for (const fence of fencesOf(text)) {
    for (; at < fence.from; at++) paragraphs.push(prose(lines[at]!));
    if (fence.language === 'mermaid') {
      flush();
      blocks.push(...mermaidBlocks(fence.content, viewOf(fence.attributes.get('view')), options));
    } else {
      paragraphs.push(...codeLines(fence.content));
    }
    at = fence.to + 1;
  }
  for (; at < lines.length; at++) paragraphs.push(prose(lines[at]!));
  flush();
  return blocks;
}

/** Code, one paragraph per line, set in the code face and never parsed. */
function codeLines(content: string): (readonly Run[])[] {
  return content.replace(/\n$/, '').split('\n').map(line => [{
    text: line.replace(/\r$/, ''), bold: false, italic: false, code: true, colour: undefined,
  }]);
}

/**
 * A Mermaid block on a slide: the picture, its code, or both. A drawing that
 * could not be made is shown as its code — the build has already said why.
 */
function mermaidBlocks(source: string, view: MermaidView, options: DeckOptions): Block[] {
  const picture = view === 'code' ? undefined : options.pictures?.get(source);
  const blocks: Block[] = [];
  if (picture) {
    blocks.push({ kind: 'picture', data: picture.data, width: picture.width, height: picture.height });
  }
  if (view !== 'diagram' || !picture) blocks.push({ kind: 'text', paragraphs: codeLines(source) });
  return blocks;
}

/** `@fig-x` reads as its number on a slide, the same as it does in the document. */
function substitute(text: string, resolved: ResolvedDocument): string {
  return text.replace(/@(?:[A-Za-z0-9][\w.-]*:)?((?:fig|tbl|sec|req|des|tst)-[A-Za-z0-9_-]+)/g,
    (whole, label: string) => {
      const target = resolved.byLabel.get(label);
      return target && target.number !== undefined ? describe(target, resolved.locale) : whole;
    });
}

function tableOf(table: TableFile): Block {
  const columns = table.columns.map(() => 1);
  const header: TableCell[] = table.columns.map(column => ({
    runs: parseRuns(column.header) as Run[],
    rowSpan: 1, colSpan: 1, covered: 'none', align: 'center',
  }));

  const rows = table.rows.map((row, r) => ({
    header: false,
    cells: table.columns.map((column, c) => {
      const owner = cellAt(table, r, c);
      if (!owner) return empty();
      if (owner.row !== r) return covered('vertical');
      if (owner.column !== c) return covered('horizontal');
      return {
        runs: parseRuns(owner.text) as Run[],
        rowSpan: owner.rowspan, colSpan: owner.colspan, covered: 'none' as const,
        align: column.align === 'default' ? 'left' as const : column.align,
      };
    }),
  }));

  return { kind: 'table', columns, rows: [{ header: true, cells: header }, ...rows] };
}

function empty(): TableCell {
  return { runs: [], rowSpan: 1, colSpan: 1, covered: 'none' };
}

function covered(how: 'horizontal' | 'vertical'): TableCell {
  return { runs: [], rowSpan: 1, colSpan: 1, covered: how };
}

export type { Cell };
