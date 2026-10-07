// Mermaid, drawn in the page.
//
// The renderer leaves a Mermaid block as its source (markdown/src/html/
// markdown.ts) because it also runs in Node, where there is nothing to lay a
// drawing out with. Whatever shows the page — the editor, a delivered HTML
// file, the browser that lays a PDF out — calls this to turn the source into a
// drawing. A block that cannot be drawn says so and keeps showing its source.

import mermaid from 'mermaid';
import { DEFAULT_LOCALE, LocalizedError, type Locale } from '@docpresenter/base';
import { EDITOR_MESSAGES } from './messages.js';

let initialised = false;
let counter = 0;
/** Drawings already made, by source: an edit redraws the page, not Mermaid. */
const drawn = new Map<string, string>();

function initialise(): void {
  if (initialised) return;
  mermaid.initialize({
    startOnLoad: false,
    // Nothing in a document may run script or reach the network.
    securityLevel: 'strict',
    theme: 'neutral',
    // Labels as SVG text rather than HTML inside the drawing: the PDF writer
    // and the PPTX picture both read SVG, and neither can read HTML in it.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: 'var(--font-body, sans-serif)',
  });
  initialised = true;
}

/** The drawing of one Mermaid source, as SVG. Throws what Mermaid throws. */
export async function mermaidSvg(source: string): Promise<string> {
  const known = drawn.get(source);
  if (known !== undefined) return known;
  initialise();
  counter += 1;
  const { svg } = await mermaid.render(`dp-mermaid-${counter}`, source);
  drawn.set(source, svg);
  return svg;
}

/**
 * Draws every Mermaid block under `root` that is not drawn yet. Resolves when
 * all of them are done, so a caller about to measure the page can wait.
 */
export async function drawMermaid(root: ParentNode, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const hosts = [...root.querySelectorAll<HTMLElement>('.dp-mermaid-diagram:not([data-drawn])')];
  for (const host of hosts) {
    const source = host.dataset['source'] ?? '';
    host.dataset['drawn'] = 'pending';
    try {
      host.innerHTML = await mermaidSvg(source);
      host.dataset['drawn'] = 'yes';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const note = host.ownerDocument.createElement('p');
      note.className = 'dp-mermaid-error';
      note.textContent = EDITOR_MESSAGES.in(locale)('editor.mermaid.failed', { message: message.split('\n')[0] ?? '' });
      host.prepend(note);
      host.dataset['drawn'] = 'error';
    }
  }
}

/**
 * Replaces every drawn Mermaid block under `root` with a picture of itself,
 * the same size on the page. For the PDF: Mermaid draws its arrowheads as SVG
 * markers, which the PDF writer does not follow, so a drawing measured as SVG
 * arrives with lines that point nowhere. A picture arrives as it was drawn.
 */
export async function flattenMermaid(root: ParentNode, scale = 3): Promise<void> {
  for (const host of root.querySelectorAll<HTMLElement>('.dp-mermaid-diagram[data-drawn="yes"]')) {
    const svg = host.querySelector('svg');
    const source = host.dataset['source'];
    if (!svg || source === undefined) continue;
    const box = svg.getBoundingClientRect();
    const picture = await mermaidPicture(source, scale);
    const image = host.ownerDocument.createElement('img');
    image.src = picture.data;
    image.alt = '';
    image.style.width = `${box.width}px`;
    image.style.height = `${box.height}px`;
    svg.replaceWith(image);
    await image.decode().catch(() => undefined);
  }
}

/**
 * The drawing as a PNG, for a slide. PowerPoint shows an SVG only with a PNG
 * beside it, so a PNG is what is handed over — at twice the size, because a
 * slide is shown large.
 */
export async function mermaidPicture(
  source: string, scale = 2,
): Promise<{ data: string; width: number; height: number }> {
  const svg = await mermaidSvg(source);
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const box = (parsed.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const width = Math.max(1, Math.ceil(box[2] ?? 400));
  const height = Math.max(1, Math.ceil(box[3] ?? 300));
  parsed.setAttribute('width', String(width));
  parsed.setAttribute('height', String(height));
  parsed.removeAttribute('style');
  const text = new XMLSerializer().serializeToString(parsed);

  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new LocalizedError(EDITOR_MESSAGES.phrase('editor.mermaid.noCanvas'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/png'), width, height };
}
