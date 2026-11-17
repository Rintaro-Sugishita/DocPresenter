// Dark mode for the screen.
//
// The light stylesheets are the only ones written by hand. The dark one is
// made from them: every rule that paints something is copied under
// `html.dp-dark`, with each opaque colour turned round in lightness and its
// hue kept. That way a workspace's own theme goes dark too, with nothing
// written for it, and a colour added to a light sheet can never be forgotten
// in the dark one.
//
// Only the screen goes dark. What is printed, exported or measured for a PDF
// stays as the theme says: the page laid out for a PDF sits in an element
// marked `.dp-print`, which the dark rules leave alone and give the light
// values back to.

/** The class on `<html>` that turns the dark rules on. */
export const DARK_CLASS = 'dp-dark';
/** The class of an element whose contents must keep the light colours (a page measured for print). */
export const PRINT_CLASS = 'dp-print';

/**
 * Property families that are copied whole. A rule is copied with every
 * declaration of these, coloured or not: the copies outrank the originals,
 * so a light `border-left-width: 3px` left out would lose to a copied
 * `border: 1px solid …` of a weaker rule.
 */
const PAINT = /^(color|background(-.*)?|border(-.*)?|outline(-.*)?|box-shadow|text-shadow|text-decoration(-.*)?|fill|stroke|caret-color|column-rule(-.*)?|stop-color|flood-color|lighting-color|accent-color|scrollbar-color)$/i;

/** Named colours the sheets use. */
const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ff0000', gray: '#808080', grey: '#808080', silver: '#c0c0c0',
};

/** Hand-written rules for what turning colours round cannot fix. */
const EXTRA = `
html.${DARK_CLASS} { color-scheme: dark; }
/* Mermaid draws in its own light palette, dark lines on nothing; on a dark page
   the lines would vanish. It keeps a light ground of its own instead. */
html.${DARK_CLASS} .dp-mermaid-diagram > svg:not(.${PRINT_CLASS} *) {
  background: #f7f8fa; border-radius: 4px; padding: 8px; box-sizing: border-box;
}
/* A shape the author filled keeps the author's colour; its words then keep the
   light theme's dark ink, unless the author chose an ink too. */
html.${DARK_CLASS} .dp-diagram [style*="--dp-fill"]:not([style*="--dp-text"]):not(.${PRINT_CLASS} *) .dp-label {
  fill: #1c1f24;
}
`;

// --- Colours --------------------------------------------------------------

type Rgb = readonly [number, number, number];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (0–1) to OKLab. */
function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to linear sRGB, which may lie outside 0–1. */
function toLinearRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * The colour a light colour becomes on the dark screen: its lightness turned
 * round, so white paper is a dark grey and black ink a light one, and its hue
 * and most of its colourfulness kept. The range is held short of black and
 * white, which are hard on the eyes in the dark.
 */
export function darkColour(rgb: Rgb): Rgb {
  const [L, a, b] = toOklab(rgb);
  // Bent a little, so ink comes out brighter than a straight line would put
  // it, and the faint tints of the light page stay apart from the paper.
  const dark = 0.2 + 0.75 * Math.max(0, 1 - L) ** 0.8;
  // Out of gamut, the colour is made greyer until it fits.
  for (let chroma = 1; chroma >= 0; chroma -= 0.05) {
    const linear = toLinearRgb([dark, a * chroma, b * chroma]);
    if (linear.every(c => c >= -0.0005 && c <= 1.0005)) {
      return linear.map(c => fromLinear(Math.min(1, Math.max(0, c)))) as unknown as Rgb;
    }
  }
  const grey = fromLinear(Math.min(1, Math.max(0, toLinearRgb([dark, 0, 0])[0])));
  return [grey, grey, grey];
}

const hex2 = (c: number): string => Math.round(c * 255).toString(16).padStart(2, '0');
const hex = (rgb: Rgb): string => `#${rgb.map(hex2).join('')}`;

