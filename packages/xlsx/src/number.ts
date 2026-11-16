// Which cells go to Excel as numbers, and how a number comes back as text.
//
// A cell is a number only when the number and a display format between them
// give back exactly what was written: `1.50` is 1.5 shown as `0.00`, `1,000`
// is 1000 shown as `#,##0`, `50%` is 0.5 shown as `0%`. Anything that would
// come back different — `001`, `.5`, `+5`, `1,00`, a sixteenth digit, a minus
// zero — stays text, so a round trip through Excel never rewrites a cell
// nobody touched. A number is worth the trouble because Excel adds numbers up
// and does not add text.

/** A cell that goes to Excel as a number, and the format that shows it as written. */
export interface AsNumber {
  readonly value: number;
  /** An Excel number format code; `General` for a plain integer or decimal without trailing zeros. */
  readonly format: string;
}

const SHAPE = /^(-?)(0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d+))?(%?)$/;
/** Excel keeps fifteen significant digits; a sixteenth would come back changed. */
const DIGITS = 15;

/** The number a cell's text is, with its format, or undefined when it should stay text. */
export function asNumber(text: string): AsNumber | undefined {
  const found = SHAPE.exec(text.trim());
  if (!found) return undefined;
  const [, minus, whole, fraction = '', percent] = found;
  const grouped = whole!.includes(',');
  const digits = (whole!.replace(/,/g, '') + fraction).replace(/^0+/, '');
  if (digits.length > DIGITS) return undefined;
  const plain = Number(`${minus}${whole!.replace(/,/g, '')}${fraction ? `.${fraction}` : ''}`);
  // Excel shows a negative zero as zero: the minus would be lost.
  if (plain === 0 && minus === '-') return undefined;
  const value = percent ? scaled(plain, fraction.length) : plain;
  const decimals = fraction ? `.${'0'.repeat(fraction.length)}` : '';
  const general = !grouped && !percent && !fraction.endsWith('0');
  const format = general
    ? 'General'
    : `${grouped ? '#,##0' : '0'}${decimals}${percent ? '%' : ''}`;
  // A format code is the only proof: if it does not give the text back, text it stays.
  return formatNumber(value, format) === text.trim() ? { value, format } : undefined;
}

/** A percentage divided by a hundred without the float noise of `/ 100`. */
function scaled(value: number, decimals: number): number {
  return Number((value / 100).toFixed(decimals + 2));
}

/**
 * A number shown in an Excel format code: General, the digit and grouping
 * patterns (`0`, `0.00`, `#,##0.0`), percentages, and dates and times
 * (`yyyy/m/d`, `h:mm`). A code beyond those is shown as General — the value
 * is right even where the decoration is not.
 */
export function formatNumber(value: number, format: string): string {
  const code = sectionOf(format, value);
  if (code === '' || /^general$/i.test(code)) return general(value);
  if (isDateCode(code)) return formatDate(value, code);
  return formatDigits(value, code);
}

/** Excel's General: up to fifteen significant digits, no exponent for ordinary sizes. */
export function general(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Number(value.toPrecision(DIGITS));
  if (Math.abs(rounded) >= 1e15 || (rounded !== 0 && Math.abs(rounded) < 1e-9)) {
    return rounded.toExponential().replace('e+', 'E+').replace('e-', 'E-');
  }
  return String(rounded);
}

/** The part of a `pos;neg;zero;text` code that applies, with colours and conditions taken off. */
function sectionOf(format: string, value: number): string {
  const sections = splitSections(format);
  const pick = value < 0 && sections.length > 1 ? sections[1]!
    : value === 0 && sections.length > 2 ? sections[2]! : sections[0]!;
  return pick.replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, '').trim();
}

function splitSections(format: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of format) {
    if (char === '"') quoted = !quoted;
    if (char === ';' && !quoted) { out.push(current); current = ''; continue; }
    current += char;
  }
  out.push(current);
  return out;
}

