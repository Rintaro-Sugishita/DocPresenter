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

/** One picture, drawn on a 24 by 24 grid so they line up with each other. */
export interface StencilPart {
  readonly name: string;
  readonly label: string;
  readonly body: string;
}

const LINE = 'fill="none" stroke="currentColor" stroke-width="1.6" '
  + 'stroke-linejoin="round" stroke-linecap="round"';
const FILL = 'fill="currentColor" opacity="0.12"';

/**
 * Drawn rather than borrowed, so they carry no licence and can be shipped. The
 * shapes are the ones every network drawing uses; anything more particular
 * belongs in a file the author points at.
 */
const PARTS: readonly StencilPart[] = [
  {
    name: 'net/cloud', label: 'クラウド',
    body: `<path d="M6.5 18.5 A4.5 4.5 0 0 1 6.9 9.6 A6 6 0 0 1 18 8.4`
      + ` A4.6 4.6 0 0 1 17.8 18.5 Z" ${FILL}/>`
      + `<path d="M6.5 18.5 A4.5 4.5 0 0 1 6.9 9.6 A6 6 0 0 1 18 8.4`
      + ` A4.6 4.6 0 0 1 17.8 18.5 Z" ${LINE}/>`,
  },
  {
    name: 'net/internet', label: 'インターネット',
    body: `<circle cx="12" cy="12" r="8.5" ${LINE}/>`
      + `<path d="M3.5 12 h17 M12 3.5 a12 12 0 0 1 0 17 a12 12 0 0 1 0 -17" ${LINE}/>`,
  },
  {
    name: 'net/vpn', label: 'VPN',
    body: `<path d="M12 3.5 L20 6.5 v6 c0 4.5 -3.4 7.4 -8 8.5 c-4.6 -1.1 -8 -4 -8 -8.5 v-6 Z" ${FILL}/>`
      + `<path d="M12 3.5 L20 6.5 v6 c0 4.5 -3.4 7.4 -8 8.5 c-4.6 -1.1 -8 -4 -8 -8.5 v-6 Z" ${LINE}/>`
      + `<path d="M9.5 12.5 h5 v4 h-5 Z M10.6 12.5 v-1.8 a1.4 1.4 0 0 1 2.8 0 v1.8" ${LINE}/>`,
  },
  {
    name: 'net/router', label: 'ルータ',
    body: `<rect x="2.5" y="12" width="19" height="7" rx="1.5" ${FILL}/>`
      + `<rect x="2.5" y="12" width="19" height="7" rx="1.5" ${LINE}/>`
      + `<path d="M8 9.5 L8 4.5 M8 4.5 l-2 2 M8 4.5 l2 2 M16 4.5 L16 9.5`
      + ` M16 9.5 l-2 -2 M16 9.5 l2 -2" ${LINE}/>`,
  },
  {
    name: 'net/switch', label: 'スイッチ',
    body: `<rect x="2.5" y="11" width="19" height="8" rx="1.5" ${FILL}/>`
      + `<rect x="2.5" y="11" width="19" height="8" rx="1.5" ${LINE}/>`
      + `<path d="M6.5 8.5 v-3 h11 v3 M9 5.5 l0 3 M15 5.5 l0 3" ${LINE}/>`
      + `<path d="M6 15 h3 M10.5 15 h3 M15 15 h3" ${LINE}/>`,
  },
  {
    name: 'net/firewall', label: 'ファイアウォール',
    body: `<rect x="3" y="6" width="18" height="12" rx="1" ${FILL}/>`
      + `<rect x="3" y="6" width="18" height="12" rx="1" ${LINE}/>`
      + `<path d="M3 10 h18 M3 14 h18 M9 6 v4 M15 10 v4 M9 14 v4" ${LINE}/>`,
  },
  {
    name: 'net/server', label: 'サーバ',
    body: `<rect x="5" y="3.5" width="14" height="17" rx="1.5" ${FILL}/>`
      + `<rect x="5" y="3.5" width="14" height="17" rx="1.5" ${LINE}/>`
      + `<path d="M5 9 h14 M5 14.5 h14 M8 6.2 h2 M8 11.8 h2 M8 17.3 h2" ${LINE}/>`,
  },
  {
    name: 'net/storage', label: 'ストレージ',
    body: `<path d="M4 7 a8 3 0 0 1 16 0 v10 a8 3 0 0 1 -16 0 Z" ${FILL}/>`
      + `<path d="M4 7 a8 3 0 0 1 16 0 v10 a8 3 0 0 1 -16 0 Z" ${LINE}/>`
      + `<path d="M4 7 a8 3 0 0 0 16 0" ${LINE}/>`,
  },
  {
    name: 'net/user', label: '利用者',
    body: `<circle cx="12" cy="8" r="3.8" ${LINE}/>`
      + `<path d="M4.5 20.5 a7.5 7 0 0 1 15 0" ${LINE}/>`,
  },
  {
    name: 'net/mobile', label: '携帯端末',
    body: `<rect x="7" y="3" width="10" height="18" rx="2" ${FILL}/>`
      + `<rect x="7" y="3" width="10" height="18" rx="2" ${LINE}/>`
      + `<path d="M10.5 18.5 h3" ${LINE}/>`,
  },
];

const BY_NAME = new Map(PARTS.map(part => [part.name, part]));

/** Everything the editor can offer, in the order it offers it. */
export function stencilParts(): readonly StencilPart[] {
  return PARTS;
}

/** One part's drawing, on its 24 by 24 grid, or nothing for an unknown name. */
export function stencilArt(name: string): StencilPart | undefined {
  return BY_NAME.get(name);
}

/** True when the value names a file rather than a part shipped with the tool. */
export function isIconPath(value: string): boolean {
  return /\.(svg|png)$/i.test(value);
}
