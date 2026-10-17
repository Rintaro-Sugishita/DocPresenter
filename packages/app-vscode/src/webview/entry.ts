// The editor, inside the WebView.
//
// This is the whole of the VS Code shell's screen: it holds the workspace's
// files in memory, hands `mountSheetView` the callbacks it asks for, and posts
// every edit to the extension, which writes it into the real file as a
// `WorkspaceEdit`. Nothing here knows what a `vscode` is — the import list
// says so — which is the same contract the web shell is built against.

import { isLocale, toLf } from '@docpresenter/base';
import { VSCODE_MESSAGES } from '../messages.js';
import { joinPath, parseDocument, renderDocument, resolveDocument } from '@docpresenter/markdown';
import {
  createHistory, DEFAULT_SETTINGS, mountSheetView, starterResource,
  type EditorSettings, type Picture, type ResourceKind, type SheetView,
} from '@docpresenter/editor';
import { drawMermaid } from '@docpresenter/editor/mermaid';
import { answerRenderRequest, useTheme } from './render-requests.js';
import { createReviewUi } from './review-ui.js';
import { freeName, inDocument, inWorkspace, resourceFolder } from '../paths.js';
import type { ExportFormat, FromView, ToView } from '../protocol.js';

declare function acquireVsCodeApi(): {
  postMessage(message: FromView): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const send = (message: FromView): void => { vscode.postMessage(message); };

let documentPath = '';
let source = '';
let files: Record<string, string> = {};
let images: Record<string, string> = {};
let settings: EditorSettings = DEFAULT_SETTINGS;
let view: SheetView | undefined;
/**
 * What Ctrl+Z takes back. Kept out here because the view is mounted again
 * whenever a file changes or a picture arrives, and the history must outlive
 * that. VS Code's own undo knows only the document on screen; an edit to a
 * drawing or a table is written to another file, so it is this that takes
 * those back. A step whose file changed since is refused, not forced.
 */
let history = createHistory();
/** Puts the shipped theme back, while the workspace's own is on screen. */
let restoreTheme: (() => void) | undefined;


const here = (written: string): string => inWorkspace(documentPath, written);

// The editing and review modes, and the review comments on the page.
const reviews = createReviewUi({
  send,
  read: path => (path === documentPath ? source : files[path]),
  documentPath: () => documentPath,
  locale: () => settings.locale,
  view: () => view,
  state: {
    get: () => vscode.getState() as { mode?: 'edit' | 'view'; marks?: boolean } | undefined,
    set: state => vscode.setState(state),
  },
});

const loader = {
  read: (path: string): string | undefined => files[here(path)],
  url: (path: string): string | undefined => (/^https?:\/\//.test(path)
    ? path : images[here(path)]),
};

const render = (text: string): string => {
  const doc = parseDocument(text);
  return renderDocument(doc, resolveDocument(doc, settings.locale), { loader });
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
    history,
    readResource: path => files[here(path)],
    listResources: () => Object.keys(files)
      .filter(path => /\.(dgm|table|mmd|ermlx)$/i.test(path))
      .sort((a, b) => a.localeCompare(b))
      .map(path => ({ path: inDocument(documentPath, path), label: inDocument(documentPath, path) })),
    createResource: kind => {
      const extension = kind === 'table' ? 'table' : 'dgm';
      const path = freeName(resourceFolder(documentPath), kind === 'table' ? 'table' : 'diagram',
        extension, new Set(Object.keys(files)));
      const text = starterResource(kind, settings.locale);
      // Held here as well as written to disk: the sheet is drawn from this
      // map the moment the import line lands, and the write is a round trip.
      files[path] = text;
      send({ kind: 'create', path, text });
      return { path: inDocument(documentPath, path), text };
    },
    // The file is moved here first, so the redraw that follows the document's
    // edit finds it under its new name; the host then moves the real one.
    moveResource: (fromWritten, toWritten) => {
      const t = VSCODE_MESSAGES.in(settings.locale);
      const from = here(fromWritten);
      const to = here(toWritten);
      if (from === to) return undefined;
      const held = from in files ? files : from in images ? images : undefined;
      if (!held) return t('vscode.move.missing', { path: fromWritten });
      if (to in files || to in images) return t('vscode.move.exists', { path: toWritten });
      held[to] = held[from]!;
      delete held[from];
      send({ kind: 'move', from, to });
      return undefined;
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
    decorate: page => {
      void drawMermaid(page, settings.locale);
      reviews.paint(page);
    },
  });
  if (at > 0) view.select(at);
  reviews.apply();
}

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  const message = event.data;
  if (message.kind === 'open') {
    documentPath = message.path;
    history = createHistory();
    // The files come as they are on disk; the screen measures every range on
    // their LF text, so a range means the same on every machine (protocol.ts).
    source = toLf(message.source);
    files = Object.fromEntries(Object.entries(message.files).map(([path, text]) => [path, toLf(text)]));
    images = { ...message.images };
    settings = {
      commitKey: message.commitKey,
      locale: isLocale(message.locale) ? message.locale : DEFAULT_SETTINGS.locale,
    };
    mount();
    return;
  }
  if (message.kind === 'file') {
    if (message.path === documentPath) source = toLf(message.text);
    else if (files[message.path] === undefined && !/\.(dgm|table|mmd|ermlx)$/i.test(message.path)) return;
    else files[message.path] = toLf(message.text);
    mount();
    return;
  }
  if (message.kind === 'image') {
    images[message.path] = message.url;
    mount();
    return;
  }
  if (message.kind === 'settings') {
    settings = { ...settings, commitKey: message.commitKey };
    view?.configure(settings);
    return;
  }
  if (message.kind === 'theme') {
    // The workspace's own theme in place of the shipped one, or back to it.
    restoreTheme?.();
    restoreTheme = message.css === undefined ? undefined : useTheme(message.css);
    return;
  }
  if (message.kind === 'reviews') {
    reviews.setNotes(message.notes);
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
