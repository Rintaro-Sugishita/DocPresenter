// A document, as slides.
//
// The rule is in design/pptx-model.md and it is a rule about restraint: one
// slide holds one thing worth showing, and what makes this output worth having
// is that the drawing on it can be edited by the person who receives it. So a
// sheet becomes a slide, its first heading becomes the title, and its figure
// becomes native shapes. Prose that happens to sit beside the figure follows
// it; prose on its own becomes a slide of text.

import { parseDiagram, parseRuns, type Run } from '@docpresenter/diagram';
import {
  cellAt, describe, parseTable, selectRows, sheetsOf,
  type Block as DocBlock, type Cell, type DocumentFile, type NumberedElement,
  type ResolvedDocument, type TableFile,
} from '@docpresenter/markdown';
import { drawingOf, type Block, type Deck, type Slide, type TableCell } from '@docpresenter/pptx';
import type { Workspace } from './workspace.js';

export interface DeckOptions {
  readonly workspace: Workspace;
  readonly document: DocumentFile;
  readonly resolved: ResolvedDocument;
  readonly title: string;
  readonly foot?: string;
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
      if (made) blocks.push(made);
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
): Block | undefined {
  if (block.kind === 'prose') {
    return {
      kind: 'text',
      paragraphs: block.text.split('\n').map(line => parseRuns(substitute(line, options.resolved))),
    };
  }
  if (block.kind !== 'import') return undefined;

  const source = options.workspace.read(block.path);
  const caption = captionOf(block, byBlock);

  if (/\.dgm$/i.test(block.path)) {
    if (source === undefined) {
      diagnostics.push(`参照先が見つからない: ${block.path}`);
      return undefined;
    }
    try {
      return drawingOf(parseDiagram(source), { diagnostics, source: block.path });
    } catch (error) {
      diagnostics.push(`${block.path} を読めない: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  if (/\.table$/i.test(block.path)) {
    if (source === undefined) {
      diagnostics.push(`参照先が見つからない: ${block.path}`);
      return undefined;
    }
    try {
      const whole = parseTable(source);
      // A partial reference takes the rows it names, the same as it does in the
      // document; a slide showing the whole table would say something else.
      const rows = block.attributes.get('rows');
      const chosen = rows === undefined ? whole : selectRows(whole, rows);
      if (!chosen) {
        diagnostics.push(`名前付き範囲が見つからない: ${rows ?? ''}`);
        return undefined;
      }
      return tableOf(chosen);
    } catch (error) {
      diagnostics.push(`${block.path} を読めない: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  if (/\.(png|jpe?g|gif)$/i.test(block.path)) {
    const data = options.workspace.dataUrl?.(block.path);
    if (data === undefined) {
      diagnostics.push(`画像を読めない: ${block.path}`);
      return undefined;
    }
    // The slide sizes it; the proportions come from the file, which is not
    // read here, so a square is assumed and corrected by the writer's fit.
    return { kind: 'picture', data, width: 1600, height: 900 };
  }

  diagnostics.push(`スライドにできない参照: ${block.path}${caption ? `（${caption}）` : ''}`);
  return undefined;
}

function captionOf(
  block: DocBlock, byBlock: ReadonlyMap<unknown, NumberedElement>,
): string | undefined {
  const element = byBlock.get(block);
  return element ? describe(element) : undefined;
}

/** `@fig-x` reads as its number on a slide, the same as it does in the document. */
function substitute(text: string, resolved: ResolvedDocument): string {
  return text.replace(/@(?:[A-Za-z0-9][\w.-]*:)?((?:fig|tbl|sec|req|des|tst)-[A-Za-z0-9_-]+)/g,
    (whole, label: string) => {
      const target = resolved.byLabel.get(label);
      return target && target.number !== undefined ? describe(target) : whole;
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
