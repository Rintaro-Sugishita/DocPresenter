// Renders a document to HTML. Every element carries the byte range it came
// from, so the DOM is itself the source map a review comment anchors through.

import { byteLength, type ByteSpan } from '@docpresenter/base';
import { parseDiagram, renderDiagram, renderOverlay } from '@docpresenter/diagram';
import { describe } from '../numbering/resolve.js';
import { parseTable } from '../table/parse.js';
import { sheetsOf } from '../document/sheets.js';
import type { Block, DocumentFile, Import } from '../document/model.js';
import type { NumberedElement, ResolvedDocument } from '../numbering/model.js';
import { markdown } from './markdown.js';
import { joinPath } from './path.js';
import { legend, markClass, markOf, type DiffMarks } from './diff.js';
import { escapeAttr, escapeHtml, renderTable, selectRows } from './table.js';

/** Reading referenced files is injected so this package stays platform-neutral. */
export interface ResourceLoader {
  /** Reads a path written in a document, relative to that document. */
  read(path: string): string | undefined;
  /**
   * The address the output should point at for a binary such as an image, or
   * for an `http(s)` address written in the document.
   *
   * A referenced file resolves relative to the document, but the rendered page
   * lives wherever the caller puts it, so only the caller knows the answer.
   * **Undefined means the output cannot carry it** — a build that must deliver
   * one self-contained file answers undefined for a picture it could not
   * inline, and the figure says so rather than pointing at something the
   * reader may not be able to reach.
   */
  url?(path: string): string | undefined;
}

export interface RenderOptions {
  readonly loader: ResourceLoader;
  /** What changed since another version, when the build was told to compare. */
  readonly marks?: DiffMarks;
}

export function renderDocument(
  document: DocumentFile, resolved: ResolvedDocument, options: RenderOptions,
): string {
  const elementByBlock = new Map<unknown, NumberedElement>(
    resolved.elements.map(e => [e.block, e]),
  );
  // The document is emitted sheet by sheet: `---` is a boundary between
  // sections, not an element inside one, so the page breaks where the author
  // saw it break while writing.
  const sheets = sheetsOf(document, resolved).map(sheet => {
    const blocks = sheet.blocks
      .map(block => renderBlock(block, elementByBlock, resolved, options))
      .join('\n');
    return `<section class="dp-sheet" data-sheet="${sheet.index}"`
      + ` data-title="${escapeAttr(sheet.title)}"`
      + ` data-span="${sheet.span.start},${sheet.span.end}">\n${blocks}\n</section>`;
  }).join('\n');
  // The legend belongs to the build, not to the document: it explains marks the
  // author never wrote and cannot remove.
  return options.marks ? `${sheets}\n${legend(options.marks)}` : sheets;
}

function renderBlock(
  block: Block,
  elementByBlock: ReadonlyMap<unknown, NumberedElement>,
  resolved: ResolvedDocument,
  options: RenderOptions,
): string {
  const span = spanAttr(block);
  switch (block.kind) {
    case 'heading': {
      const number = elementByBlock.get(block)?.number;
      const label = block.label ? ` id="${escapeAttr(block.label)}"` : '';
      const prefix = number ? `<span class="dp-number">${number}</span> ` : '';
      const changed = markClass(markOf(options.marks, block.doc, block.span));
      const marked = changed ? ` class="${changed.trim()}"` : '';
      return `<h${block.level}${label}${marked}${span}>`
        + `${prefix}${inline(block.text, block.span.start, resolved)}</h${block.level}>`;
    }
    case 'prose':
      return `<div class="dp-prose${markClass(markOf(options.marks, block.doc, block.span))}"${span}>`
        + `${markdown.render(substitute(block.text, block.span.start, resolved))}</div>`;
    case 'import':
      return renderImport(block, elementByBlock.get(block), options);
    case 'separator':
      // Sheets are built from the separators, so one never reaches here.
      return '';
  }
}

function renderImport(
  block: Import, element: NumberedElement | undefined, options: RenderOptions,
): string {
  const { path, label, attributes } = block;
  const id = label ? ` id="${escapeAttr(label)}"` : '';
  // An address is not a file. Nothing is read for it and nothing is written to
  // the workspace; what the output carries is decided by whoever answers
  // `loader.url`, which is where a build inlines it.
  const body = isAddress(path) || PICTURE.test(path)
    ? picture(path, attributes, options)
    : fromFile(path, attributes, options);

  const caption = element && element.number !== undefined
    ? `<figcaption class="dp-caption">`
      + `<span class="dp-number">${captionPrefix(element)}</span>`
      + (element.caption ? ` ${escapeHtml(element.caption)}` : '')
      + `</figcaption>`
    : '';

  // `{page="landscape"}` travels to the output as an attribute: the PDF turns
  // that page over, and the screen ignores it.
  const paper = attributes.get('page');
  const page = paper === undefined ? '' : ` data-page="${escapeAttr(paper)}"`;
  // Where the figure sits is the author's instruction, not the theme's taste,
  // so it travels with the document; how that instruction looks is the theme's.
  const placed = attributes.get('align');
  const align = placed === undefined ? '' : ` data-align="${escapeAttr(placed)}"`;
  return `<figure class="dp-figure${markClass(markOf(options.marks, block.doc, block.span))}"`
    + ` data-kind="${element?.kind ?? 'other'}"`
    + ` data-path="${escapeAttr(path)}"${page}${align}${id}${spanAttr(block)}>`
    + `\n<div class="dp-figure-body"${sized(attributes)}>${body}</div>\n${caption}\n</figure>`;
}

