// One Markdown file from a document made of many.
//
// A design document here is a Markdown file that takes in others: chapters
// in their own `.md`, tables in `.table`, drawings in `.dgm`. Somebody who
// is not using this tool — a wiki, a reviewer's editor, a repository's front
// page — reads one ordinary Markdown file. So the document is written out as
// one: what it takes in is in it, tables are Markdown tables, drawings are
// SVG files beside it shown as pictures, and the numbers the build works out
// (章 2.1, 図 3, 表 1) are written in as text, because no other reader would
// work them out.

import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { parseDiagram, renderDiagram, standaloneSvg, withParts } from '@docpresenter/diagram';
import {
  describe, documentVariables, expandVariables, formatGrid, isAddress, joinPath, parseTable,
  relativeTo, selectRows, type NumberedElement,
} from '@docpresenter/markdown';
import { prepare, type PreparedDocument } from './build.js';
import type { Root } from './graph.js';
import { asLf, type Workspace } from './workspace.js';

export interface SingleMarkdownOptions {
  /** Where the Markdown file will be written, from the workspace root. */
  readonly out: string;
  /** The theme's CSS, for the drawings' look inside their SVG files. */
  readonly theme: string;
  readonly locale?: Locale;
}

export interface SingleMarkdown {
  readonly text: string;
  /** The drawings, as SVG files, by their path from the workspace root. */
  readonly files: ReadonlyMap<string, string>;
  readonly prepared: PreparedDocument;
}

const REFERENCE = /@(?:([A-Za-z0-9][\w.-]*):)?((?:fig|tbl|sec|req|des|tst)-[A-Za-z0-9_-]+)/g;
const PICTURE = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

export function singleMarkdown(given: Workspace, root: Root, options: SingleMarkdownOptions): SingleMarkdown {
  const workspace = asLf(given);
  const locale = options.locale ?? DEFAULT_LOCALE;
  const prepared = prepare(workspace, root, locale);
  const { document, resolved } = prepared;
  const names = documentVariables(document.frontmatter, { path: root.path });
  const elementOf = new Map<unknown, NumberedElement>(resolved.elements.map(one => [one.block, one]));
  const files = new Map<string, string>();
  const folder = options.out.replace(/\.md$/i, '-figures');

  /** `@fig-x` as the words it stands for, and `{{name}}` filled in; code kept as written. */
  const words = (text: string): string => expandVariables(outsideCode(text, REFERENCE, (whole, label) => {
    const target = resolved.byLabel.get(label);
    return target?.number === undefined ? whole : describe(target, locale);
  }), names);
  const caption = (element: NumberedElement | undefined, written: string | undefined): string => {
    const head = element?.number === undefined ? '' : describe(element, locale);
    const text = [head, written === undefined ? '' : words(written)].filter(one => one !== '').join('　');
    return text === '' ? '' : `**${text}**`;
  };
  const link = (path: string): string => (isAddress(path) ? path : relativeTo(options.out, path));

  const parts: string[] = [];
  const source = workspace.read(root.path) ?? '';
  // The front matter as written: the title and the version are the reader's too.
  if (document.frontmatter.span) parts.push(source.slice(0, document.frontmatter.span.end).replace(/\r/g, ''));

  for (const block of document.blocks) {
    switch (block.kind) {
      case 'heading': {
        const number = elementOf.get(block)?.number;
        parts.push(`${'#'.repeat(block.level)} ${number === undefined ? '' : `${number} `}${words(block.text)}`);
        break;
      }
      case 'prose':
        parts.push(words(block.text.replace(/\r/g, '')));
        break;
      case 'separator':
        parts.push('---');
        break;
      case 'import': {
        const element = elementOf.get(block);
        const said = caption(element, block.attributes.get('caption'));
        const path = block.path;
        const text = isAddress(path) ? undefined : workspace.read(path);
        if (/\.table$/i.test(path) || /\.xlsx(#.*)?$/i.test(path)) {
          if (text === undefined) { parts.push(`[${path}](${link(path)})`); break; }
          const table = parseTable(text);
          const rows = block.attributes.get('rows');
          const shown = rows === undefined ? table : selectRows(table, rows) ?? table;
          parts.push([said, formatGrid(shown).replace(/\n+$/, '')].filter(one => one !== '').join('\n\n'));
        } else if (/\.dgm$/i.test(path) && text !== undefined) {
          const drawing = withParts(parseDiagram(text), used => workspace.read(joinPath(path, used)));
          const svg = renderDiagram(drawing, picture => workspace.dataUrl?.(joinPath(path, picture)) ?? picture,
            undefined, locale);
          const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.dgm$/i, '');
          let file = `${folder}/${stem}.svg`;
          for (let n = 2; files.has(file); n++) file = `${folder}/${stem}-${n}.svg`;
          files.set(file, standaloneSvg(svg, options.theme));
          parts.push([`![${plain(said) || stem}](${relativeTo(options.out, file)})`, said].filter(one => one !== '').join('\n\n'));
        } else if (/\.(mmd|mermaid)$/i.test(path) && text !== undefined) {
          parts.push([`\`\`\`mermaid\n${text.replace(/\n+$/, '')}\n\`\`\``, said].filter(one => one !== '').join('\n\n'));
        } else if (PICTURE.test(path) || isAddress(path)) {
          const alt = block.attributes.get('alt') ?? plain(said);
          parts.push([`![${alt}](${link(path)})`, said].filter(one => one !== '').join('\n\n'));
        } else {
          parts.push(`[${path}](${link(path)})`);
        }
        break;
      }
    }
  }
  return { text: `${parts.filter(one => one.trim() !== '').join('\n\n')}\n`, files, prepared };
}

/** A caption without its bold marks, for a picture's alternative text. */
function plain(text: string): string {
  return text.replace(/^\*\*|\*\*$/g, '');
}

/** Replaces what `pattern` finds, except in fenced code and code spans. */
function outsideCode(text: string, pattern: RegExp, replace: (whole: string, label: string) => string): string {
  const code: [number, number][] = [];
  let at = 0;
  let open: { fence: string; from: number } | undefined;
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open === undefined && marker) open = { fence: marker[1]!, from: at };
    else if (open !== undefined && marker && marker[1]![0] === open.fence[0]
      && marker[1]!.length >= open.fence.length && marker[2]!.trim() === '') {
      code.push([open.from, at + line.length]);
      open = undefined;
    }
    at += line.length + 1;
  }
  if (open !== undefined) code.push([open.from, text.length]);
  const span = /(`+)[\s\S]*?[^`]\1(?!`)/g;
  for (let match = span.exec(text); match; match = span.exec(text)) code.push([match.index, match.index + match[0].length]);
  pattern.lastIndex = 0;
  return text.replace(pattern, (whole: string, _document: string | undefined, label: string, index: number) =>
    (code.some(([from, to]) => index >= from && index < to) ? whole : replace(whole, label)));
}
