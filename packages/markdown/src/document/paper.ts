// The paper a document is printed on, from its front matter.
//
//   paper: A4              # A3 A4 A5 B4 B5 letter slide slide-4:3
//   paper: A4 landscape    # or `orientation: landscape` on a line of its own
//
// The theme says the paper when the document does not. What is said here
// reaches the PDF as the page size and the screen as the size of the sheet,
// so what is written is seen at the size it will be printed. `slide` is the
// 16:9 page a presentation is shown on, and is wide unless told otherwise.

/** Paper sizes, in millimetres, upright. */
const SIZES: Readonly<Record<string, readonly [number, number]>> = {
  a3: [297, 420], a4: [210, 297], a5: [148, 210],
  b4: [257, 364], b5: [182, 257],
  letter: [215.9, 279.4], legal: [215.9, 355.6],
  // 13.333 × 7.5 inches, the slide a PPTX is written on.
  slide: [190.5, 338.67],
  // 10 × 7.5 inches: the 4:3 slide.
  'slide-4:3': [190.5, 254],
};

/** The names a document may give, as the screen offers them. */
export const PAPER_NAMES: readonly string[] = ['A4', 'A3', 'A5', 'B4', 'B5', 'letter', 'slide', 'slide-4:3'];

export type PaperOrientation = 'portrait' | 'landscape';

export interface Paper {
  /** As written in the front matter, in the case the list above uses. */
  readonly name: string;
  readonly orientation: PaperOrientation;
  /** Millimetres, the way it is printed: a landscape page is the wide one. */
  readonly width: number;
  readonly height: number;
}

/** The paper the front matter asks for, or undefined when it leaves it to the theme. */
export function paperOf(raw: Readonly<Record<string, unknown>>): Paper | undefined {
  const written = typeof raw['paper'] === 'string' ? raw['paper'].trim() : '';
  if (written === '') return undefined;
  const words = written.split(/[\s,]+/);
  const key = words[0]!.toLowerCase();
  const size = SIZES[key];
  if (!size) return undefined;
  const asked = [words[1], raw['orientation']]
    .map(one => (typeof one === 'string' ? one.trim().toLowerCase() : ''))
    .find(one => one === 'landscape' || one === 'portrait' || one === '横' || one === '縦');
  const orientation: PaperOrientation = asked === undefined
    ? (key.startsWith('slide') ? 'landscape' : 'portrait')
    : asked === 'landscape' || asked === '横' ? 'landscape' : 'portrait';
  const [short, long] = size;
  const name = PAPER_NAMES.find(one => one.toLowerCase() === key) ?? key;
  return orientation === 'landscape'
    ? { name, orientation, width: long, height: short }
    : { name, orientation, width: short, height: long };
}

/** The paper as the CSS custom properties the theme and the PDF read. */
export function paperStyle(paper: Paper): string {
  return `--page-width: ${paper.width}mm; --page-height: ${paper.height}mm;`;
}

/** The front matter value for a paper: `A4`, `A4 landscape`, `slide`. */
export function paperValue(name: string, orientation: PaperOrientation): string {
  const usual: PaperOrientation = name.toLowerCase().startsWith('slide') ? 'landscape' : 'portrait';
  return orientation === usual ? name : `${name} ${orientation}`;
}

/**
 * The front matter with one top-level key set, or taken away when `value` is
 * undefined — as one replacement of the front matter's lines, everything else
 * in them kept as written. A document with no front matter is given one.
 */
export function setFrontmatterKey(
  source: string, key: string, value: string | undefined,
): { span: { start: number; end: number }; text: string } {
  const encoder = new TextEncoder();
  const bytes = (text: string): number => encoder.encode(text).length;
  const crlf = source.includes('\r\n');
  const ending = crlf ? '\r\n' : '\n';
  const lines = source.split('\n').map(line => line.replace(/\r$/, ''));
  const line = value === undefined ? undefined : `${key}: ${/^[\w .:+-]+$/u.test(value) ? value : JSON.stringify(value)}`;
  if ((lines[0] ?? '').trim() !== '---') {
    if (line === undefined) return { span: { start: 0, end: 0 }, text: '' };
    return { span: { start: 0, end: 0 }, text: `---${ending}${line}${ending}---${ending}${ending}` };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) if ((lines[i] ?? '').trim() === '---') { close = i; break; }
  if (close < 0) return { span: { start: 0, end: 0 }, text: '' };
  const body = lines.slice(1, close);
  const at = body.findIndex(one => new RegExp(`^${key}\\s*:`).test(one));
  if (at >= 0) {
    // A value written over several lines takes its indented lines with it.
    let last = at;
    while (last + 1 < body.length && /^\s+\S/.test(body[last + 1]!)) last++;
    body.splice(at, last - at + 1, ...(line === undefined ? [] : [line]));
  } else if (line !== undefined) {
    body.push(line);
  }
  const first = bytes(lines[0]!) + (crlf ? 2 : 1);
  const end = lines.slice(0, close).reduce((sum, one) => sum + bytes(one) + (crlf ? 2 : 1), 0);
  return { span: { start: first, end }, text: body.map(one => one + ending).join('') };
}
