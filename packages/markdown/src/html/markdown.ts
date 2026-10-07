// The one inline Markdown implementation.
//
// Prose and table cells used to have their own: prose went through
// markdown-it, and a cell went through a short chain of regular expressions.
// They agreed on the simple cases and parted company on the rest — a coloured
// run inside another one parsed in the prose and came out as its own notation
// in a cell. Two implementations of the same notation will always drift; there
// is one now, and a cell is simply the inline half of it.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { MARKDOWN_MESSAGES } from '../messages.js';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdownLanguage from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { bracketedSpan } from './span.js';
import { escapeAttr, escapeHtml } from '@docpresenter/base';

// The languages a design document is written about. Each is a few kilobytes,
// and the page carries them all, so the list is the ones that turn up in
// specifications rather than everything highlight.js knows.
for (const [name, language] of Object.entries({
  bash, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown: markdownLanguage, plaintext, powershell, python, shell, sql, typescript, xml, yaml,
})) hljs.registerLanguage(name, language);

/**
 * A code block, coloured. The colours are class names, like everything else
 * the renderer emits: the theme decides what a keyword looks like, so the PDF,
 * which reads the colours the browser resolved, carries them too. A language
 * nobody named, or one not in the list, is shown as it was written.
 */
function highlight(code: string, language: string): string {
  const name = language.trim().toLowerCase();
  if (name === '' || !hljs.getLanguage(name)) return '';
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return '';
  }
}

// `breaks: true`: a line break in the source is a line break in the output.
// A design document is written in short lines on purpose, and silently joining
// them would make the rendered text disagree with the file a reviewer reads.
export const markdown = new MarkdownIt({
  html: true, linkify: false, typographer: false, breaks: true,
  highlight,
}).use(bracketedSpan);

// `hljs` on every highlighted block, so the theme can colour it as one.
const plainFence = markdown.renderer.rules.fence!;
markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index]!;
  const { language, attributes } = fenceInfo(token.info);
  if (language === 'mermaid') {
    // The opening line is what holds the choice, so that is the range an
    // editor rewrites to change it.
    const line = token.map?.[0];
    const lineSpan = (env as RenderEnv | undefined)?.lineSpan;
    const span = line === undefined || lineSpan === undefined ? undefined : lineSpan(line);
    return mermaidFigure(token.content, viewOf(attributes.get('view')), span);
  }
  const html = plainFence(tokens, index, options, env, self);
  const coloured = hljs.getLanguage(language) ? html.replace('<code class="', '<code class="hljs ') : html;
  return codeBlock(coloured, language, (env as RenderEnv | undefined)?.locale ?? DEFAULT_LOCALE);
};

/**
 * The names a reader knows a language by, for the label on a code block. A
 * language written that is not here is labelled as written.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  bash: 'Bash', sh: 'Shell', shell: 'Shell', zsh: 'Shell', console: 'Shell',
  powershell: 'PowerShell', ps: 'PowerShell', ps1: 'PowerShell',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  json: 'JSON', yaml: 'YAML', yml: 'YAML',
  xml: 'XML', html: 'HTML', xhtml: 'HTML', svg: 'SVG', css: 'CSS',
  sql: 'SQL', python: 'Python', py: 'Python', java: 'Java', kotlin: 'Kotlin', kt: 'Kotlin',
  csharp: 'C#', cs: 'C#', 'c#': 'C#', go: 'Go', golang: 'Go', diff: 'Diff', patch: 'Diff',
  ini: 'INI', toml: 'TOML', dockerfile: 'Dockerfile', docker: 'Dockerfile',
  markdown: 'Markdown', md: 'Markdown',
  mermaid: 'Mermaid',
};

/** The label a code block carries, or nothing when no language was written. */
export function languageLabel(language: string, locale: Locale = DEFAULT_LOCALE): string | undefined {
  if (language === '') return undefined;
  // Plain text is the one name that is a word rather than a proper noun.
  if (PLAIN.has(language)) return MARKDOWN_MESSAGES.in(locale)('markdown.code.text');
  return LANGUAGE_NAMES[language] ?? language;
}

const PLAIN = new Set(['plaintext', 'text', 'txt']);

/**
 * A code block with its language named above it. The label is part of the
 * document rather than editor chrome: a reader of the PDF needs to know that
 * the lines are SQL as much as the author does.
 */
function codeBlock(pre: string, language: string, locale: Locale): string {
  const label = languageLabel(language, locale);
  const head = label === undefined
    ? ''
    : `<div class="dp-code-head"><span class="dp-code-language">${escapeHtml(label)}</span></div>`;
  return `<div class="dp-code" data-language="${escapeAttr(language)}">${head}${pre.replace(/\n$/, '')}</div>\n`;
}

