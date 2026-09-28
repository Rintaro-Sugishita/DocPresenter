// Renders a document to HTML. Every element carries the byte range it came
// from, so the DOM is itself the source map a review comment anchors through.

import {
  byteLength, describe, parseDiagram, parseTable, sheetsOf,
  type Block, type ByteSpan, type DocumentFile, type NumberedElement, type ResolvedDocument,
} from '@docpresenter/core';
import { renderDiagram } from '../svg/render.js';
import { renderOverlay } from './overlay.js';
import { markdown } from './markdown.js';
import { joinPath } from './path.js';
import { escapeAttr, escapeHtml, renderTable, selectRows } from './table.js';

/** Reading referenced files is injected so this package stays platform-neutral. */
export interface ResourceLoader {
  /** Reads a path written in a document, relative to that document. */
  read(path: string): string | undefined;
  /**
   * The address the output should point at for a binary such as an image.
   * A referenced file resolves relative to the document, but the rendered page
   * lives wherever the caller puts it, so only the caller knows the answer.
   */
  url?(path: string): string;
}

export interface RenderOptions {
  readonly loader: ResourceLoader;
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
  return sheetsOf(document, resolved).map(sheet => {
    const blocks = sheet.blocks
      .map(block => renderBlock(block, elementByBlock, resolved, options))
      .join('\n');
    return `<section class="dp-sheet" data-sheet="${sheet.index}"`
      + ` data-title="${escapeAttr(sheet.title)}"`
      + ` data-span="${sheet.span.start},${sheet.span.end}">\n${blocks}\n</section>`;
  }).join('\n');
}

function renderBlock(
  block: Block,
  elementByBlock: ReadonlyMap<unknown, NumberedElement>,
  resolved: ResolvedDocument,
  options: RenderOptions,
): string {
  const span = spanAttr(block.span);
  switch (block.kind) {
    case 'heading': {
      const number = elementByBlock.get(block)?.number;
      const label = block.label ? ` id="${escapeAttr(block.label)}"` : '';
      const prefix = number ? `<span class="dp-number">${number}</span> ` : '';
      return `<h${block.level}${label}${span}>`
        + `${prefix}${inline(block.text, block.span.start, resolved)}</h${block.level}>`;
    }
    case 'prose':
      return `<div class="dp-prose"${span}>`
        + `${markdown.render(substitute(block.text, block.span.start, resolved))}</div>`;
    case 'import':
      return renderImport(
        block.path, block.label, elementByBlock.get(block), block.span, block.attributes, options,
      );
    case 'separator':
      // Sheets are built from the separators, so one never reaches here.
      return '';
  }
}

function renderImport(
  path: string, label: string | undefined, element: NumberedElement | undefined,
  span: ByteSpan, attributes: ReadonlyMap<string, string>, options: RenderOptions,
): string {
  const source = options.loader.read(path);
  const id = label ? ` id="${escapeAttr(label)}"` : '';
  const body = source === undefined
    ? `<p class="dp-missing">参照先が見つからない: ${escapeHtml(path)}</p>`
    : renderResource(path, source, attributes, options);

  const caption = element && element.number !== undefined
    ? `<figcaption class="dp-caption">`
      + `<span class="dp-number">${captionPrefix(element)}</span>`
      + (element.caption ? ` ${escapeHtml(element.caption)}` : '')
      + `</figcaption>`
    : '';

  return `<figure class="dp-figure" data-kind="${element?.kind ?? 'other'}"`
    + ` data-path="${escapeAttr(path)}"${id}${spanAttr(span)}>`
    + `\n<div class="dp-figure-body">${body}</div>\n${caption}\n</figure>`;
}

function captionPrefix(element: NumberedElement): string {
  return describe(element);
}

function renderResource(
  path: string, source: string, attributes: ReadonlyMap<string, string>, options: RenderOptions,
): string {
  const url = (target: string): string => options.loader.url?.(target) ?? target;
  try {
    return renderKnown(path, source, attributes, url);
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
  url: (target: string) => string,
): string {
  if (path.toLowerCase().endsWith('.table')) {
    const table = parseTable(source);
    const rows = attributes.get('rows');
    if (rows === undefined) return renderTable(table);
    const selected = selectRows(table, rows);
    if (!selected) {
      return `<p class="dp-missing">名前付き範囲が見つからない: ${escapeHtml(rows)}</p>`;
    }
    return renderTable(selected);
  }
  if (path.toLowerCase().endsWith('.dgm')) {
    const diagram = parseDiagram(source);
    if (diagram.mode !== 'overlay') return renderDiagram(diagram, url);
    // The image is written relative to the diagram, not to the document.
    const image = diagram.image === undefined ? undefined : url(joinPath(path, diagram.image));
    return renderOverlay(diagram, image);
  }
  if (/\.(png|jpe?g|gif|svg)$/i.test(path)) {
    return `<img src="${escapeAttr(url(path))}" alt="">`;
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

function spanAttr(span: ByteSpan): string {
  return ` data-span="${span.start},${span.end}"`;
}
