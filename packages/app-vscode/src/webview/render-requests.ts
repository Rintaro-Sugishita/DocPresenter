// What a WebView does for the extension that only a browser can: lay a page
// out and measure it for a PDF, and draw Mermaid as a picture for a slide.
//
// Both WebViews answer these — the editor of an open document, and the panel
// a batch export opens when no editor is in reach — so the answering is here.

import { drawMermaid, flattenMermaid, mermaidPicture } from '@docpresenter/editor/mermaid';
import { measure } from '@docpresenter/pdf';
import type { FromView, ToView } from '../protocol.js';

/** Answers a request if it is one of these. Returns whether it was. */
export function answerRenderRequest(message: ToView, send: (message: FromView) => void): boolean {
  if (message.kind === 'measure') {
    void measurePage(message.id, message.body, message.foot, message.title, send);
    return true;
  }
  if (message.kind === 'picture') {
    mermaidPicture(message.source).then(
      picture => send({ kind: 'pictured', id: message.id, picture }),
      (error: unknown) => send({
        kind: 'pictured', id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return true;
  }
  return false;
}

/**
 * Lays a page out as it will be printed, off the screen, and measures it.
 * Whatever else the WebView shows is left alone: the page is the build's
 * rendering of the document, not the editor's.
 */
async function measurePage(
  id: number, body: string, foot: string, title: string, send: (message: FromView) => void,
): Promise<void> {
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute; left:-20000px; top:0; width:800px;';
  stage.innerHTML = body;
  document.body.append(stage);
  try {
    // Drawn before anything is measured, then laid down as pictures: the PDF
    // writer does not follow the markers Mermaid draws its arrowheads with.
    await drawMermaid(stage);
    await flattenMermaid(stage);
    await Promise.all([...stage.querySelectorAll('img')].map(image => image.decode().catch(() => undefined)));
    const measured = measure(stage, { foot, title });
    send({ kind: 'measured', id, plan: measured.plan, diagnostics: measured.diagnostics });
  } catch (error) {
    send({ kind: 'measured', id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    stage.remove();
  }
}
