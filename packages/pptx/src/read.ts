// Reading a deck back.
//
// The general problem — understanding any .pptx — is hard. This is the narrow
// one: understanding a deck we wrote ourselves, which is a different problem
// because every shape carries the id of the node it came from and the slide
// records where the drawing was put. What comes back is where each shape now
// sits, in the drawing's own coordinates, and what its label now says.
//
// That covers the edits people actually make in PowerPoint: moving a box,
// resizing it, retyping a label (design/pptx-model.md §8.1). Anything else —
// a new shape, an effect, a colour picked from PowerPoint's palette — is not
// read, and is reported rather than quietly lost.

import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import { PPTX_MESSAGES } from './messages.js';

export interface ReadShape {
  readonly id: string;
  /** In the drawing's own pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The label as plain text; the marks it was written with are not in a slide. */
  readonly text: string;
}

export interface ReadDrawing {
  /** The `.dgm` this slide was made from. */
  readonly source: string;
  readonly slide: number;
  readonly shapes: readonly ReadShape[];
  /** Shapes on the slide that carry no id: added in PowerPoint, or ours. */
  readonly unknown: readonly string[];
}

export interface ReadResult {
  readonly drawings: readonly ReadDrawing[];
  readonly diagnostics: readonly string[];
}

const MARK = /dp:drawing=([^;]*);scale=([\d.]+);x=(-?\d+);y=(-?\d+)/;

export function readDrawings(bytes: Uint8Array, locale: Locale = DEFAULT_LOCALE): ReadResult {
  const files = unzipSync(bytes);
  const diagnostics: string[] = [];
  const drawings: ReadDrawing[] = [];

  const slides = Object.keys(files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => number(a) - number(b));

  for (const name of slides) {
    const xml = strFromU8(files[name]!);
    const index = number(name);
    const marked = MARK.exec(nameOf(xml) ?? '');
    const hasShapes = /<p:sp>/.test(xml);
    if (!marked) {
      if (hasShapes && /prstGeom prst="(?!rect)/.test(xml)) {
        diagnostics.push(PPTX_MESSAGES.in(locale)('pptx.unnamed', { index }));
      }
      continue;
    }
    const [, source, scaleText, xText, yText] = marked;
    const scale = Number(scaleText);
    const originX = Number(xText);
    const originY = Number(yText);

    const shapes: ReadShape[] = [];
    const unknown: string[] = [];
    // Each shape up to its own end: what follows it on the slide — a table, a
    // picture, the next text box — is not part of it, and its text is not the
    // shape's label.
    for (const [shape] of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
      const id = attribute(shape, 'p:cNvPr', 'name');
      const frame = xfrmOf(shape);
      if (!frame) continue;
      // Our own text boxes are named `text 7`; the drawing's shapes are named
      // after the node they came from.
      if (id === undefined || /^(text|line|picture|table) \d+$/.test(id)) {
        if (id !== undefined && !/^(text|line|picture|table) \d+$/.test(id)) unknown.push(id);
        continue;
      }
      shapes.push({
        id,
        x: round((frame.x - originX) / scale),
        y: round((frame.y - originY) / scale),
        width: round(frame.cx / scale),
        height: round(frame.cy / scale),
        text: textOf(shape),
      });
    }
    drawings.push({ source: source ?? '', slide: index, shapes, unknown });
  }

  return { drawings, diagnostics };
}

function number(path: string): number {
  return Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

function nameOf(xml: string): string | undefined {
  return /<p:cSld[^>]*\sname="([^"]*)"/.exec(xml)?.[1];
}

function attribute(xml: string, element: string, name: string): string | undefined {
  const found = new RegExp(`<${element}[^>]*\\s${name}="([^"]*)"`).exec(xml);
  return found?.[1];
}

function xfrmOf(xml: string): { x: number; y: number; cx: number; cy: number } | undefined {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(xml);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(xml);
  if (!off || !ext) return undefined;
  return { x: Number(off[1]), y: Number(off[2]), cx: Number(ext[1]), cy: Number(ext[2]) };
}

/** The text of a shape, paragraphs joined the way a label holds them. */
function textOf(xml: string): string {
  const body = xml.slice(xml.indexOf('<p:txBody>'));
  return [...body.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
    .map(found => unescapeXml(found[1] ?? ''))
    .join('');
}

function unescapeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function round(value: number): number {
  return Math.round(value);
}
