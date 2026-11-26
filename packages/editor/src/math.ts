// Formulas as pictures, in the page.
//
// KaTeX draws a formula as HTML in its own fonts. The screen and the HTML a
// reader is handed show that as it is; the PDF writer and a slide cannot —
// the PDF writer sets text in the document's fonts, and PowerPoint has no
// KaTeX — so for them a formula is laid down as a picture of itself, the way
// a Mermaid drawing is. The picture is taken from an SVG image holding the
// formula's HTML and KaTeX's stylesheet, fonts and all, so nothing has to be
// fetched while it is drawn.

import { LocalizedError } from '@docpresenter/base';
import { KATEX_STYLE, MATH_RULES, renderMath } from '@docpresenter/markdown';
import { EDITOR_MESSAGES } from './messages.js';

const STYLE_ID = 'dp-math-style';

/** Puts KaTeX's stylesheet on the page, once. */
export function injectMathStyle(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${KATEX_STYLE}\n${MATH_RULES}`;
  document.head.append(style);
}

/** A formula as a PNG, and its size in CSS pixels. */
export interface MathPicture {
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

/** The formula drawn in `host` (a `.dp-math`), as a picture of what is on screen. */
export async function mathImage(host: HTMLElement, scale = 3): Promise<MathPicture> {
  const document = host.ownerDocument;
  injectMathStyle(document);
  const target = host.querySelector<HTMLElement>('.katex') ?? host;
  const rect = target.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width) + 2);
  const height = Math.max(1, Math.ceil(rect.height) + 2);
  // The size of what the formula sits in: KaTeX scales itself from there, and
  // taking its own size would scale it twice.
  const look = document.defaultView?.getComputedStyle(target.parentElement ?? target);
  const markup = new XMLSerializer().serializeToString(target);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + '<foreignObject x="0" y="0" width="100%" height="100%">'
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${look?.fontSize ?? '16px'};color:${look?.color ?? '#1c1f24'};`
    + 'margin:0;padding:1px;line-height:normal;white-space:nowrap">'
    + `<style><![CDATA[${KATEX_STYLE}]]></style>${markup}</div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  // The fonts inside the image arrive a moment after it does.
  await new Promise(done => setTimeout(done, 30));
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new LocalizedError(EDITOR_MESSAGES.phrase('editor.mermaid.noCanvas'));
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/png'), width, height };
}

/** A formula written in TeX, as a picture — for a slide, where nothing of it is on screen. */
export async function mathPicture(tex: string, scale = 3): Promise<MathPicture> {
  const document = globalThis.document;
  injectMathStyle(document);
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute; left:-20000px; top:0; font-size:28px; color:#1c1f24;';
  stage.innerHTML = renderMath(tex, true);
  document.body.append(stage);
  try {
    await document.fonts?.ready;
    const host = stage.querySelector<HTMLElement>('.dp-math')!;
    return await mathImage(host, scale);
  } finally {
    stage.remove();
  }
}

/**
 * Replaces every formula under `root` with a picture of itself, the same size
 * and on the same baseline. For the PDF, which sets its text in the
 * document's own fonts and has none of KaTeX's.
 */
export async function flattenMath(root: ParentNode, scale = 3): Promise<void> {
  const hosts = [...root.querySelectorAll<HTMLElement>('.dp-math')];
  if (hosts.length === 0) return;
  const document = hosts[0]!.ownerDocument;
  injectMathStyle(document);
  await document.fonts?.ready;
  for (const host of hosts) {
    const target = host.querySelector<HTMLElement>('.katex');
    if (!target) continue;
    // Where the baseline is: an empty inline block sits on it.
    const mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:0;';
    target.after(mark);
    const baseline = mark.getBoundingClientRect().bottom;
    mark.remove();
    const rect = target.getBoundingClientRect();
    const picture = await mathImage(host, scale);
    const image = document.createElement('img');
    image.src = picture.data;
    image.alt = host.dataset['tex'] ?? '';
    image.className = 'dp-math-picture';
    image.style.width = `${picture.width}px`;
    image.style.height = `${picture.height}px`;
    image.style.verticalAlign = `${-(rect.bottom + 1 - baseline)}px`;
    target.replaceWith(image);
    await image.decode().catch(() => undefined);
  }
}
