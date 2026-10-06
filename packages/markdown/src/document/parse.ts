// Parses a document. Markdown is the substrate; the only departures are the
// @import directive, labels on headings, `@label` references and `---`.

import { parse as parseYaml } from 'yaml';
import { byteLength } from '@docpresenter/base';
import type {
  Block, ByteSpan, DocumentFile, Frontmatter, Import, Reference,
} from './model.js';

/** Label prefixes decide the kind of the thing being referenced. */
const LABEL = String.raw`(?:fig|tbl|sec|req|des|tst)-[A-Za-z0-9_-]+`;
const REFERENCE = new RegExp(String.raw`@(?:([A-Za-z0-9][\w.-]*):)?(${LABEL})`, 'g');
const HEADING = /^(#{1,6})\s+(.*?)(?:\s*\{#([A-Za-z0-9_-]+)\})?\s*$/;
const IMPORT = /^@import\s+"([^"]+)"\s*(?:\{(.*)\})?\s*$/;
/** Also accepted on read, though never written back. */
const IMAGE_IMPORT = /^!\[([^\]]*)\]\(([^)]+)\)\s*(?:\{(.*)\})?\s*$/;
/** The line that opens or closes a fenced code block, as CommonMark has it. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export class DocumentParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message}（${line} 行目）`);
    this.name = 'DocumentParseError';
  }
}

export function parseDocument(source: string): DocumentFile {
  const lines = source.split('\n');
  const blocks: Block[] = [];

  /** Byte offset of the start of each line, built as we go. */
  const lineStart: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStart.push(offset);
    offset += byteLength(line) + 1; // the split consumed one '\n'
  }
  const spanOfLines = (from: number, to: number): ByteSpan => ({
    start: lineStart[from]!,
    end: lineStart[to]! + byteLength(lines[to]!),
  });

  let i = 0;
  const frontmatter = readFrontmatter(lines, lineStart, () => i, n => { i = n; });

  let proseFrom = -1;
  const flushProse = (until: number): void => {
    if (proseFrom < 0) return;
    let last = until - 1;
    while (last > proseFrom && (lines[last] ?? '').trim() === '') last--;
    const span = spanOfLines(proseFrom, last);
    const text = lines.slice(proseFrom, last + 1).join('\n');
    if (text.trim() !== '') {
      blocks.push({ kind: 'prose', text, references: findReferences(text, span.start), span });
    }
    proseFrom = -1;
  };

  /** The fence a code block was opened with, while inside one. */
  let fence: string | undefined;
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const text = raw.trim();

    // Inside a code block every line is code: a `# comment` in a shell script
    // is not a heading, and a `---` in YAML is not a sheet boundary.
    const marker = FENCE.exec(raw.replace(/\r$/, ''));
    if (fence !== undefined) {
      if (marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length
        && marker[2]!.trim() === '') fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker[1]!;
      if (proseFrom < 0) proseFrom = i;
      continue;
    }

    if (text === '---') {
      // CommonMark reads `---` under a non-blank line as a setext heading.
      const previous = i > 0 ? (lines[i - 1] ?? '').trim() : '';
      if (previous !== '') {
        throw new DocumentParseError(
          '`---` の前には空行が必要（setext 見出しと区別できないため）', i + 1,
        );
      }
      flushProse(i);
      blocks.push({ kind: 'separator', span: spanOfLines(i, i) });
      continue;
    }

    const heading = HEADING.exec(text);
    if (heading) {
      flushProse(i);
      const span = spanOfLines(i, i);
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length,
        text: heading[2]!.trim(),
        label: heading[3],
        references: findReferences(heading[2]!, span.start),
        span,
      });
      continue;
    }

    const directive = parseImport(text, spanOfLines(i, i));
    if (directive) {
      flushProse(i);
      blocks.push(directive);
      continue;
    }

    if (text !== '' && proseFrom < 0) proseFrom = i;
  }
  flushProse(lines.length);

  return { frontmatter, blocks };
}

function readFrontmatter(
  lines: string[], lineStart: number[], get: () => number, set: (n: number) => void,
): Frontmatter {
  const empty: Frontmatter = { raw: {}, output: [], theme: undefined, span: undefined };
  if ((lines[0] ?? '').trim() !== '---') return empty;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') { end = i; break; }
  }
  if (end < 0) throw new DocumentParseError('frontmatter が閉じられていない', 1);

  // A file checked out on Windows ends its lines in CRLF; the YAML reader
  // takes the '\r' for part of the value. The spans stay on the raw lines.
  const body = lines.slice(1, end).map(line => line.replace(/\r$/, '')).join('\n');
  const parsed: unknown = body.trim() === '' ? {} : parseYaml(body);
  const raw = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  const output = raw['output'];
  set(end + 1);
  void get;
  return {
    raw,
    output: Array.isArray(output) ? output.map(String) : typeof output === 'string' ? [output] : [],
    theme: typeof raw['theme'] === 'string' ? raw['theme'] : undefined,
    span: { start: lineStart[0]!, end: lineStart[end]! + byteLength(lines[end]!) },
  };
}

function parseImport(text: string, span: ByteSpan): Import | undefined {
  const direct = IMPORT.exec(text);
  if (direct) {
    const attributes = parseAttributes(direct[2]);
    return { kind: 'import', path: direct[1]!, label: attributes.get('#'), attributes, span };
  }
  const image = IMAGE_IMPORT.exec(text);
  if (image) {
    const attributes = parseAttributes(image[3]);
    if (image[1]) attributes.set('alt', image[1]);
    return { kind: 'import', path: image[2]!, label: attributes.get('#'), attributes, span };
  }
  return undefined;
}

/** Reads `#label key="value" flag` into a map; the label is stored under `#`. */
function parseAttributes(source: string | undefined): Map<string, string> {
  const attributes = new Map<string, string>();
  if (!source) return attributes;
  const token = /#([A-Za-z0-9_-]+)|([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*(\S+)|([\w-]+)/g;
  for (let m = token.exec(source); m; m = token.exec(source)) {
    if (m[1] !== undefined) attributes.set('#', m[1]);
    else if (m[2] !== undefined) attributes.set(m[2], m[3]!);
    else if (m[4] !== undefined) attributes.set(m[4], m[5]!);
    else if (m[6] !== undefined) attributes.set(m[6], 'true');
  }
  return attributes;
}

/** Finds `@label` references, skipping code spans so identifiers in code are ignored. */
function findReferences(text: string, baseOffset: number): Reference[] {
  const masked = text.replace(/`[^`]*`/g, match => ' '.repeat(match.length));
  const references: Reference[] = [];
  for (let m = REFERENCE.exec(masked); m; m = REFERENCE.exec(masked)) {
    const start = baseOffset + byteLength(masked.slice(0, m.index));
    references.push({
      document: m[1],
      label: m[2]!,
      span: { start, end: start + byteLength(m[0]) },
    });
  }
  REFERENCE.lastIndex = 0;
  return references;
}
