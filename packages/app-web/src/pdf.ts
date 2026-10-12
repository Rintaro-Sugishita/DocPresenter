// The PDF, made in the reader's browser.
//
// Loaded only when "Download PDF" is pressed: the PDF writer, the font reader
// and the subsetter are most of what is left of the page's weight once Mermaid
// is split off, and most readers only read (viewer.ts imports this lazily).

import type { Locale } from '@docpresenter/base';
import { BUILD_MESSAGES, reviewSourceOf, type Workspace } from '@docpresenter/build';
import { createSubsetter, measure, writePdf, type Subsetter } from '@docpresenter/pdf';
import { localFonts } from './fonts.js';
import { ViewerError, type Fetch } from './hosts/index.js';
import type { Composed } from './view.js';

export interface PdfRequest {
  readonly window: Window;
  readonly composed: Composed;
  readonly workspace: Workspace;
  /** The files the document was built from, for the review map the PDF carries. */
  readonly sources: readonly string[];
  readonly commit: string;
  readonly locale: Locale;
  readonly fetch: Fetch;
  readonly subsetterUrl: string;
  /** Draws what the screen draws after setting the body (Mermaid), flattened for paper. */
  readonly draw: (stage: HTMLElement) => Promise<void>;
}

export interface PdfResult {
  readonly bytes: Uint8Array;
  readonly pages: number;
  /** The faces embedded, for the report. */
  readonly font: string;
  /** Characters the faces have no glyph for. */
  readonly missing: string;
}

let subsetter: Promise<Subsetter> | undefined;

/** Lays the document out in the browser and writes the PDF. */
export async function makePdf(request: PdfRequest): Promise<PdfResult> {
  const { composed, locale } = request;
  const doc = request.window.document;
  const fonts = await localFonts(request.window);
  subsetter ??= request.fetch(request.subsetterUrl)
    .then(response => { if (!response.ok) throw new ViewerError('web.pdf.noSubsetter'); return response.arrayBuffer(); })
    .then(wasm => createSubsetter(new Uint8Array(wasm)))
    .catch(error => { subsetter = undefined; throw error instanceof ViewerError ? error : new ViewerError('web.pdf.noSubsetter', {}, error); });
  const subset = await subsetter;

  const stage = doc.createElement('div');
  stage.style.cssText = 'position:absolute; left:-20000px; top:0; width:800px;';
  try {
    // Laid out in the faces that will be embedded, so the lines break where they will on paper.
    stage.style.setProperty('--font-body', `"${fonts.families.body}"`);
    stage.style.setProperty('--font-heading', `"${fonts.families.body}"`);
    stage.style.setProperty('--font-mono', `"${fonts.families.mono}"`);
    stage.style.fontFamily = 'var(--font-body)';
    stage.innerHTML = composed.body;
    doc.body.append(stage);
    await request.draw(stage);
    await Promise.all([...stage.querySelectorAll('img')].map(image => image.decode().catch(() => undefined)));

    const raw = composed.prepared.document.frontmatter.raw;
    const version = raw['version']
      ? BUILD_MESSAGES.in(locale)('build.foot.version', { version: String(raw['version']) }) : '';
    const foot = [raw['document'], version].filter(value => value !== undefined && value !== '').map(String).join('　');
    const measured = measure(stage, { foot, title: String(raw['title'] ?? ''), locale });
    // The review so far rides in the PDF, as it does from the extension.
    const review = reviewSourceOf({
      workspace: request.workspace, prepared: composed.prepared, style: composed.style, out: '', diagnostics: [],
      sources: request.sources,
      root: { path: composed.root, document: composed.prepared.document, formats: ['pdf'] },
      options: { commit: request.commit, clean: true },
    });
    const { bytes, missing } = await writePdf(measured.plan, { fonts: fonts.set, subset, review });
    return {
      bytes, pages: measured.plan.pages.length, font: fonts.name,
      missing: [...new Set(missing.map(one => one.character))].join(''),
    };
  } finally {
    stage.remove();
  }
}
