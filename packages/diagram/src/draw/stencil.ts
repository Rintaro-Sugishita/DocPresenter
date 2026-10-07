// The parts library: pictures a drawing points at by name.
//
// These are not shapes. A shape is one of the dozen forms every drawing uses,
// each with a notation of its own and a DrawingML preset behind it; a part is
// a picture of a particular thing, and there are hundreds of those. Mixing
// them would put "router" next to "rectangle" in the same list, and the list
// would never stop growing.
//
// Only a small, generic network set is built in. Vendor icon sets (AWS, Azure,
// GCP, Cisco) are not: they are large, they are licensed, and their owners
// publish them. A drawing reaches those with a path — `icon: ./icons/ec2.svg`.

import { DEFAULT_LOCALE, say, type Locale } from '@docpresenter/base';
import '../messages.js';

/** One picture, drawn on a 24 by 24 grid so they line up with each other. */
export interface StencilPart {
  readonly name: string;
  /** What the menu calls it, in the locale it was asked for. */
  readonly label: string;
  readonly body: string;
  /**
   * Drawn to fill the box rather than centred square in it.
   *
   * A router is a thing of a certain shape and is drawn square whatever box it
   * is in. A scrollbar is not: it is as long as the list beside it, and a
   * square scrollbar is not a scrollbar. Those declare the grid they were drawn
   * on and are stretched onto the box.
   */
  readonly fit?: { readonly width: number; readonly height: number };
  /**
   * Where the shape's text goes.
   *
   * - `under` — a caption below the picture. A router is a thing with a name
   *   written under it, and that is the default for a picture drawn square.
   * - `inside` — in the picture, as in any other shape. A drop-down holds the
   *   value chosen; the words are part of the control, not a caption for it.
   * - `none` — it holds no text at all. A scrollbar has nothing to say.
   */
  readonly holds?: 'under' | 'inside' | 'none';
  /**
   * What this picture is one of, for the menu that offers it.
   *
   * The name's prefix already says it — `net/router`, `ui/slider` — but a
   * prefix is for the file and a heading is for a person, and the two want
   * different words. In the locale it was asked for, like the label.
   */
  readonly group: string;
}

/** A picture as written here: named, and filed under a kind, but not yet in words. */
type Drawn = Omit<StencilPart, 'label' | 'group'> & { readonly group: 'network' | 'ui' };

function inWords(part: Drawn, locale: Locale): StencilPart {
  return {
    ...part,
    label: say(locale, { id: `diagram.stencil.${part.name}` }),
    group: say(locale, { id: `diagram.stencil.group.${part.group}` }),
  };
}

/** Where a picture puts the text of the shape it draws. */
export function textPlace(icon: string | undefined): 'under' | 'inside' | 'none' {
  if (icon === undefined) return 'inside';
  const art = stencilArt(icon);
  // A file the author pointed at is a picture with a caption under it, which is
  // what every part did before controls existed.
  if (!art) return 'under';
  return art.holds ?? (art.fit ? 'inside' : 'under');
}

const LINE = 'fill="none" stroke="currentColor" stroke-width="1.6" '
  + 'stroke-linejoin="round" stroke-linecap="round"';
const FILL = 'fill="currentColor" opacity="0.12"';

/**
 * Drawn rather than borrowed, so they carry no licence and can be shipped. The
 * shapes are the ones every network drawing uses; anything more particular
 * belongs in a file the author points at.
 */
