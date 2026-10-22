// The PDF writer and the Mermaid painter: the two writers that need a browser.
//
// The build knows nothing about browsers: it hands a prepared document to a
// writer and takes back bytes. This one opens the same page the HTML is,
// lets Chromium lay it out, reads the result as a page plan and writes the PDF
// from that (design/pdf-engine.md §6) — what tools/pdf-writer.mjs does, with
// the measuring script and the subsetter carried as files beside the command
// instead of bundled on the spot.

import { readFileSync } from 'node:fs';
import { BUILD_MESSAGES, renderPage, reviewSourceOf, type Artifact, type WriteInput } from '@docpresenter/build';
import { assetFile, findChromium } from '@docpresenter/dgm';
import { createSubsetter, writePdf, type FontSet } from '@docpresenter/pdf';
import { chromium, type Browser } from 'playwright-core';

/** A file the command carries, or a refusal to go on without it. */
export function asset(name: string, from: string): string {
  const path = assetFile(name, from);
  if (path === undefined) throw new Error(`${name} is missing beside the command; run npm run build:cli`);
  return path;
}

export interface PdfReport {
  readonly pages: number;
  readonly font: string;
  readonly missing: number;
  readonly notes: readonly string[];
}

export interface PdfWriter {
  write(input: WriteInput): Promise<Artifact>;
  readonly reports: ReadonlyMap<string, PdfReport>;
  close(): Promise<void>;
}

export async function openPdfWriter(options: {
  readonly from: string;
  readonly chromium?: string | undefined;
  readonly fonts: { readonly set: FontSet; readonly name: string };
  readonly mermaidScript?: string | undefined;
}): Promise<PdfWriter> {
  const measure = readFileSync(asset('measure.js', options.from), 'utf8');
  const subset = await createSubsetter(readFileSync(asset('harfbuzz-subset.wasm', options.from)));
  const browser = await chromium.launch({ executablePath: findChromium(options.chromium) });
  const reports = new Map<string, PdfReport>();

  const write = async (input: WriteInput): Promise<Artifact> => {
    const html = renderPage({
      workspace: input.workspace,
      document: input.prepared.document,
      resolved: input.prepared.resolved,
      style: input.style,
      root: input.root.path,
      // The diff marks are class names; the measured page carries their colours.
      ...(input.marks ? { marks: input.marks } : {}),
      ...(input.options.commit ? { commit: input.options.commit } : {}),
      ...(options.mermaidScript ? { mermaidScript: options.mermaidScript } : {}),
    });

    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let measured: { plan: Parameters<typeof writePdf>[0]; diagnostics: string[] };
    try {
      await page.setContent(html, { waitUntil: 'load' });
      // The page draws its Mermaid blocks itself; measuring before it is done
      // would leave a blank where each drawing goes.
      await page.waitForFunction(() => !document.querySelector('.dp-mermaid')
        || document.documentElement.dataset['dpMermaid'] === 'done', undefined, { timeout: 60000 });
      await page.evaluate(() => (window as { __dpMermaid?: { flatten(d: Document): void } }).__dpMermaid?.flatten(document));
      await page.addScriptTag({ content: measure });

      const raw = input.root.document.frontmatter.raw;
      const title = String(raw['title'] ?? '');
      const number = String(raw['document'] ?? '');
      const version = String(raw['version'] ?? '');
      const { locale } = input.prepared.resolved;
      const versioned = version && BUILD_MESSAGES.in(locale)('build.foot.version', { version });
      measured = await page.evaluate(
        ([foot, name, commit, language]) =>
          (window as unknown as { __dpMeasure(body: HTMLElement, options: object): typeof measured })
            .__dpMeasure(document.body, { foot, title: name, commit, locale: language }),
        [[number, title, versioned].filter(Boolean).join('　'), title, input.options.commit ?? '', locale] as const,
      );
    } finally {
      await page.close();
    }
    if (errors.length) throw new Error(errors.join(' / '));

    const { bytes, missing } = await writePdf(measured.plan, {
      fonts: options.fonts.set, subset, review: reviewSourceOf(input),
    });
    const path = `${input.out}.pdf`;
    reports.set(input.root.path, {
      pages: measured.plan.pages.length, font: options.fonts.name, missing: missing.length,
      notes: [...measured.diagnostics, ...missing.map(one => one.character)],
    });
    return { path, bytes, root: input.root.path, format: 'pdf' };
  };

  return { write, reports, close: () => browser.close() };
}

/**
 * Draws Mermaid sources as PNGs for slides, in a browser of its own. One page
 * is reused for every drawing: each is a few hundred milliseconds.
 */
export async function openMermaidPainter(chromiumPath: string | undefined, script: string): Promise<{
  picture(source: string): Promise<{ data: string; width: number; height: number } | undefined>;
  close(): Promise<void>;
}> {
  const browser: Browser = await chromium.launch({ executablePath: findChromium(chromiumPath) });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => (window as { __dpMermaid?: unknown }).__dpMermaid !== undefined, undefined, { timeout: 60000 });
  return {
    picture: source => page.evaluate(text =>
      (window as unknown as { __dpMermaid: { picture(t: string): Promise<{ data: string; width: number; height: number } | undefined> } })
        .__dpMermaid.picture(text), source),
    close: () => browser.close(),
  };
}