/** What a prose block tells the renderer about where its lines are. */
export interface RenderEnv {
  [key: string | symbol]: unknown;
  /** The byte range of one line of the block, counted from its first line. */
  readonly lineSpan?: (line: number) => { start: number; end: number } | undefined;
  /** The language words the renderer adds — a code block's "Text" — are in. */
  readonly locale?: Locale;
}

/** How a Mermaid block is shown: the drawing, the code it is drawn from, or both. */
export type MermaidView = 'diagram' | 'code' | 'both';

export const MERMAID_VIEWS: readonly MermaidView[] = ['diagram', 'code', 'both'];

export function viewOf(value: string | undefined): MermaidView {
  return value === 'code' || value === 'both' ? value : 'diagram';
}

/**
 * A Mermaid block, ready for whoever draws it.
 *
 * Mermaid needs a browser to lay a drawing out, and this renderer runs in Node
 * as well, so the drawing is left to the page: the figure carries the source,
 * and until something draws it the source is what shows. A page nobody draws
 * on — a build with no runtime — is therefore wrong in the safe direction.
 * Which of the two the reader sees is the author's choice, written on the block.
 */
export function mermaidFigure(
  source: string, view: MermaidView, span: { start: number; end: number } | undefined,
): string {
  const code = escapeHtml(source.replace(/\n$/, ''));
  const ranged = span === undefined ? '' : ` data-span="${span.start},${span.end}"`;
  return `<figure class="dp-mermaid" data-view="${view}"${ranged}>`
    + `<div class="dp-mermaid-diagram" data-source="${escapeAttr(source)}">`
    + `<pre class="dp-mermaid-pending">${code}</pre></div>`
    + `<div class="dp-code dp-mermaid-code" data-language="mermaid">`
    + `<div class="dp-code-head"><span class="dp-code-language">Mermaid</span></div>`
    + `<pre><code>${code}</code></pre></div>`
    + `</figure>\n`;
}

/** The language and the `{…}` attributes of a fence's opening line. */
export function fenceInfo(info: string): { language: string; attributes: Map<string, string> } {
  const found = /^\s*([^\s{]*)\s*(?:\{(.*)\})?\s*$/.exec(info);
  const attributes = new Map<string, string>();
  const token = /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*(\S+)/g;
  for (let m = token.exec(found?.[2] ?? ''); m; m = token.exec(found?.[2] ?? '')) {
    attributes.set(m[1] ?? m[3]!, m[2] ?? m[4]!);
  }
  return { language: (found?.[1] ?? '').toLowerCase(), attributes };
}

/** One fenced code block of a prose block, by line. */
export interface Fence {
  readonly language: string;
  readonly attributes: ReadonlyMap<string, string>;
  /** What is between the fences. */
  readonly content: string;
  /** The opening line. */
  readonly from: number;
  /** The closing line, or the last line when the block is never closed. */
  readonly to: number;
}

/**
 * The fenced code blocks of a prose block, found the way CommonMark finds
 * them, for the outputs that do not go through markdown-it — a slide is not
 * HTML, and the build has to know which drawings to make before it writes one.
 */
export function fencesOf(text: string): Fence[] {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
  const found: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]!);
    if (!open) continue;
    const fence = open[1]!;
    let end = i + 1;
    for (; end < lines.length; end++) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[end]!);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) break;
    }
    const { language, attributes } = fenceInfo(open[2] ?? '');
    found.push({
      language, attributes,
      content: lines.slice(i + 1, Math.min(end, lines.length)).join('\n'),
      from: i, to: Math.min(end, lines.length - 1),
    });
    i = end;
  }
  return found;
}

/**
 * The opening line of a Mermaid fence with its view set, keeping the fence
 * characters and every other attribute as written. `diagram` is the default,
 * so it is written by removing the attribute.
 */
export function setFenceView(line: string, view: MermaidView): string {
  const found = /^(\s*(?:`{3,}|~{3,})\s*mermaid)\s*(?:\{(.*)\})?\s*$/i.exec(line);
  if (!found) return line;
  const rest = (found[2] ?? '').match(/[\w-]+\s*=\s*"[^"]*"|[\w-]+\s*=\s*\S+|#[\w-]+|[\w-]+/g) ?? [];
  const kept = rest.filter(part => !/^view\s*=/.test(part));
  if (view !== 'diagram') kept.push(`view="${view}"`);
  return kept.length === 0 ? found[1]! : `${found[1]} {${kept.join(' ')}}`;
}
