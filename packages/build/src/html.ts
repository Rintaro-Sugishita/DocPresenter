// The HTML artifact: one file that opens anywhere.
//
// A design document is sent to people, and a page that needs a stylesheet
// beside it arrives broken as often as not. So the theme is inlined, the
// drawings are already SVG in the markup, and the images travel as data URLs.
// Nothing about the result depends on where it is put.

import {
  describe, headingsOf, isAddress, renderDocument, paperOf, paperStyle,
  type DiffMarks, type DocumentFile,
  type ResolvedDocument, type ResourceLoader, hasMath, KATEX_STYLE, MATH_RULES,
} from '@docpresenter/markdown';
import { parse as parseYaml } from 'yaml';
import { asLf, type Workspace } from './workspace.js';
import { BUILD_MESSAGES } from './messages.js';

/** Rules every page has under its theme, at no specificity so any theme rule wins. */
export const BASE_PAGE_STYLE = [
  ':where(.dp-caption) { text-align: center; }',
  ':where(.dp-figure[data-align="left"] > .dp-caption) { text-align: left; }',
  ':where(.dp-figure[data-align="right"] > .dp-caption) { text-align: right; }',
  // The title page: what comes before the first `##`, centred, on a page of
  // its own when printed — the document's own words, however the author set them.
  ':where(.dp-title-page) { text-align: center; }',
  ':where(.dp-title-page) > :where(h1) { margin-bottom: 0.6em; }',
  ':where(.dp-paged .dp-title-page) { margin-top: 55mm; margin-bottom: 20mm; }',
  ':where(.dp-title-page table) { margin-left: auto; margin-right: auto; }',
].join('\n');

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
  const paper = paperOf(raw);

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

  const rendered = renderDocument(document, resolved, {
    loader, path: options.root, ...(options.marks === undefined ? {} : { marks: options.marks }),
  });
  // What comes before the first `##` is the title page; the body starts there.
  const titled = titlePage(rendered);
  const body = titled?.body ?? rendered;

  return [
    '<!doctype html>',
    `<html lang="${resolved.locale}"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escape(title)}</title>`,
    ...meta(options),
    // What the page is before any theme speaks: a caption is centred on the
    // page. A theme copied into a workspace before this was decided still says
    // nothing about it, and a theme that does say is not overruled.
    `<style>${BASE_PAGE_STYLE}</style>`,
    `<style>${style}</style>`,
    // KaTeX's stylesheet, fonts inside, only for a page that has a formula.
    ...(hasMath(body) ? [`<style>${KATEX_STYLE}
${MATH_RULES}</style>`] : []),
    // The paper the document names, over the theme's: the PDF is cut to it.
    ...(paper === undefined ? [] : [`<style>:root { ${paperStyle(paper)} }</style>`]),
    '</head><body>',
    front(options, titled?.title),
    body,
    // The same script lays formulas down as pictures for the PDF.
    ...(options.mermaidScript !== undefined && (hasMermaid(body) || hasMath(body))
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
function cover(options: PageOptions, page?: string): string {
  const raw = options.document.frontmatter.raw;
  const t = BUILD_MESSAGES.in(options.resolved.locale);
  const labels: Readonly<Record<string, string>> = {
    document: t('build.cover.document'), version: t('build.cover.version'), status: t('build.cover.status'),
    author: t('build.cover.author'), updated: t('build.cover.updated'),
  };
  // Which front matter keys the cover lists, in what order and under what
  // name: the repository's settings say, for every document in it.
  const fields: [string, string | undefined][] = coverFields(options.workspace)
    .map(({ key, label }) => [label ?? labels[key] ?? key, text(raw[key])]);
  const shown = fields.filter((f): f is [string, string] => f[1] !== undefined && f[1] !== '');
  // A title page written in the document: its words, then the fields under them.
  if (page !== undefined) {
    return [
      '<header class="dp-cover dp-cover-page">',
      `<div class="dp-title-page">\n${page.trim()}\n</div>`,
      ...(shown.length === 0 ? [] : [
        '<dl class="dp-cover-fields">',
        ...shown.map(([name, value]) => `<dt>${escape(name)}</dt><dd>${escape(value)}</dd>`),
        '</dl>',
      ]),
      '</header>',
    ].join('\n');
  }
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
function front(options: PageOptions, title?: string): string {
  const parts = [cover(options, title), contents(options), figures(options)]
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

/**
 * The title page a document writes for itself: everything on its first sheet
 * before the first `##`, when the sheet opens with a `#` heading — and the
 * rendered body without it. A first sheet that is nothing but the title page
 * leaves no empty sheet behind it, which would print as a blank page.
 */
export function titlePage(body: string): { title: string; body: string } | undefined {
  const open = /<section class="dp-sheet"[^>]*>\n?/.exec(body);
  if (!open) return undefined;
  const start = open.index + open[0].length;
  const end = body.indexOf('</section>', start);
  if (end < 0) return undefined;
  const sheet = body.slice(start, end);
  if (!/^\s*<h1[\s>]/.test(sheet)) return undefined;
  const at = sheet.search(/<h2[\s>]/);
  const title = at < 0 ? sheet : sheet.slice(0, at);
  const rest = at < 0 ? '' : sheet.slice(at);
  const after = body.slice(end + '</section>'.length).replace(/^\n/, '');
  return {
    title,
    body: rest.trim() === '' ? body.slice(0, open.index) + after : body.slice(0, start) + rest + body.slice(end),
  };
}

/** Where a repository keeps its settings for every document in it. */
export const SETTINGS_PATH = '.docpresenter/settings.yml';

/** A front matter key the cover lists, and the name it is listed under (the shipped one when none). */
export interface CoverField {
  readonly key: string;
  readonly label?: string;
}

/** What the cover lists when the repository says nothing. */
const COVER_FIELDS: readonly CoverField[] = ['document', 'version', 'status', 'author', 'updated'].map(key => ({ key }));

/**
 * The cover's fields, from the repository's settings:
 *
 *   cover:
 *     fields: [document, version, author, { reviewer: 承認 }]
 *
 * An empty list shows none. A settings file that cannot be read is passed
 * over, and the shipped list is used.
 */
export function coverFields(workspace: Workspace): readonly CoverField[] {
  const text = workspace.read(SETTINGS_PATH);
  if (text === undefined) return COVER_FIELDS;
  let settings: unknown;
  try { settings = parseYaml(text); } catch { return COVER_FIELDS; }
  const cover = (settings as { cover?: { fields?: unknown } } | null)?.cover;
  const listed = cover?.fields;
  if (!Array.isArray(listed)) return COVER_FIELDS;
  const out: CoverField[] = [];
  for (const one of listed) {
    if (typeof one === 'string' && one.trim() !== '') out.push({ key: one.trim() });
    else if (one && typeof one === 'object') {
      for (const [key, label] of Object.entries(one as Record<string, unknown>)) {
        out.push(label === null || label === undefined ? { key } : { key, label: String(label) });
      }
    }
  }
  return out;
}
