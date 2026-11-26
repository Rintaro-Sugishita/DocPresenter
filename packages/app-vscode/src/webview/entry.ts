// The editor, inside the WebView.
//
// This is the whole of the VS Code shell's screen: it holds the workspace's
// files in memory, hands `mountSheetView` the callbacks it asks for, and posts
// every edit to the extension, which writes it into the real file as a
// `WorkspaceEdit`. Nothing here knows what a `vscode` is — the import list
// says so — which is the same contract the web shell is built against.

import { followColourScheme, isLocale, toLf, useDarkStyle } from '@docpresenter/base';
import { PAGE_STYLE } from '../page-style.js';
import { VSCODE_MESSAGES } from '../messages.js';
import { isWorkbookPath, splitWorkbookPath, withWorkbooks } from '@docpresenter/xlsx';
import { joinPath, parseDocument, renderDocument, resolveDocument } from '@docpresenter/markdown';
import {
  createHistory, DEFAULT_SETTINGS, mountSheetView, starterResource,
  type EditorSettings, type Picture, type ResourceKind, type SheetView,
} from '@docpresenter/editor';
import { drawMermaid } from '@docpresenter/editor/mermaid';
import { useItemSettings } from '@docpresenter/diagram';
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
// Light or dark as VS Code's colour theme is. The page's own frame goes dark
// with it; the document follows once its theme arrives.
followColourScheme(document, 'vscode');
useDarkStyle(document, 'page', PAGE_STYLE);
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