/** An `http(s)` address, as opposed to a path in the workspace. */
export function isAddress(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

function fromFile(
  path: string, attributes: ReadonlyMap<string, string>, options: RenderOptions,
): string {
  const source = options.loader.read(path);
  return source === undefined
    ? `<p class="dp-missing">参照先が見つからない: ${escapeHtml(path)}</p>`
    : renderResource(path, source, attributes, options);
}

export const PICTURE = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

/**
 * A picture, whether it is a file in the workspace or an address on the web.
 *
 * Neither is read as text — a picture has no source to show — so both go
 * through `url`, and both say so when the answer is that the output cannot
 * carry it.
 */
function picture(
  path: string, attributes: ReadonlyMap<string, string>, options: RenderOptions,
): string {
  const src = options.loader.url?.(path);
  if (src === undefined) {
    return isAddress(path)
      ? `<p class="dp-missing">取り込めなかった画像がある: ${escapeHtml(path)}</p>`
      : `<p class="dp-missing">参照先が見つからない: ${escapeHtml(path)}</p>`;
  }
  return image(src, attributes);
}

function image(src: string, attributes: ReadonlyMap<string, string>): string {
  const alt = attributes.get('alt') ?? '';
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">`;
}

/**
 * How wide the author wants it, as a style on the figure's body.
 *
 * This is one of the few places a length reaches the output: the theme decides
 * how a figure looks, but not how big this particular drawing should be, which
 * only the person who put it there knows. A percentage is of the text column,
 * so it survives a change of paper or margins; a length is taken as written.
 */
function sized(attributes: ReadonlyMap<string, string>): string {
  const width = attributes.get('width');
  if (width === undefined || !/^[\d.]+(%|px|pt|mm|cm|em|rem|in)$/.test(width.trim())) return '';
  return ` style="width: ${escapeAttr(width.trim())}"`;
}

function captionPrefix(element: NumberedElement): string {
  return describe(element);
}

function renderResource(
  path: string, source: string, attributes: ReadonlyMap<string, string>, options: RenderOptions,
): string {
  const url = (target: string): string => options.loader.url?.(target) ?? target;
  try {
    return renderKnown(path, source, attributes, url, options);
  } catch (error) {
    // A referenced file can now be edited in place, so a half-written one has
    // to be shown as what it is rather than taking the whole page down.
    const message = error instanceof Error ? error.message : String(error);
    return `<p class="dp-broken">${escapeHtml(path)} を読めない: ${escapeHtml(message)}</p>`
      + `<pre class="dp-unrendered">${escapeHtml(source.trim())}</pre>`;
  }
}

function renderKnown(
  path: string, source: string, attributes: ReadonlyMap<string, string>,
  url: (target: string) => string, options: RenderOptions,
): string {
  if (path.toLowerCase().endsWith('.table')) {
    const table = parseTable(source);
    const marks = options.marks?.tables.get(path);
    const rows = attributes.get('rows');
    if (rows === undefined) return renderTable(table, marks);
    const selected = selectRows(table, rows);
    if (!selected) {
      return `<p class="dp-missing">名前付き範囲が見つからない: ${escapeHtml(rows)}</p>`;
    }
    return renderTable(selected, marks);
  }
  if (path.toLowerCase().endsWith('.dgm')) {
    const diagram = parseDiagram(source);
    const marks = options.marks?.diagrams.get(path);
    if (diagram.mode !== 'overlay') return renderDiagram(diagram, url, marks);
    // The image is written relative to the diagram, not to the document.
    const image = diagram.image === undefined ? undefined : url(joinPath(path, diagram.image));
    return renderOverlay(diagram, image);
  }

  // Diagrams and delegated formats are not rendered yet; the source is shown so
  // nothing is silently dropped.
  return `<pre class="dp-unrendered" data-path="${escapeAttr(path)}">${escapeHtml(source.trim())}</pre>`;
}

const REFERENCE = /@(?:([A-Za-z0-9][\w.-]*):)?((?:fig|tbl|sec|req|des|tst)-[A-Za-z0-9_-]+)/g;

/**
 * Replaces `@label` with the text it resolves to. The byte range of the
 * reference itself is carried through, so a comment on the rendered text maps
 * back to the `@label` in the source rather than to the substituted number.
 */
function substitute(text: string, baseOffset: number, resolved: ResolvedDocument): string {
  REFERENCE.lastIndex = 0;
  return text.replace(REFERENCE, (whole, _document: string | undefined, label: string, index: number) => {
    const target = resolved.byLabel.get(label);
    if (!target || target.number === undefined) return whole;
    const start = baseOffset + byteLength(text.slice(0, index));
    const end = start + byteLength(whole);
    return `<a class="dp-ref" href="#${escapeAttr(label)}" data-ref="${escapeAttr(label)}"`
      + ` data-span="${start},${end}">${escapeHtml(describe(target))}</a>`;
  });
}

function inline(text: string, baseOffset: number, resolved: ResolvedDocument): string {
  return markdown.renderInline(substitute(text, baseOffset, resolved));
}

/**
 * The source map, as an attribute. A block pulled in from another file also
 * says which file, because a byte range on its own would be read as a range of
 * the document being rendered.
 */
function spanAttr(block: { readonly span: ByteSpan; readonly doc?: string }): string {
  const doc = block.doc === undefined ? '' : ` data-doc="${escapeAttr(block.doc)}"`;
  return ` data-span="${block.span.start},${block.span.end}"${doc}`;
}
