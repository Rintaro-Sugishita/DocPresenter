// The editor, inside the WebView.
//
// This is the whole of the VS Code shell's screen: it holds the workspace's
// files in memory, hands `mountSheetView` the callbacks it asks for, and posts
// every edit to the extension, which writes it into the real file as a
// `WorkspaceEdit`. Nothing here knows what a `vscode` is — the import list
// says so — which is the same contract the web shell is built against.

import { joinPath, parseDocument, renderDocument, resolveDocument } from '@docpresenter/markdown';
import {
  DEFAULT_SETTINGS, mountSheetView,
  type EditorSettings, type Picture, type ResourceKind, type SheetView,
} from '@docpresenter/editor';
import { drawMermaid } from '@docpresenter/editor/mermaid';
import { answerRenderRequest } from './render-requests.js';
import { freeName, inDocument, inWorkspace, resourceFolder } from '../paths.js';
import type { ExportFormat, FromView, ToView } from '../protocol.js';

declare function acquireVsCodeApi(): { postMessage(message: FromView): void };

const vscode = acquireVsCodeApi();
const send = (message: FromView): void => { vscode.postMessage(message); };

let documentPath = '';
let source = '';
let files: Record<string, string> = {};
let images: Record<string, string> = {};
let settings: EditorSettings = DEFAULT_SETTINGS;
/** A `.dgm` opened on its own: `source` is only the line that shows it. */
let drawingOnly = false;
let view: SheetView | undefined;

const STARTER: Readonly<Record<ResourceKind, string>> = {
  table: '| 見出し 1 | 見出し 2 |\n| -------- | -------- |\n|          |          |\n',
  diagram: 'free {\n  a [ここに図形]\n}\n\nlayout {\n  a @ (40, 40) 160x60\n}\n',
};

const here = (written: string): string => inWorkspace(documentPath, written);

const loader = {
  read: (path: string): string | undefined => files[here(path)],
  url: (path: string): string | undefined => (/^https?:\/\//.test(path)
    ? path : images[here(path)]),
};

const render = (text: string): string => {
  const doc = parseDocument(text);
  return renderDocument(doc, resolveDocument(doc), { loader });
};

/**
 * Builds the screen, keeping the sheet the author was on.
 *
 * The view is mounted rather than refreshed because a document's sheets are
 * made from its text: when the text changed under us — somebody saved the
 * `.dgm` in a text editor, or a branch was checked out — showing the old one
 * is the single thing this tool must not do.
 */
function mount(): void {
  const at = view?.active ?? 0;
  view?.destroy();
  const root = document.getElementById('editor');
  if (!root) return;
  view = mountSheetView({
    root,
    source,
    render,
    settings,
    readResource: path => files[here(path)],
    listResources: () => Object.keys(files)
      .filter(path => /\.(dgm|table|mmd|ermlx)$/i.test(path))
      .sort((a, b) => a.localeCompare(b))
      .map(path => ({ path: inDocument(documentPath, path), label: inDocument(documentPath, path) })),
    createResource: kind => {
      const extension = kind === 'table' ? 'table' : 'dgm';
      const path = freeName(resourceFolder(documentPath), kind === 'table' ? 'table' : 'diagram',
        extension, new Set(Object.keys(files)));
      const text = STARTER[kind];
      // Held here as well as written to disk: the sheet is drawn from this
      // map the moment the import line lands, and the write is a round trip.
      files[path] = text;
      send({ kind: 'create', path, text });
      return { path: inDocument(documentPath, path), text };
    },
    createImage: (picture: Picture) => {
      const name = picture.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
      const extension = /\.(png|jpe?g|gif|webp)$/i.exec(name)?.[1]?.toLowerCase()
        ?? (picture.type.split('/')[1] ?? 'png');
      const folder = `${resourceFolder(documentPath)}/assets`;
      const already = Object.entries(images).find(([, url]) => url === name);
      if (already) return { path: inDocument(documentPath, already[0]) };
      const path = freeName(folder, name.replace(/\.[^.]+$/, '') || 'picture',
        extension, new Set(Object.keys(images)));
      send({ kind: 'create', path, bytes: [...picture.bytes] });
      return { path: inDocument(documentPath, path) };
    },
    onChange: (edit, text) => {
      if (edit.path === undefined && drawingOnly) {
        // The one-line document a drawing is shown in is not a file. Whatever
        // was done to it is undone, once the editor has finished doing it.
        setTimeout(mount, 0);
        send({ kind: 'error', message: '図だけを開いているので、ここに本文は書けません（図を押すと編集できます）' });
        return;
      }
      if (edit.path === undefined) {
        source = text;
        send({ kind: 'change', span: edit.span, description: edit.description, text: edit.text });
        return;
      }
      files[here(edit.path)] = text;
      send({
        kind: 'change', path: here(edit.path),
        span: edit.span, description: edit.description, text: edit.text,
      });
    },
    onError: message => send({ kind: 'error', message }),
    decorate: page => { void drawMermaid(page); },
  });
  if (at > 0) view.select(at);
}

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  const message = event.data;
  if (message.kind === 'open') {
    documentPath = message.path;
    source = message.source;
    drawingOnly = message.diagram === true;
    files = { ...message.files };
    images = { ...message.images };
    settings = { commitKey: message.commitKey };
    mount();
    return;
  }
  if (message.kind === 'file') {
    if (message.path === documentPath && !drawingOnly) source = message.text;
    else if (files[message.path] === undefined && !/\.(dgm|table|mmd|ermlx)$/i.test(message.path)) return;
    else files[message.path] = message.text;
    mount();
    return;
  }
  if (message.kind === 'image') {
    images[message.path] = message.url;
    mount();
    return;
  }
  if (message.kind === 'settings') {
    settings = { commitKey: message.commitKey };
    view?.configure(settings);
    return;
  }
  if (message.kind === 'export-state') {
    for (const button of exportButtons) button.disabled = message.busy;
    if (exportStatus) exportStatus.textContent = message.message ?? '';
    return;
  }
  answerRenderRequest(message, send);
});

// --- 書き出し -----------------------------------------------------------------
//
// The buttons only ask. The build runs in the extension, which writes the
// file; what needs a browser — laying the page out for a PDF, drawing Mermaid
// as a picture for a slide — comes back here as a request.

const exportButtons = [...document.querySelectorAll<HTMLButtonElement>('.dp-export button[data-format]')];
const exportStatus = document.querySelector<HTMLElement>('.dp-export-status');
for (const button of exportButtons) {
  button.addEventListener('click', () => {
    send({ kind: 'export', format: button.dataset['format'] as ExportFormat });
  });
}

// `joinPath` is re-exported so the bundle keeps one copy of the path rules the
// renderer and the shell both use; referencing it here makes that explicit.
void joinPath;

send({ kind: 'ready' });