/** Parses `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa` into colour and alpha. */
function parseHex(digits: string): { rgb: Rgb; alpha: number } | undefined {
  const full = digits.length <= 4 ? [...digits].map(d => d + d).join('') : digits;
  if (full.length !== 6 && full.length !== 8) return undefined;
  const at = (i: number): number => parseInt(full.slice(i, i + 2), 16) / 255;
  return { rgb: [at(0), at(2), at(4)], alpha: full.length === 8 ? at(6) : 1 };
}

/**
 * Every colour in one declaration's value, turned for the dark screen. A
 * colour that lets something show through — a shadow, a tint over a
 * selection — is kept: it already works on either ground.
 */
export function darkValue(value: string): string {
  // Strings and url(...) are left as they are: `content: "#1"` is not a colour.
  return value.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]*\))|#([0-9a-fA-F]{3,8})\b|\brgba?\(([^)]*)\)|\b(white|black|red|gray|grey|silver)\b/gi,
    (whole, kept: string | undefined, digits: string | undefined, args: string | undefined, name: string | undefined) => {
      if (kept !== undefined) return whole;
      if (digits !== undefined) {
        const parsed = parseHex(digits);
        return parsed && parsed.alpha >= 1 ? hex(darkColour(parsed.rgb)) : whole;
      }
      if (args !== undefined) {
        const parts = args.split(/[\s,/]+/).filter(Boolean);
        if (parts.length < 3) return whole;
        const channel = (raw: string): number => (raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw) / 255);
        const alpha = parts[3] === undefined ? 1
          : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
        const rgb = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)] as const;
        if (rgb.some(Number.isNaN) || !(alpha >= 1)) return whole;
        return hex(darkColour(rgb));
      }
      return hex(darkColour(parseHex(NAMED[name!.toLowerCase()]!.slice(1))!.rgb));
    });
}

// --- Stylesheets ------------------------------------------------------------

interface Rule { readonly selector: string; readonly body: string }
interface AtRule { readonly prelude: string; readonly body: string | undefined }
type Item = Rule | AtRule;

/** Splits a stylesheet into its top-level rules and at-rules. Comments are dropped. */
function items(css: string): Item[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Item[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      i = skipString(text, i);
      continue;
    }
    if (char === ';' && text.slice(start, i).trim().startsWith('@')) {
      found.push({ prelude: text.slice(start, i).trim(), body: undefined });
      start = ++i;
      continue;
    }
    if (char === '{') {
      const head = text.slice(start, i).trim();
      const end = closing(text, i);
      const body = text.slice(i + 1, end);
      found.push(head.startsWith('@') ? { prelude: head, body } : { selector: head, body });
      start = i = end + 1;
      continue;
    }
    i++;
  }
  return found;
}

function skipString(text: string, at: number): number {
  const quote = text[at];
  let i = at + 1;
  while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

/** Where the block opened at `open` closes. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") { i = skipString(text, i) - 1; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return i;
  }
  return text.length;
}

/** Splits on a separator that is not inside brackets or a string. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") { i = skipString(text, i) - 1; continue; }
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Where a selector's trailing pseudo-element starts, so a condition can go before it. */
function pseudoElementAt(selector: string): number {
  const match = /(::?(?:before|after|first-line|first-letter)|::[\w-]+(?:\([^)]*\))?)$/i.exec(selector);
  return match ? match.index : selector.length;
}

interface Scoped { readonly selectors: string[]; readonly restore: boolean }

/**
 * One selector list put under the dark class. A rule on the root or the body
 * is also given back, light, to the page measured for print: that page
 * inherits what they set.
 */
function scope(list: string): Scoped {
  const selectors: string[] = [];
  let restore = false;
  for (const raw of splitTop(list, ',')) {
    const selector = raw.trim();
    // A dark rule is not made dark again: a page that hands over all its
    // sheets may hand over the dark ones too.
    if (!selector || selector.includes(`.${DARK_CLASS}`)) continue;
    const root = /^(:root|html)(?![\w-])/i.exec(selector);
    if (root) {
      const rest = selector.slice(root[0].length);
      selectors.push(`html.${DARK_CLASS}${rest}`);
      if (rest === '') restore = true;
      continue;
    }
    if (/^body(?![\w-])/i.test(selector)) {
      selectors.push(`html.${DARK_CLASS} ${selector}`);
      if (selector.toLowerCase() === 'body') restore = true;
      continue;
    }
    const at = pseudoElementAt(selector);
    selectors.push(`html.${DARK_CLASS} ${selector.slice(0, at)}:not(.${PRINT_CLASS} *)${selector.slice(at)}`);
  }
  return { selectors, restore };
}

