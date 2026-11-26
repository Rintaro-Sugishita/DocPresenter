// Variables: `{{FileName}}`, `{{Title}}`, `{{version}}` written in a document
// and shown as what they stand for.
//
// Doubled braces, because single ones are ordinary text in a design document —
// `{id}` in a URL, a set written `{a, b}` — and having to escape those would
// be the price of a feature most sentences never use. Code is shown as it was
// written: a `{{x}}` in a code block or a code span is the template the author
// is documenting, not one to be filled in.
//
// What a name stands for is worked out once per document: the file it is,
// today's date, and the front matter. A front matter value may itself name
// the file or the date (`title: "{{FileTitle}} 設計書"`); it may not name
// another front matter key, so there is no order to get wrong and no loop.
// A name nobody defined is left as written, so a typo shows on the page.

import type { DocumentFile, Frontmatter } from './model.js';

export interface VariableContext {
  /** The document's path, for `FileName`, `FileTitle` and `Folder`. */
  readonly path?: string;
  /** Today, for `Date`. The clock when not given. */
  readonly today?: Date;
}

const VARIABLE = /\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/gu;

/** The front matter keys a capitalised name also reaches, as the cover names them. */
const ALIASES: Readonly<Record<string, string>> = {
  Title: 'title', DocNumber: 'document', Document: 'document', Version: 'version',
  Author: 'author', Status: 'status', Updated: 'updated',
};

function isoDate(day: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The names that do not come from the front matter. */
function builtIns(context: VariableContext): Map<string, string> {
  const names = new Map<string, string>();
  const day = isoDate(context.today ?? new Date());
  names.set('Date', day);
  names.set('Today', day);
  if (context.path !== undefined) {
    const path = context.path.replace(/\\/g, '/');
    const name = path.slice(path.lastIndexOf('/') + 1);
    names.set('FileName', name);
    names.set('FileTitle', name.replace(/\.[^.]+$/, ''));
    names.set('Folder', path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  }
  return names;
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return isoDate(value);
  return undefined;
}

/** What every name stands for in one document. */
export function documentVariables(
  frontmatter: Frontmatter | Readonly<Record<string, unknown>>, context: VariableContext = {},
): Map<string, string> {
  const raw = ('raw' in frontmatter && typeof frontmatter.raw === 'object'
    ? frontmatter.raw : frontmatter) as Readonly<Record<string, unknown>>;
  const fixed = builtIns(context);
  const names = new Map(fixed);
  for (const [key, value] of Object.entries(raw)) {
    const text = scalar(value);
    if (text !== undefined) names.set(key, replaceNames(text, fixed));
  }
  for (const [alias, key] of Object.entries(ALIASES)) {
    const value = names.get(key);
    if (value !== undefined && !names.has(alias)) names.set(alias, value);
  }
  return names;
}

function replaceNames(text: string, names: ReadonlyMap<string, string>): string {
  if (!text.includes('{{')) return text;
  VARIABLE.lastIndex = 0;
  return text.replace(VARIABLE, (whole, name: string) => names.get(name) ?? whole);
}

/** Where the code of a piece of Markdown is, by character: fenced blocks and code spans. */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let at = 0;
  let open: { fence: string; from: number } | undefined;
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
    if (open === undefined && marker) open = { fence: marker[1]!, from: at };
    else if (open !== undefined && marker && marker[1]![0] === open.fence[0]
      && marker[1]!.length >= open.fence.length && marker[2]!.trim() === '') {
      ranges.push([open.from, at + line.length]);
      open = undefined;
    }
    at += line.length + 1;
  }
  if (open !== undefined) ranges.push([open.from, text.length]);
  // Code spans: a run of backticks up to the next run of the same length.
  const span = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  for (let match = span.exec(text); match; match = span.exec(text)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/**
 * The text with every name it uses replaced by what it stands for. Code is
 * left as written, and so is a name that stands for nothing.
 */
export function expandVariables(text: string, names: ReadonlyMap<string, string>): string {
  if (!text.includes('{{')) return text;
  const code = codeRanges(text);
  VARIABLE.lastIndex = 0;
  return text.replace(VARIABLE, (whole, name: string, index: number) => {
    if (code.some(([from, to]) => index >= from && index < to)) return whole;
    return names.get(name) ?? whole;
  });
}

/**
 * The document with its front matter's values filled in, for what reads them
 * directly: the cover, the running foot, the file name of a PDF. The body is
 * filled in as it is drawn, where code can still be told from prose.
 */
export function withVariables(document: DocumentFile, context: VariableContext = {}): DocumentFile {
  const fixed = builtIns(context);
  let changed = false;
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document.frontmatter.raw)) {
    if (typeof value === 'string' && value.includes('{{')) {
      raw[key] = replaceNames(value, fixed);
      changed = true;
    } else {
      raw[key] = value;
    }
  }
  return changed ? { ...document, frontmatter: { ...document.frontmatter, raw } } : document;
}
