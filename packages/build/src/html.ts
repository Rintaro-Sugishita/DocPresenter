// The HTML artifact: one file that opens anywhere.
//
// A design document is sent to people, and a page that needs a stylesheet
// beside it arrives broken as often as not. So the theme is inlined, the
// drawings are already SVG in the markup, and the images travel as data URLs.
// Nothing about the result depends on where it is put.

import {
  headingsOf, renderDocument,
  type DiffMarks, type DocumentFile, type SectionHeading,
  type ResolvedDocument, type ResourceLoader,
} from '@docpresenter/markdown';
import type { Workspace } from './workspace.js';

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
}

export function renderPage(options: PageOptions): string {
  const { workspace, document, resolved, style } = options;
  const raw = document.frontmatter.raw;
  const title = text(raw['title']) ?? text(raw['document']) ?? options.root;

  const loader: ResourceLoader = {
    // Paths in a build are workspace-relative already: expansion rewrote every
    // one of them, so that a path written inside an included document still
    // points where its author meant.
    read: path => workspace.read(path),
    url: path => workspace.dataUrl?.(path) ?? path,
  };

  const body = renderDocument(document, resolved, {
    loader, ...(options.marks === undefined ? {} : { marks: options.marks }),
  });

  return [
    '<!doctype html>',
    `<html lang="ja"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escape(title)}</title>`,
    ...meta(options),
    `<style>${style}</style>`,
    '</head><body>',
    front(options),
    body,
    '</body></html>',
  ].join('\n');
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
  const fields: [string, string | undefined][] = [
    ['文書番号', text(raw['document'])],
    ['版', text(raw['version'])],
    ['状態', text(raw['status'])],
    ['作成', text(raw['author'])],
    ['更新', text(raw['updated'])],
  ];
  const shown = fields.filter((f): f is [string, string] => f[1] !== undefined && f[1] !== '');
  if (shown.length === 0) return '';
  return [
    '<header class="dp-cover">',
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
  const parts = [cover(options), contents(options)].filter(part => part !== '');
  if (parts.length === 0) return '';
  return `<section class="dp-front">\n${parts.join('\n')}\n</section>`;
}

/** Sections deeper than this are not worth a line of their own. */
const CONTENTS_DEPTH = 3;
/**
 * Below this many entries a contents list is noise: a page of its own to say
 * what the next two pages hold. The author overrides the guess either way with
 * `contents: true` or `contents: false` in the frontmatter.
 */
const CONTENTS_LEAST = 5;

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
  const asked = options.document.frontmatter.raw['contents'];
  if (asked === false || (asked !== true && headings.length < CONTENTS_LEAST)) return '';
  if (headings.length === 0) return '';
  return [
    '<nav class="dp-toc" aria-label="目次">',
    '<h2 class="dp-toc-title" id="dp-contents">目次</h2>',
    ...headings.map(line),
    '</nav>',
  ].join('\n');
}

function line(heading: SectionHeading): string {
  const number = heading.number ? `<span class="dp-toc-number">${escape(heading.number)}</span>` : '';
  return `<a class="dp-toc-line" data-level="${heading.level}" href="#${escape(heading.id!)}">`
    + `${number}<span class="dp-toc-text">${escape(heading.text)}</span>`
    + '<span class="dp-toc-lead"></span>'
    + `<span class="dp-toc-page" data-page-of="${escape(heading.id!)}"></span></a>`;
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
