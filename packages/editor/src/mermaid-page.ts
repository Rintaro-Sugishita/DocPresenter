// What a delivered page runs to draw its Mermaid blocks.
//
// Bundled on its own and written into the HTML artifact only when the document
// has a Mermaid block, so a document without one stays a page with no script.
// The PDF writer opens the same page in a browser and waits for the mark this
// sets before it measures anything: a drawing that arrives after the page was
// measured would be a blank space in the PDF.

import { drawMermaid, flattenMermaid, mermaidPicture } from './mermaid.js';

declare global {
  interface Window {
    __dpMermaid?: {
      readonly draw: typeof drawMermaid;
      readonly picture: typeof mermaidPicture;
      readonly flatten: typeof flattenMermaid;
    };
  }
}

window.__dpMermaid = { draw: drawMermaid, picture: mermaidPicture, flatten: flattenMermaid };

const start = (): void => {
  void drawMermaid(document).finally(() => {
    document.documentElement.dataset['dpMermaid'] = 'done';
  });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
