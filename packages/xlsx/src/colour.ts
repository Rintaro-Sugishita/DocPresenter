// Excel's colours as `#rrggbb`.
//
// A colour picked from Excel's palette is saved as a theme colour — "accent 2,
// 40% lighter" — not as red, green and blue. It is resolved against the
// workbook's own theme and its tint applied, so what comes back is the colour
// that was on the screen.

import { child, descendants, type XmlNode } from './xml.js';

/** The theme's twelve colours in the order a `theme="n"` attribute counts them. */
export type ThemeColours = readonly string[];

/** Office's default theme, for a workbook that has none. */
const OFFICE: ThemeColours = [
  'ffffff', '000000', 'e7e6e6', '44546a', '4472c4', 'ed7d31',
  'a5a5a5', 'ffc000', '5b9bd5', '70ad47', '0563c1', '954f72',
];

/** The palette an `indexed="n"` colour counts into (the first 64; 64 and 65 are "system"). */
const INDEXED = [
  '000000', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00', 'ff00ff', '00ffff',
  '000000', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00', 'ff00ff', '00ffff',
  '800000', '008000', '000080', '808000', '800080', '008080', 'c0c0c0', '808080',
  '9999ff', '993366', 'ffffcc', 'ccffff', '660066', 'ff8080', '0066cc', 'ccccff',
  '000080', 'ff00ff', 'ffff00', '00ffff', '800080', '800000', '008080', '0000ff',
  '00ccff', 'ccffff', 'ccffcc', 'ffff99', '99ccff', 'ff99cc', 'cc99ff', 'ffcc99',
  '3366ff', '33cccc', '99cc00', 'ffcc00', 'ff9900', 'ff6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

export function themeColours(theme: XmlNode | undefined): ThemeColours {
  const scheme = descendants(theme, 'clrScheme')[0];
  if (!scheme) return OFFICE;
  const of = (name: string, fallback: string): string => {
    const slot = child(scheme, name);
    const rgb = child(slot, 'srgbClr')?.attributes['val'] ?? child(slot, 'sysClr')?.attributes['lastClr'];
    return rgb?.toLowerCase() ?? fallback;
  };
  // `theme="0"` is light 1 and `theme="1"` dark 1: the file's order swaps the first pairs.
  const names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  return names.map((name, i) => of(name, OFFICE[i]!));
}

/**
 * A colour element (`<color rgb=…/>`, `<fgColor theme=… tint=…/>`) as
 * `#rrggbb`, or undefined for "automatic" and for what cannot be told.
 */
export function colourOf(node: XmlNode | undefined, theme: ThemeColours): string | undefined {
  if (!node) return undefined;
  const { rgb, theme: slot, indexed, tint, auto } = node.attributes;
  if (auto === '1' || auto === 'true') return undefined;
  let hex: string | undefined;
  if (rgb !== undefined) hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  else if (slot !== undefined) hex = theme[Number(slot)];
  else if (indexed !== undefined) hex = INDEXED[Number(indexed)];
  if (hex === undefined || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  return `#${tinted(hex.toLowerCase(), Number(tint ?? 0))}`;
}

/** Excel's tint: towards white when positive, towards black when negative, in HSL lightness. */
function tinted(hex: string, tint: number): string {
  if (!tint) return hex;
  const [h, s, l] = toHsl(hex);
  const lightness = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return fromHsl(h, s, lightness);
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const channel = (t: number): number => {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const rgb = s === 0 ? [l, l, l] : [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
  return rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

/** `#rgb` or `#rrggbb` as Excel's `FFrrggbb`. */
export function argbOf(colour: string): string {
  const hex = colour.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  return `FF${full.toUpperCase()}`;
}

