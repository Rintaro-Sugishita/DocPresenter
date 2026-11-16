// A cell's inline notation and Excel's rich text, both ways.
//
// A `.table` cell says `**太字**` and `[赤]{color=#c62828}`; an Excel cell says
// the same with runs of text in a font. The marks are the ones the format bar
// writes (spec/inline-text.md): bold, italic, code, strikethrough, underline,
// superscript, subscript and a colour. Code has no Excel equivalent, so it is
// carried as a monospace font and read back as code.

import { parseRuns, type Run } from '@docpresenter/diagram';

export type { Run } from '@docpresenter/diagram';

/** The font a code run is written in, and the fonts read back as code. */
export const CODE_FONT = 'Consolas';
const CODE_FONTS = /^(consolas|courier new|courier|ms gothic|ｍｓ ゴシック|ms ゴシック|menlo|monaco|source code pro|cascadia (code|mono))$/i;

export function isCodeFont(name: string | undefined): boolean {
  return name !== undefined && CODE_FONTS.test(name.trim());
}

/** Characters that start a mark; text without any of them is plain as it stands. */
const MARKS = /[*`~^[\\]/;

/** The runs a cell's text shows. */
export function runsOf(text: string): Run[] {
  if (!MARKS.test(text)) return text === '' ? [] : [plain(text)];
  return parseRuns(text);
}

export function plain(text: string): Run {
  return { text, bold: false, italic: false, code: false, colour: undefined };
}

type Style = Omit<Run, 'text'>;

export function styleOf(run: Run): Style {
  const { text: _text, ...style } = run;
  return normal(style);
}

/** One style, with absent and false read the same. */
function normal(style: Style): Style {
  return {
    bold: style.bold, italic: style.italic, code: style.code,
    colour: style.colour?.toLowerCase(),
    strike: style.strike === true, underline: style.underline === true,
    script: style.script,
  };
}

export function sameStyle(a: Style, b: Style): boolean {
  const x = normal(a);
  const y = normal(b);
  return x.bold === y.bold && x.italic === y.italic && x.code === y.code && x.colour === y.colour
    && x.strike === y.strike && x.underline === y.underline && x.script === y.script;
}

/** Whether every run is drawn the same way, so the style can be the cell's own. */
export function uniform(runs: readonly Run[]): boolean {
  return runs.every(run => sameStyle(run, runs[0]!));
}

/**
 * Runs written back in the inline notation. Neighbouring runs drawn the same
 * way are joined first, so a word Excel split into pieces comes back as one
 * mark. A character that would start a mark is escaped, so text typed in
 * Excel says what it said there.
 */
export function inlineOf(runs: readonly Run[]): string {
  const joined: Run[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const last = joined[joined.length - 1];
    if (last && sameStyle(last, run)) joined[joined.length - 1] = { ...last, text: last.text + run.text };
    else joined.push(run);
  }
  return nested(joined, OUTER);
}

type Outer = 'colour' | 'underline' | 'strike' | 'bold' | 'italic';
/** The marks that can hold others, outermost first. */
const OUTER: readonly Outer[] = ['colour', 'underline', 'strike', 'bold', 'italic'];

/**
 * Runs written with each mark opened once over every neighbouring run that
 * has it: `~~H~2~O~~`, not `~~H~~~2~~~O~~`, which would read back as
 * something else — a `~` next to `~~` is never a subscript.
 */
function nested(runs: readonly Run[], marks: readonly Outer[]): string {
  const [mark, ...rest] = marks;
  if (mark === undefined) return runs.map(innermost).join('');
  const key = (run: Run): string => mark === 'colour' ? run.colour?.toLowerCase() ?? '' : run[mark] ? '1' : '';
  let out = '';
  for (let i = 0; i < runs.length;) {
    let j = i + 1;
    while (j < runs.length && key(runs[j]!) === key(runs[i]!)) j++;
    const inner = nested(runs.slice(i, j), rest);
    out += key(runs[i]!) === '' ? inner : wrap(inner, mark, runs[i]!);
    i = j;
  }
  return out;
}

function wrap(inner: string, mark: Outer, run: Run): string {
  // Spaces at the edges stay outside the marks: `** x**` is not bold.
  const lead = /^\s*/.exec(inner)![0];
  const trail = inner.slice(lead.length).match(/\s*$/)![0];
  const core = inner.slice(lead.length, inner.length - trail.length);
  if (core === '') return inner;
  const marked = mark === 'italic' ? `*${core}*`
    : mark === 'bold' ? `**${core}**`
      : mark === 'strike' ? `~~${core}~~`
        : mark === 'underline' ? `[${core}]{.underline}`
          : `[${core}]{color=${run.colour!.toLowerCase()}}`;
  return `${lead}${marked}${trail}`;
}

/** One run's own text: escaped, or as code, raised or lowered. */
function innermost(run: Run): string {
  const lead = /^\s*/.exec(run.text)![0];
  const trail = run.text.slice(lead.length).match(/\s*$/)![0];
  const core = run.text.slice(lead.length, run.text.length - trail.length);
  if (core === '') return run.text;
  let text = run.code ? `\`${core.replace(/`/g, "'")}\`` : escapeMarks(core);
  if (run.script) {
    // Pandoc's rule: a space inside a raise is spelt `\ `.
    text = run.script === 'sup' ? `^${text.replace(/ /g, '\\ ')}^` : `~${text.replace(/ /g, '\\ ')}~`;
  }
  return `${lead}${text}${trail}`;
}

/** A backslash before every character that would otherwise start a mark. */
export function escapeMarks(text: string): string {
  return text.replace(/\\(?=[!-/:-@[-`{-~])|[*`~^[]/g, match => `\\${match}`);
}