function isDateCode(code: string): boolean {
  return /[ymdhs]/i.test(code.replace(/"[^"]*"/g, '').replace(/\\./g, ''));
}

function formatDigits(value: number, code: string): string {
  const percent = code.includes('%');
  const shown = percent ? value * 100 : value;
  const body = code.replace(/"[^"]*"/g, '').replace(/[^0#,.?]/g, '');
  const dot = body.indexOf('.');
  const decimals = dot < 0 ? 0 : body.slice(dot + 1).replace(/[^0#?]/g, '').length;
  const grouped = (dot < 0 ? body : body.slice(0, dot)).includes(',');
  const fixed = Math.abs(shown).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const integer = grouped ? whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole!;
  // A negative number in a single-section code carries its minus.
  const sign = value < 0 && Number(fixed) !== 0 && splitSections(code).length < 2 ? '-' : '';
  const digits = `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
  // What the code writes around the digits — a unit, a currency sign — stays.
  const before = literalText(code.slice(0, Math.max(0, code.search(/[0#?]/))));
  const tailAt = Math.max(code.lastIndexOf('0'), code.lastIndexOf('#'), code.lastIndexOf('?'));
  const after = literalText(code.slice(tailAt + 1).replace('%', '\u0000')).replace('\u0000', '%');
  return `${before}${digits}${after}`;
}

function literalText(part: string): string {
  return part.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/[_*]./g, '').replace(/[,.]/g, '');
}

const DAY = 86_400_000;

/** A serial date (days since 1899-12-30, Excel's 1900 system) shown in a date code. */
function formatDate(value: number, code: string): string {
  const time = Math.round((value - Math.floor(value)) * 86_400);
  const day = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * DAY);
  const parts = {
    y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate(),
    h: Math.floor(time / 3600), n: Math.floor((time % 3600) / 60), s: time % 60,
  };
  const twelve = /am\/pm|a\/p/i.test(code);
  let out = '';
  let lastWasHour = false;
  for (let i = 0; i < code.length;) {
    const rest = code.slice(i);
    if (rest[0] === '"') {
      const end = code.indexOf('"', i + 1);
      out += code.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? code.length : end + 1;
      continue;
    }
    if (rest[0] === '\\') { out += rest[1] ?? ''; i += 2; continue; }
    const ampm = /^(am\/pm|a\/p)/i.exec(rest);
    if (ampm) { out += parts.h < 12 ? 'AM' : 'PM'; i += ampm[0].length; continue; }
    const token = /^(y+|m+|d+|h+|s+)/i.exec(rest);
    if (!token) { out += rest[0]; i += 1; continue; }
    const word = token[0].toLowerCase();
    const kind = word[0]!;
    const width = word.length;
    i += width;
    if (kind === 'y') { out += width <= 2 ? String(parts.y % 100).padStart(2, '0') : String(parts.y); continue; }
    if (kind === 'd') {
      out += width >= 3 ? ['日', '月', '火', '水', '木', '金', '土'][day.getUTCDay()]! : String(parts.d).padStart(width, '0');
      continue;
    }
    if (kind === 'h') {
      const hour = twelve ? ((parts.h + 11) % 12) + 1 : parts.h;
      out += String(hour).padStart(width, '0');
      lastWasHour = true;
      continue;
    }
    if (kind === 's') { out += String(parts.s).padStart(width, '0'); continue; }
    // `m` is minutes right after an hour or right before seconds, months otherwise.
    const minutes = lastWasHour || /^[^a-z]*s/i.test(code.slice(i));
    out += String(minutes ? parts.n : parts.m).padStart(width, '0');
    lastWasHour = false;
  }
  return out;
}

/** Excel's built-in number formats that a saved file may name by id alone. */
export const BUILT_IN_FORMATS: Readonly<Record<number, string>> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
  11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'yyyy/m/d', 15: 'd-mmm-yy', 16: 'd-mmm',
  17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'yyyy/m/d h:mm', 27: 'yyyy"年"m"月"', 28: 'm"月"d"日"', 29: 'm"月"d"日"',
  30: 'm/d/yy', 31: 'yyyy"年"m"月"d"日"', 32: 'h"時"mm"分"', 33: 'h"時"mm"分"ss"秒"',
  34: 'yyyy"年"m"月"', 35: 'm"月"d"日"', 36: 'yyyy/m/d', 37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
  55: 'yyyy"年"m"月"', 56: 'm"月"d"日"', 57: 'yyyy"年"m"月"', 58: 'm"月"d"日"',
};
