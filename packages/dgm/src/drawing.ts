// A drawing file as a picture: its SVG, and its PNG drawn from that.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Locale } from '@docpresenter/base';
import {
  parseDiagram, renderDiagram, renderOverlay, standaloneSvg, withParts, type DiagramFile,
} from '@docpresenter/diagram';
import { chromium, type Browser } from 'playwright-core';
import { findChromium } from './chromium.js';

/** The drawing in a file, its parts read from the files it `use`s. */
export function readDrawing(file: string): DiagramFile {
  const source = readFileSync(file, 'utf8');
  return withParts(parseDiagram(source), used => readText(resolve(dirname(file), used)));
}

/**
 * The drawing as an SVG file of its own: the theme's drawing rules inside it,
 * and the pictures its parts point at by path embedded, so it looks the same
 * wherever it is opened — the export VS Code makes, from the command line.
 */
export function svgOf(file: string, drawing: DiagramFile, theme: string, locale: Locale): string {
  return standaloneSvg(renderDiagram(drawing, picturesOf(file, drawing), undefined, locale), theme);
}

/** The `icon:` pictures given by path, as data URLs. One that cannot be read is drawn as its name. */
function picturesOf(file: string, drawing: DiagramFile): (path: string) => string {
  const found = new Map<string, string>();
  for (const rule of drawing.style.values()) {
    const icon = rule.get('icon');
    if (icon === undefined || !/\.(svg|png)$/i.test(icon) || found.has(icon)) continue;
    try {
      const bytes = readFileSync(resolve(dirname(file), icon));
      const type = /\.svg$/i.test(icon) ? 'image/svg+xml' : 'image/png';
      found.set(icon, `data:${type};base64,${bytes.toString('base64')}`);
    } catch { /* 読めない絵は名前で描かれる */ }
  }
  return path => found.get(path) ?? path;
}

function readText(path: string): string | undefined {
  try { return readFileSync(path, 'utf8'); } catch { return undefined; }
}

const MEDIA: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

/** A picture file as a data URL; undefined when it cannot be read, and the overlay says so. */
function dataUrlOf(path: string): string | undefined {
  const type = MEDIA[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];
  if (type === undefined) return undefined;
  try { return `data:${type};base64,${readFileSync(path).toString('base64')}`; } catch { return undefined; }
}

export interface PngOptions {
  /** Pixels per unit of the drawing. */
  readonly scale: number;
  /** A CSS colour, or `transparent`. */
  readonly background: string;
}

/**
 * Draws SVGs as PNGs, in one browser opened on first use and kept for the
 * rest of the run. Closed by the caller.
 */
export class Painter {
  private browser: Browser | undefined;

  constructor(private readonly chromiumPath: string | undefined) {}

  /** An SVG file (`svgOf`) as a PNG. */
  png(svg: string, options: PngOptions): Promise<Uint8Array> {
    return this.shoot(svg.replace(/^<\?xml[^>]*>\s*/, ''), '', 'svg', options);
  }

  /**
   * An overlay — a screenshot with numbered callouts — as a PNG. It is HTML
   * rather than SVG (the picture keeps its own pixels), so it is drawn with the
   * whole theme, the callouts' legend included.
   */
  overlayPng(file: string, drawing: DiagramFile, theme: string, locale: Locale, options: PngOptions): Promise<Uint8Array> {
    const image = drawing.image === undefined ? undefined : dataUrlOf(resolve(dirname(file), drawing.image));
    return this.shoot(`<div class="dp-shot">${renderOverlay(drawing, image, locale)}</div>`,
      `${theme}\n.dp-shot{display:inline-block;padding:8px}`, '.dp-shot', options);
  }

  private async shoot(body: string, css: string, selector: string, options: PngOptions): Promise<Uint8Array> {
    this.browser ??= await chromium.launch({ executablePath: findChromium(this.chromiumPath) });
    const page = await this.browser.newPage({ deviceScaleFactor: options.scale });
    try {
      const transparent = options.background === 'transparent';
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}\n`
        + `html,body{margin:0;padding:0;background:${transparent ? 'transparent' : options.background}}`
        + `svg{display:block}</style></head><body>${body}</body></html>`, { waitUntil: 'load' });
      return await page.locator(selector).first().screenshot({ type: 'png', omitBackground: transparent });
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }
}
