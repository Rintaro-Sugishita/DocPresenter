// The HTML artifact: one file that opens anywhere.
//
// A design document is sent to people, and a page that needs a stylesheet
// beside it arrives broken as often as not. So the theme is inlined, the
// drawings are already SVG in the markup, and the images travel as data URLs.
// Nothing about the result depends on where it is put.

import {
  describe, headingsOf, isAddress, renderDocument,
  type DiffMarks, type DocumentFile,
  type ResolvedDocument, type ResourceLoader,
} from '@docpresenter/markdown';
import { asLf, type Workspace } from './workspace.js';
import { BUILD_MESSAGES } from './messages.js';

export interface PageOptions {
  readonly workspace: Workspace;
  readonly document: DocumentFile;
  readonly resolved: ResolvedDocument;
  /** The theme's CSS, already read. */
  readonly style: string;
  /** For the header: where this came from. */
  readonly root: string;
  /** The commit the build ran on, when the caller knows it. */
  readonly commit?: string;
  readonly builtAt?: string;
  /** What changed since another version. */
  readonly marks?: DiffMarks;
  /** Pictures from the web, already fetched, keyed by the address written. */
  readonly inlined?: ReadonlyMap<string, string>;
  /**
   * The script that draws Mermaid in the page. Written in only when the
   * document has a Mermaid block; without it such a block shows its source.
   */
  readonly mermaidScript?: string;
}

export function renderPage(options: PageOptions): string {
  const { document, resolved, style } = options;
  const workspace = asLf(options.workspace);
  const raw = document.frontmatter.raw;
  const title = text(raw['title']) ?? text(raw['document']) ?? options.root;

  const loader: ResourceLoader = {
    // Paths in a build are workspace-relative already: expansion rewrote every
    // one of them, so that a path written inside an included document still
    // points where its author meant.
    read: path => workspace.read(path),
    // Undefined when the output cannot carry it: the renderer then says so
    // rather than pointing the reader at something they may not reach.
    url: path => isAddress(path)
      ? options.inlined?.get(path)
      : workspace.dataUrl?.(path),
  };

  const body = renderDocument(document, resolved, {
    loader, ...(options.marks === undefined ? {} : { marks: options.marks }),
  });

  return [
    '<!doctype html>',
    `<html lang="${resolved.locale}"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escape(title)}</title>`,
    ...meta(options),
    `<style>${style}</style>`,
    '</head><body>',
    front(options),
    body,
    ...(options.mermaidScript !== undefined && hasMermaid(body)
      // Inline, like the theme: the page still opens with no network. The one
      // sequence that would end the element early is broken up.
      ? [`<script>${options.mermaidScript.replace(/<\/script/gi, '<\\/script')}</script>`]
      : []),
    '</body></html>',
  ].join('\n');
}

/** Whether a rendered page has a Mermaid block to draw. */
export function hasMermaid(body: string): boolean {
  return body.includes('class="dp-mermaid"');
}

/**
 * What the document says about itself, as metadata. A delivered PDF or page
 * has to be traceable to the commit it came from, and the frontmatter is where
 * the document number and version already live.
 */
function meta(options: PageOptions): string[] {
  const raw = options.document.frontmatter.raw;
  const entries: [string, string | undefined][] = [
    ['dp-document', text(raw['document'])],
    ['dp-version', text(raw['version'])],
    ['dp-status', text(raw['status'])],
    ['dp-source', options.root],
    ['dp-commit', options.commit],
    ['dp-built', options.builtAt],
  ];
  return entries
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([name, content]) => `<meta name="${name}" content="${escape(content)}">`);
}

/**
 * What the document says about itself, above its own first heading. Generated
 * rather than written, because every field is already in the frontmatter and a
 * second copy in the prose is a second copy to forget to update.
 *
 * The title is deliberately not repeated here: the document opens with its own
 * `# heading`, and printing the same words twice is how a generated cover
 * announces that it was generated.
 */
function cover(options: PageOptions): string {
  const raw = options.document.frontmatter.raw;
  const t = BUILD_MESSAGES.in(options.resolved.locale);
  const fields: [string, string | undefined][] = [
    [t('build.cover.document'), text(raw['document'])],
    [t('build.cover.version'), text(raw['version'])],
    [t('build.cover.status'), text(raw['status'])],
    [t('build.cover.author'), text(raw['author'])],
    [t('build.cover.updated'), text(raw['updated'])],
  ];
  const shown = fields.filter((f): f is [string, string] => f[1] !== undefined && f[1] !== '');
  if (shown.length === 0) return '';
  // The title is for paper. On screen the document's own first heading says it
  // a line below, and the theme shows this one only on a page of its own.
  const title = text(raw['title']);
  const number = text(raw['document']);
  return [
    '<header class="dp-cover">',
    ...(title === undefined ? [] : [
      '<div class="dp-cover-head">',
      ...(number === undefined ? [] : [`<p class="dp-cover-number">${escape(number)}</p>`]),
      `<p class="dp-cover-title">${escape(title)}</p>`,
      '</div>',
    ]),
    '<dl class="dp-cover-fields">',
    ...shown.map(([name, value]) =>
      `<dt>${escape(name)}</dt><dd>${escape(value)}</dd>`),
    '</dl>',
    '</header>',
  ].join('\n');
}