const PARTS: readonly Drawn[] = [
  {
    name: 'net/cloud',
    group: 'network',
    body: `<path d="M6.5 18.5 A4.5 4.5 0 0 1 6.9 9.6 A6 6 0 0 1 18 8.4`
      + ` A4.6 4.6 0 0 1 17.8 18.5 Z" ${FILL}/>`
      + `<path d="M6.5 18.5 A4.5 4.5 0 0 1 6.9 9.6 A6 6 0 0 1 18 8.4`
      + ` A4.6 4.6 0 0 1 17.8 18.5 Z" ${LINE}/>`,
  },
  {
    name: 'net/internet',
    group: 'network',
    body: `<circle cx="12" cy="12" r="8.5" ${LINE}/>`
      + `<path d="M3.5 12 h17 M12 3.5 a12 12 0 0 1 0 17 a12 12 0 0 1 0 -17" ${LINE}/>`,
  },
  {
    name: 'net/vpn',
    group: 'network',
    body: `<path d="M12 3.5 L20 6.5 v6 c0 4.5 -3.4 7.4 -8 8.5 c-4.6 -1.1 -8 -4 -8 -8.5 v-6 Z" ${FILL}/>`
      + `<path d="M12 3.5 L20 6.5 v6 c0 4.5 -3.4 7.4 -8 8.5 c-4.6 -1.1 -8 -4 -8 -8.5 v-6 Z" ${LINE}/>`
      + `<path d="M9.5 12.5 h5 v4 h-5 Z M10.6 12.5 v-1.8 a1.4 1.4 0 0 1 2.8 0 v1.8" ${LINE}/>`,
  },
  {
    name: 'net/router',
    group: 'network',
    body: `<rect x="2.5" y="12" width="19" height="7" rx="1.5" ${FILL}/>`
      + `<rect x="2.5" y="12" width="19" height="7" rx="1.5" ${LINE}/>`
      + `<path d="M8 9.5 L8 4.5 M8 4.5 l-2 2 M8 4.5 l2 2 M16 4.5 L16 9.5`
      + ` M16 9.5 l-2 -2 M16 9.5 l2 -2" ${LINE}/>`,
  },
  {
    name: 'net/switch',
    group: 'network',
    body: `<rect x="2.5" y="11" width="19" height="8" rx="1.5" ${FILL}/>`
      + `<rect x="2.5" y="11" width="19" height="8" rx="1.5" ${LINE}/>`
      + `<path d="M6.5 8.5 v-3 h11 v3 M9 5.5 l0 3 M15 5.5 l0 3" ${LINE}/>`
      + `<path d="M6 15 h3 M10.5 15 h3 M15 15 h3" ${LINE}/>`,
  },
  {
    name: 'net/firewall',
    group: 'network',
    body: `<rect x="3" y="6" width="18" height="12" rx="1" ${FILL}/>`
      + `<rect x="3" y="6" width="18" height="12" rx="1" ${LINE}/>`
      + `<path d="M3 10 h18 M3 14 h18 M9 6 v4 M15 10 v4 M9 14 v4" ${LINE}/>`,
  },
  {
    name: 'net/server',
    group: 'network',
    body: `<rect x="5" y="3.5" width="14" height="17" rx="1.5" ${FILL}/>`
      + `<rect x="5" y="3.5" width="14" height="17" rx="1.5" ${LINE}/>`
      + `<path d="M5 9 h14 M5 14.5 h14 M8 6.2 h2 M8 11.8 h2 M8 17.3 h2" ${LINE}/>`,
  },
  {
    name: 'net/storage',
    group: 'network',
    body: `<path d="M4 7 a8 3 0 0 1 16 0 v10 a8 3 0 0 1 -16 0 Z" ${FILL}/>`
      + `<path d="M4 7 a8 3 0 0 1 16 0 v10 a8 3 0 0 1 -16 0 Z" ${LINE}/>`
      + `<path d="M4 7 a8 3 0 0 0 16 0" ${LINE}/>`,
  },
  {
    name: 'net/user',
    group: 'network',
    body: `<circle cx="12" cy="8" r="3.8" ${LINE}/>`
      + `<path d="M4.5 20.5 a7.5 7 0 0 1 15 0" ${LINE}/>`,
  },
  {
    name: 'net/mobile',
    group: 'network',
    body: `<rect x="7" y="3" width="10" height="18" rx="2" ${FILL}/>`
      + `<rect x="7" y="3" width="10" height="18" rx="2" ${LINE}/>`
      + `<path d="M10.5 18.5 h3" ${LINE}/>`,
  },
];


// --- 画面部品の絵 -----------------------------------------------------------
//
// A screen's controls are pictures too, and pictures is what this file is for.
// They are kept apart from the network set by their names: a drawing asks for
// `ui/radio-on` the way it asks for `net/router`.
//
// Why these are pictures and not shapes: a radio button is a circle with a dot
// in it, a slider is a line with a knob on it. Neither is one of the dozen
// forms the notation has a bracket pair for, and neither is worth inventing a
// bracket pair for — there are hundreds of controls and the list never stops.

const UI_LINE = 'fill="none" stroke="#8b929c" stroke-width="1.3" '
  + 'stroke-linejoin="round" stroke-linecap="round"';
const UI_FACE = 'fill="#ffffff" stroke="#aeb4bd" stroke-width="1.3"';
const UI_MARK = '#2f6fb5';