/** Workbooks a sheet can be imported from, by workspace path. */
let workbooks: Record<string, Uint8Array> = {};
/** Reads a file of the workspace; a workbook's sheet comes back as the text of a table. */
const reader = (): ((path: string) => string | undefined) =>
  withWorkbooks(path => files[path], path => workbooks[path.replace(/#.*$/, '')]);
let readFile = reader();
const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), char => char.charCodeAt(0));

// The editing and review modes, and the review comments on the page.
const reviews = createReviewUi({
  send,
  read: path => (path === documentPath ? source : readFile(path)),
  documentPath: () => documentPath,
  locale: () => settings.locale,
  view: () => view,
  state: {
    get: () => vscode.getState() as { mode?: 'edit' | 'view'; marks?: boolean } | undefined,
    set: state => vscode.setState(state),
  },
});

const loader = {
  read: (path: string): string | undefined => readFile(here(path)),
  url: (path: string): string | undefined => (/^https?:\/\//.test(path)
    ? path : images[here(path)]),
};

/** Files made from this screen whose first edit — their whole text — the host has already written. */
const created = new Set<string>();

const render = (text: string): string => {
  const doc = parseDocument(text);
  return renderDocument(doc, resolveDocument(doc, settings.locale), { loader, path: documentPath });
};

/**
 * Builds the screen, keeping the sheet the author was on.
 *
 * The view is mounted rather than refreshed because a document's sheets are
 * made from its text: when the text changed under us — somebody saved the
 * `.dgm` in a text editor, or a branch was checked out — showing the old one
 * is the single thing this tool must not do.
 */
function mount(keep = true): void {
  const at = view?.active ?? 0;
  // Where the reader was: a file arriving from outside (a table just made,
  // a drawing saved elsewhere) redraws the page, and must not send the reader
  // back to the top of it.
  const pane = document.querySelector<HTMLElement>('.dp-editor-pane');
  const scroll = keep ? pane?.scrollTop ?? 0 : 0;
  view?.destroy();
  const root = document.getElementById('editor');
  if (!root) return;
  view = mountSheetView({
    root,
    source,
    render,
    settings,
    history,
    readResource: path => readFile(here(path)),
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
      created.add(path);
      send({ kind: 'create', path, text });
      return { path: inDocument(documentPath, path), text };
    },
    // A figure's file, deleted once the document stopped naming it. Let go of
    // here at once; the host gives it back if something else still uses it.
    deleteResource: written => {
      const path = here(written);
      delete files[path];
      delete images[path];
      send({ kind: 'delete', path });
      return undefined;
    },
    // A screen's item table, made from the canvas. Held here as well as
    // written, like a new resource; one already there is kept as it is.
    createFile: (written, text) => {
      const path = here(written);
      if (path in files) return undefined;
      files[path] = text;
      send({ kind: 'create', path, text });
      return undefined;
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
      const path = here(edit.path);
      // The new file's own text, which the editor records as its first edit:
      // the file was written with it already, and writing it again would
      // put it in twice.
      if (created.delete(path) && edit.span.start === 0 && edit.span.end === 0 && edit.text === text) {
        files[path] = text;
        return;
      }
      files[path] = text;
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
    // A zoomed drawing moved the shapes its comments point at.
    onZoom: () => reviews.layout(),
    // A table written in the prose: into a file of its own, or to Excel.
    tableMenu: table => {
      const say = VSCODE_MESSAGES.in(settings.locale);
      return [
        { label: say('vscode.tables.menuSplit'), run: () => send({ kind: 'split-table', line: table.line }) },
        { label: say('vscode.tables.menuExcel'), run: () => send({ kind: 'table-excel', text: table.text }) },
      ];
    },
    // A comment on one shape of a drawing, from the menu on it; a table,
    // opened in Excel and written back when Excel saves it.
    openFile: path => send({ kind: 'open-file', path: here(path) }),
    figureMenu: (figure, target) => {
      const path = figure.dataset['path'];
      const say = VSCODE_MESSAGES.in(settings.locale);
      const excel = path === undefined ? []
        : /\.table$/i.test(path) ? [{ label: say('vscode.excel.menu'), run: () => send({ kind: 'open-in-excel', path: here(path) }) }]
          // A sheet imported from a workbook: the workbook is the team's own, opened as it is.
          : isWorkbookPath(path) ? [{ label: say('vscode.excel.openSource'), run: () => send({ kind: 'open-external', path: here(splitWorkbookPath(path).file) }) }]
            : [];
      // A drawing or a table is a file of its own: opened beside, as text.
      const own = path !== undefined && /\.(dgm|table|mmd|ermlx)$/i.test(path)
        ? [{ label: say('vscode.figure.openFile'), run: () => send({ kind: 'open-file', path: here(path) }) }]
        : [];
      return [...own, ...excel, ...reviews.figureMenu(target)];
    },
  });
  if (at > 0) view.select(at);
  reviews.apply();
  if (scroll > 0) {
    const put = (): void => {
      const now = document.querySelector<HTMLElement>('.dp-editor-pane');
      if (now) now.scrollTop = scroll;
    };
    put();
    // Pictures take their height once decoded; ask again when the frame is laid out.
    requestAnimationFrame(put);
  }
}

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  const message = event.data;
  if (message.kind === 'open') {
    documentPath = message.path;
    history = createHistory();
    useItemSettings(message.settings);
    // The files come as they are on disk; the screen measures every range on
    // their LF text, so a range means the same on every machine (protocol.ts).
    source = toLf(message.source);
    files = Object.fromEntries(Object.entries(message.files).map(([path, text]) => [path, toLf(text)]));
    images = { ...message.images };
    workbooks = Object.fromEntries(Object.entries(message.workbooks ?? {}).map(([path, data]) => [path, bytesOf(data)]));
    readFile = reader();
    settings = {
      commitKey: message.commitKey,
      locale: isLocale(message.locale) ? message.locale : DEFAULT_SETTINGS.locale,
    };
    mount(false);
    return;
  }
  if (message.kind === 'file') {
    const text = toLf(message.text);
    // What is held already — a file this page made itself, coming back from
    // the disk — changes nothing on it.
    if ((message.path === documentPath ? source : files[message.path]) === text) return;
    if (message.path === documentPath) source = text;
    else if (files[message.path] === undefined && !/\.(dgm|table|mmd|ermlx)$/i.test(message.path)) return;
    else files[message.path] = text;
    mount();
    return;
  }
  if (message.kind === 'workbook') {
    workbooks[message.path] = bytesOf(message.data);
    readFile = reader();
    mount();
    return;
  }
  if (message.kind === 'image') {
    if (images[message.path] === message.url) return;
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
    // The dark screen's colours, made from whichever theme is on screen.
    const shown = message.css ?? message.shipped;
    if (shown !== undefined) useDarkStyle(document, 'theme', shown);
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

const exportButtons = [...document.querySelectorAll<HTMLButtonElement>('.dp-export button[data-format], .dp-export-changes')];
const exportStatus = document.querySelector<HTMLElement>('.dp-export-status');
for (const button of exportButtons) {
  button.addEventListener('click', () => {
    const format = button.dataset['format'] as ExportFormat | undefined;
    send(format === undefined ? { kind: 'export-changes' } : { kind: 'export', format });
  });
}

// `joinPath` is re-exported so the bundle keeps one copy of the path rules the
// renderer and the shell both use; referencing it here makes that explicit.
void joinPath;

send({ kind: 'ready' });