/** The declarations of one rule that paint, light and dark. */
function paints(body: string): { light: string[]; dark: string[] } {
  const light: string[] = [];
  const dark: string[] = [];
  for (const raw of splitTop(body, ';')) {
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const property = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    const custom = property.startsWith('--');
    if (!custom && !PAINT.test(property)) continue;
    const turned = darkValue(value);
    // A custom property is copied only when it carries a colour: copying the
    // others would change nothing, and a page full of them is noise.
    if (custom && turned === value) continue;
    light.push(`${property}: ${value}`);
    dark.push(`${property}: ${turned}`);
  }
  return { light, dark };
}

function darkItems(css: string): string[] {
  const out: string[] = [];
  for (const item of items(css)) {
    if ('selector' in item) {
      const { light, dark } = paints(item.body);
      if (dark.length === 0) continue;
      const { selectors, restore } = scope(item.selector);
      if (selectors.length === 0) continue;
      out.push(`${selectors.join(', ')} { ${dark.join('; ')}; }`);
      if (restore) out.push(`html.${DARK_CLASS} .${PRINT_CLASS} { ${light.join('; ')}; }`);
      continue;
    }
    // Rules inside a condition stay inside it. Print is never dark, and the
    // other at-rules (fonts, pages, keyframes) hold nothing on the screen's ground.
    const media = /^@(media|supports|container|layer)\b/i.exec(item.prelude);
    if (!media || item.body === undefined || /^@media\s+print\b/i.test(item.prelude)) continue;
    const inner = darkItems(item.body);
    if (inner.length > 0) out.push(`${item.prelude} {\n${inner.join('\n')}\n}`);
  }
  return out;
}

/**
 * The dark counterpart of a light stylesheet: its painting rules, under
 * `html.dp-dark`, with the colours turned. It does nothing until the class is
 * on the page, so it can be put on the page at once.
 */
export function darkStyle(css: string): string {
  return darkItems(css).join('\n');
}

/**
 * Puts the dark counterpart of a stylesheet on the page under an id, or
 * replaces it. Appended last, so it is read after the light sheets it shadows.
 */
export function useDarkStyle(document: Document, id: string, css: string): void {
  const key = `dp-dark-${id}`;
  let node = document.getElementById(key) as HTMLStyleElement | null;
  if (!node) {
    node = document.createElement('style');
    node.id = key;
    document.head.append(node);
  }
  node.textContent = darkStyle(css);
}

/** Where the screen's light or dark comes from. */
export type ColourSchemeSource =
  /** VS Code's colour theme, which it names in the classes of the WebView's `<body>`. */
  | 'vscode'
  /** The system's setting, as the browser reports it. */
  | 'system';

/** Whether VS Code's theme, as named on `<body>`, is a dark one. */
export function isVscodeDark(classes: DOMTokenList): boolean {
  if (classes.contains('vscode-high-contrast-light')) return false;
  return classes.contains('vscode-dark') || classes.contains('vscode-high-contrast');
}

/**
 * Keeps the page light or dark as its host is, and follows it when that
 * changes. Returns how to stop following.
 */
export function followColourScheme(document: Document, source: ColourSchemeSource): () => void {
  if (!document.getElementById('dp-dark-extra')) {
    const node = document.createElement('style');
    node.id = 'dp-dark-extra';
    node.textContent = EXTRA;
    document.head.append(node);
  }
  const root = document.documentElement;
  const set = (dark: boolean): void => { root.classList.toggle(DARK_CLASS, dark); };
  if (source === 'vscode') {
    const body = document.body;
    set(isVscodeDark(body.classList));
    const observer = new document.defaultView!.MutationObserver(() => set(isVscodeDark(body.classList)));
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }
  const query = document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  if (!query) return () => undefined;
  set(query.matches);
  const changed = (event: MediaQueryListEvent): void => set(event.matches);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}