const CONTROLS: readonly Drawn[] = [
  {
    name: 'ui/radio',
    group: 'ui',
    holds: 'none',
    body: `<circle cx="12" cy="12" r="8" ${UI_FACE}/>`,
  },
  {
    name: 'ui/radio-on',
    group: 'ui',
    holds: 'none',
    body: `<circle cx="12" cy="12" r="8" ${UI_FACE}/>`
      + `<circle cx="12" cy="12" r="4" fill="${UI_MARK}"/>`,
  },
  {
    name: 'ui/check',
    group: 'ui',
    holds: 'none',
    body: `<rect x="4" y="4" width="16" height="16" rx="2" ${UI_FACE}/>`,
  },
  {
    name: 'ui/check-on',
    group: 'ui',
    holds: 'none',
    body: `<rect x="4" y="4" width="16" height="16" rx="2" fill="${UI_MARK}" stroke="${UI_MARK}"/>`
      + `<path d="M7.5 12.5 l3 3 l6 -6" fill="none" stroke="#ffffff" stroke-width="2"`
      + ` stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    // Drawn wide: a drop-down is a box with a chevron at its right end, and the
    // chevron must stay at the end however wide the box is.
    name: 'ui/select',
    group: 'ui',
    holds: 'inside',
    fit: { width: 160, height: 34 },
    body: `<rect x="0.7" y="0.7" width="158.6" height="32.6" rx="3" fill="#fbfbfc"`
      + ` stroke="#aeb4bd" stroke-width="1.3"/>`
      + `<path d="M143 14 l5 5 l5 -5" ${UI_LINE}/>`,
  },
  {
    name: 'ui/spinner',
    group: 'ui',
    holds: 'inside',
    fit: { width: 120, height: 34 },
    body: `<rect x="0.7" y="0.7" width="118.6" height="32.6" rx="3" fill="#fbfbfc"`
      + ` stroke="#aeb4bd" stroke-width="1.3"/>`
      + `<path d="M100.7 0.7 v32.6" stroke="#aeb4bd" stroke-width="1.3"/>`
      + `<path d="M100.7 17 h18.6" stroke="#aeb4bd" stroke-width="1.3"/>`
      + `<path d="M106.5 12.5 l3.7 -3.4 l3.7 3.4" ${UI_LINE}/>`
      + `<path d="M106.5 21.5 l3.7 3.4 l3.7 -3.4" ${UI_LINE}/>`,
  },
  {
    name: 'ui/scrollbar-v',
    group: 'ui',
    holds: 'none',
    fit: { width: 12, height: 120 },
    body: `<rect x="0" y="0" width="12" height="120" fill="#f0f1f3"/>`
      + `<rect x="2.5" y="8" width="7" height="46" rx="3.5" fill="#aeb4bd"/>`
      + `<path d="M3.6 4.4 l2.4 -2.4 l2.4 2.4" ${UI_LINE}/>`
      + `<path d="M3.6 115.6 l2.4 2.4 l2.4 -2.4" ${UI_LINE}/>`,
  },
  {
    name: 'ui/scrollbar-h',
    group: 'ui',
    holds: 'none',
    fit: { width: 120, height: 12 },
    body: `<rect x="0" y="0" width="120" height="12" fill="#f0f1f3"/>`
      + `<rect x="8" y="2.5" width="46" height="7" rx="3.5" fill="#aeb4bd"/>`
      + `<path d="M4.4 3.6 l-2.4 2.4 l2.4 2.4" ${UI_LINE}/>`
      + `<path d="M115.6 3.6 l2.4 2.4 l-2.4 2.4" ${UI_LINE}/>`,
  },
  {
    name: 'ui/slider',
    group: 'ui',
    holds: 'none',
    fit: { width: 160, height: 24 },
    body: `<path d="M4 12 h152" stroke="#d3d7dd" stroke-width="4" stroke-linecap="round"/>`
      + `<path d="M4 12 h58" stroke="${UI_MARK}" stroke-width="4" stroke-linecap="round"/>`
      + `<circle cx="62" cy="12" r="7" fill="#ffffff" stroke="${UI_MARK}" stroke-width="2"/>`,
  },
  // The three whose picture is their own contents. The artwork here is what
  // the menu shows and what a part with no rows falls back to; the real
  // drawing is worked out from the rows (draw/listing.ts).
  {
    name: 'ui/tree',
    group: 'ui',
    fit: { width: 160, height: 120 },
    holds: 'none',
    body: `<rect x="0.7" y="0.7" width="158.6" height="118.6" ${UI_FACE}/>`
      + `<path d="M10 14 l5 5 l-5 5" ${UI_LINE}/>`
      + `<path d="M26 19 h60 M38 43 h48 M38 67 h54 M26 91 h50" stroke="#c8ccd2"`
      + ` stroke-width="3" stroke-linecap="round"/>`
      + `<path d="M22 38 l5 5 l5 -5" ${UI_LINE}/>`,
  },
  {
    name: 'ui/list',
    group: 'ui',
    fit: { width: 160, height: 100 },
    holds: 'none',
    body: `<rect x="0.7" y="0.7" width="158.6" height="98.6" ${UI_FACE}/>`
      + `<rect x="3" y="26" width="153" height="22" fill="#dce6f2"/>`
      + `<path d="M12 15 h70 M12 37 h86 M12 59 h60 M12 81 h78" stroke="#c8ccd2"`
      + ` stroke-width="3" stroke-linecap="round"/>`,
  },
  {
    name: 'ui/menu',
    group: 'ui',
    fit: { width: 240, height: 28 },
    holds: 'none',
    body: `<rect x="0.7" y="0.7" width="238.6" height="26.6" ${UI_FACE}/>`
      + `<rect x="4" y="3" width="56" height="22" rx="2" fill="#dce6f2"/>`
      + `<path d="M16 14 h32 M76 14 h28 M120 14 h36" stroke="#8b929c"`
      + ` stroke-width="3" stroke-linecap="round"/>`,
  },
  {
    // A table is the one control that is a thing of a certain size: how many
    // rows and columns it has is a property of the screen, not of the picture.
    // Drawn with a header and a few rows, stretched, it reads as "a table goes
    // here" — which is what a screen mock-up is saying.
    name: 'ui/grid',
    group: 'ui',
    fit: { width: 240, height: 120 },
    holds: 'none',
    body: `<rect x="0.7" y="0.7" width="238.6" height="118.6" fill="#ffffff"`
      + ` stroke="#aeb4bd" stroke-width="1.3"/>`
      + `<rect x="0.7" y="0.7" width="238.6" height="24" fill="#eef0f3"`
      + ` stroke="#aeb4bd" stroke-width="1.3"/>`
      + `<path d="M0.7 48.7 h238.6 M0.7 72.7 h238.6 M0.7 96.7 h238.6"`
      + ` stroke="#d3d7dd" stroke-width="1"/>`
      + `<path d="M80.7 0.7 v118.6 M160.7 0.7 v118.6" stroke="#d3d7dd" stroke-width="1"/>`
      + `<path d="M12 12.7 h40 M92 12.7 h40 M172 12.7 h40" stroke="#8b929c" stroke-width="3"`
      + ` stroke-linecap="round"/>`
      + `<path d="M12 36.7 h52 M92 36.7 h36 M172 36.7 h44" stroke="#c8ccd2" stroke-width="3"`
      + ` stroke-linecap="round"/>`
      + `<path d="M12 60.7 h44 M92 60.7 h48 M172 60.7 h32" stroke="#c8ccd2" stroke-width="3"`
      + ` stroke-linecap="round"/>`
      + `<path d="M12 84.7 h56 M92 84.7 h30 M172 84.7 h50" stroke="#c8ccd2" stroke-width="3"`
      + ` stroke-linecap="round"/>`
      + `<path d="M12 108.7 h38 M92 108.7 h44 M172 108.7 h36" stroke="#c8ccd2" stroke-width="3"`
      + ` stroke-linecap="round"/>`,
  },
  {
    name: 'ui/image',
    group: 'ui',
    holds: 'none',
    fit: { width: 120, height: 90 },
    body: `<rect x="0.7" y="0.7" width="118.6" height="88.6" fill="#f4f5f7"`
      + ` stroke="#aeb4bd" stroke-width="1.3"/>`
      + `<path d="M12 68 l24 -28 l20 22 l14 -14 l30 32 z" fill="#c8ccd2"/>`
      + `<circle cx="86" cy="26" r="8" fill="#c8ccd2"/>`,
  },
];

const BY_NAME = new Map([...PARTS, ...CONTROLS].map(part => [part.name, inWords(part, DEFAULT_LOCALE)]));

/** Everything the editor can offer, in the order it offers it. */
export function stencilParts(locale: Locale = DEFAULT_LOCALE): readonly StencilPart[] {
  return [...PARTS, ...CONTROLS].map(part => inWords(part, locale));
}

/** One part's drawing, on its 24 by 24 grid, or nothing for an unknown name. */
export function stencilArt(name: string): StencilPart | undefined {
  return BY_NAME.get(name);
}

/** True when the value names a file rather than a part shipped with the tool. */
export function isIconPath(value: string): boolean {
  return /\.(svg|png)$/i.test(value);
}