/**
 * The front matter: what the theme puts before the document itself.
 *
 * It is one element so that the page can break after it and the PDF can tell
 * which pages are front matter — those carry their own numbering, and the
 * body's "12 / 13" counts the body alone.
 */
function front(options: PageOptions): string {
  const parts = [cover(options), contents(options), figures(options)]
    .filter(part => part !== '');
  if (parts.length === 0) return '';
  return `<section class="dp-front">\n${parts.join('\n')}\n</section>`;
}

/** Sections deeper than this are not worth a line of their own. */
const CONTENTS_DEPTH = 3;
/**
 * Below this many entries a generated list is noise: a page of its own to say
 * what the next two pages hold. The author overrides the guess either way with
 * `contents:` or `figures:` in the frontmatter.
 */
const LIST_LEAST = 5;

/** Whether to build one of the generated lists: the author's word, or the count. */
function wanted(options: PageOptions, name: string, count: number): boolean {
  const asked = options.document.frontmatter.raw[name];
  if (asked === true) return count > 0;
  if (asked === false) return false;
  return count >= LIST_LEAST;
}

/**
 * The table of contents, from the headings rather than from the prose.
 *
 * A contents list written by hand goes stale the first time a section moves, so
 * this one is computed on every build — the same rule the numbering follows.
 * The page number is left empty here: on screen there are no pages, and on
 * paper it is filled in once the document has been laid out. The column it will
 * go in is reserved either way, so filling it in moves nothing.
 */
function contents(options: PageOptions): string {
  const headings = headingsOf(options.document, options.resolved)
    .filter(heading => heading.level >= 2 && heading.level <= CONTENTS_DEPTH && heading.id);
  if (!wanted(options, 'contents', headings.length)) return '';
  const title = escape(BUILD_MESSAGES.in(options.resolved.locale)('build.contents'));
  return [
    `<nav class="dp-index dp-index-contents" aria-label="${title}">`,
    `<h2 class="dp-index-title" id="dp-contents">${title}</h2>`,
    ...headings.map(heading => line({
      id: heading.id!, number: heading.number, text: heading.text, level: heading.level,
    })),
    '</nav>',
  ].join('\n');
}

/**
 * The figures and tables, from the numbering.
 *
 * A running number says what order a drawing comes in and nothing about where
 * it is; this list is what answers "where is 図 3". Figures come before tables
 * because each is numbered in its own series, and interleaving them in document
 * order would read as 図 1, 図 2, 表 1, 図 3.
 */
function figures(options: PageOptions): string {
  const listed = options.resolved.elements.filter(element =>
    (element.kind === 'figure' || element.kind === 'table')
    && element.number !== undefined && element.label !== undefined);
  if (!wanted(options, 'figures', listed.length)) return '';
  const order: readonly string[] = ['figure', 'table'];
  // A stable sort, so each series keeps the order it appears in the document.
  const sorted = [...listed].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const title = escape(BUILD_MESSAGES.in(options.resolved.locale)('build.figures'));
  return [
    `<nav class="dp-index dp-index-figures" aria-label="${title}">`,
    `<h2 class="dp-index-title" id="dp-figures">${title}</h2>`,
    ...sorted.map(element => line({
      id: element.label!,
      number: describe(element, options.resolved.locale),
      // A numbered figure with no caption is still worth a line: it says where
      // 図 3 is, which is the one thing a running number cannot.
      text: element.caption ?? '',
      level: 2,
    })),
    '</nav>',
  ].join('\n');
}

interface IndexLine {
  readonly id: string;
  readonly number: string | undefined;
  readonly text: string;
  /** Indents the line; the contents list uses the heading's own depth. */
  readonly level: number;
}

function line(entry: IndexLine): string {
  const number = entry.number ? `<span class="dp-index-number">${escape(entry.number)}</span>` : '';
  return `<a class="dp-index-line" data-level="${entry.level}" href="#${escape(entry.id)}">`
    + `${number}<span class="dp-index-text">${escape(entry.text)}</span>`
    + '<span class="dp-index-lead"></span>'
    + `<span class="dp-index-page" data-page-of="${escape(entry.id)}"></span></a>`;
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
