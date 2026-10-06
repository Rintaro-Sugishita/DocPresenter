// The panel a batch export opens.
//
// Writing every document at once is a command, not a button on one document,
// so there may be no editor open to lay a page out in. This panel is that
// browser: it shows how far the export has got and answers the requests the
// build sends — and nothing else. It closes when the export is done.

import type { FromView, ToView } from '../protocol.js';
import { answerRenderRequest } from './render-requests.js';

declare function acquireVsCodeApi(): { postMessage(message: FromView): void };

const vscode = acquireVsCodeApi();
const send = (message: FromView): void => { vscode.postMessage(message); };
const status = document.querySelector<HTMLElement>('.dp-exporter-status');

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  const message = event.data;
  if (message.kind === 'export-state') {
    if (status) status.textContent = message.message ?? '';
    return;
  }
  answerRenderRequest(message, send);
});

send({ kind: 'ready' });
