// The sheet view: one sheet on screen at a time, with tabs along the bottom.
//
// The view owns no model of its own. It holds the source text, asks the caller
// to render it, and turns every gesture into one of the sheet operations —
// which are byte-range edits. That means what the screen shows and what the
// file contains can never drift apart: there is only the file.

import {
  PICTURE, importAttribute, isAddress, joinPath, labelPrefixFor, parseDocument, parseTable,
  removeImportLine, renameFigure, setFenceView, setImportAttribute, sheetsOf, viewOf, type MermaidView, type Sheet,
  enterInList, indentListItems, labelCandidates, cellAt, type TableFile, type TextChange,
  PAPER_NAMES, paperOf, paperStyle, paperValue, setFrontmatterKey, type Paper, markdownTables, tableFromTsv,
} from '@docpresenter/markdown';
import { createSuggestions } from './suggest.js';
import {
  itemCellChoices, itemColumns, itemTableName, itemTypes, parseDiagram, withParts, type DiagramFile,
} from '@docpresenter/diagram';
import {
  applyEdit, byteLength, describeError, described, enableLongPress, localizeEdit, sliceBytes, toggleInline,
  type Edit, type InlineMark, type Phrase,
} from '@docpresenter/base';
import { EDITOR_MESSAGES, ed } from '../messages.js';
import { DEFAULT_SETTINGS, isCommit, type EditorSettings } from '../settings.js';
import { insertSheet, moveSheet, removeSheet, renameSheet, SheetEditError } from '../sheets.js';
import { DiagramEditError } from '@docpresenter/diagram';
import { TableEditError } from '../table.js';
import { createCanvas } from '@docpresenter/diagram';
import { createOverlayEditor } from '@docpresenter/diagram';
import { createGrid, type CellChoices, type Grid, type GridPosition } from './grid.js';
import { attachZoom, createMenu, fitOverlays, type MenuItem } from '@docpresenter/base';
import { EDITOR_STYLE } from './style.js';
import { injectMathStyle } from '../math.js';
import { BASE_STYLE, useDarkStyle } from '@docpresenter/base';
import { DIAGRAM_STYLE } from '@docpresenter/diagram';
import { createToolbar } from '@docpresenter/base';
import { mountPicture, type Align, type PictureControls } from './picture.js';
import { openFigureNames, type FigureNamesForm } from './figure-names.js';
import { openFigureDelete, type FigureDeleteForm } from './figure-delete.js';
import { createHistory, redoing, undoKey, undoing, type History } from '../history.js';

export interface SheetViewOptions {
  readonly root: HTMLElement;
  readonly source: string;
  /** Renders a document to HTML made of `<section class="dp-sheet">`. */
  readonly render: (source: string) => string;
  /**
   * Reads a referenced file so its source can be opened. Without it a diagram
   * or a table can be looked at but not edited.
   */
  readonly readResource?: (path: string) => string | undefined;
  /**
   * Called after every edit with the full new text of whatever was edited —
   * the document when `edit.path` is absent, that referenced file otherwise.
   * The host must store it before returning: the view redraws straight after,
   * and reads referenced files back through `render`.
   */
  readonly onChange?: (edit: Edit, text: string) => void;
  /**
   * Creates the file behind a new figure or table and returns the path to
   * write into the `@import`. Where new files go is the platform's business,
   * not the editor's, so the host decides the folder and the starter content.
   */
  readonly createResource?: (kind: ResourceKind) => { path: string; text: string } | undefined;
  /**
   * Makes a file a drawing names — a screen's item table — at a path written
   * from the document, with the text given. A file already there is kept, not
   * written over. Returns why it could not, or undefined. Without it a screen
   * on the canvas does not offer to make its table.
   */
  readonly createFile?: ((path: string, text: string) => string | undefined) | undefined;
  /**
   * Takes a picture the author brought in — pasted from the clipboard, or
   * dropped onto the page — and returns the path to write into the `@import`.
   *
   * **The host decides where it goes, and whether it goes anywhere at all.**
   * A picture the workspace already holds should come back as the path it is
   * already at rather than as a second copy; that comparison needs the folder,
   * which is the platform's business and not the editor's.
   */
  readonly createImage?: (picture: Picture) => { path: string } | undefined;
  /**
   * The figures and tables that already exist, for referring to one rather
   * than making another. Which files exist is the platform's business too.
   */
  readonly listResources?: () => readonly { path: string; label: string }[];
  /**
   * Moves the file behind a figure — renaming it in its folder — and points
   * every *other* document's `@import` at the new place. Both paths are as
   * this document writes them. The editor rewrites this document itself, as
   * one edit, once the host has said yes.
   *
   * Returns why it cannot be done, or undefined when it was. Without it the
   * file name of a figure is shown but cannot be changed.
   */
  readonly moveResource?: ((from: string, to: string) => string | undefined) | undefined;
  /**
   * Deletes the file behind a figure, as the document writes it, after the
   * document has stopped naming it. Returns why it could not, or undefined.
   * A host keeps a file something else still uses. Without it a figure can
   * leave the document but its file cannot be deleted from here.
   */
  readonly deleteResource?: ((path: string) => string | undefined) | undefined;
  /**
   * Whether figures offer their names for changing. Off where the document on
   * screen is not a file — a drawing opened on its own — so there is no line
   * to write a caption or a label on.
   */
  readonly nameFigures?: boolean;
  /** Called when an operation is refused, so the app can say why. */
  readonly onError?: (message: string) => void;
  /** Key bindings and the like. See settings.ts for why this is a value. */
  readonly settings?: EditorSettings;
  /**
   * Called with the page after every redraw, for what only the host can draw
   * — Mermaid, which needs a library the editor does not carry.
   */
  readonly decorate?: (page: HTMLElement) => void;
  /**
   * Called when a drawing is zoomed, with its figure: whatever the host put on
   * top of it (the comments beside its shapes) has moved.
   */
  readonly onZoom?: (figure: HTMLElement) => void;
  /**
   * More lines for the menu on a figure, from whoever shows comments: what
   * the press was on (a shape of a drawing, say) decides what they offer.
   * Offered while reading too, unlike the figure's own lines.
   */
  readonly figureMenu?: (figure: HTMLElement, target: Element) => readonly MenuItem[];
  /**
   * Opens a file the document uses (a drawing's `.dgm`) in an editor of its
   * own, beside the document: the canvas offers it next to showing the text
   * here. Without it the canvas shows the text here only.
   */
  readonly openFile?: ((path: string) => void) | undefined;
  /**
   * The lines for the menu on a table written in the prose: what the host
   * can do with it (move it into a file, open it in Excel). `line` is where
   * it starts in the document, from 0; `text` is the table as written.
   */
  readonly tableMenu?: (table: { line: number; text: string }) => readonly MenuItem[];
  /**
   * What Ctrl+Z takes back. A host that mounts the view again — because a
   * picture arrived, or a file changed — passes the same one each time, so the
   * history outlives the view. Without it the view keeps its own.
   */
  readonly history?: History;
}

/** What can be added to a sheet, besides prose. */
export type ResourceKind = 'table' | 'diagram';

/** A picture that arrived from outside the document. */
export interface Picture {
  readonly bytes: Uint8Array;
  /** What it was called where it came from; a pasted one may have no name. */
  readonly name: string;
  /** `image/png` and the like, as the clipboard or the file reported it. */
  readonly type: string;
}

export interface SheetView {
  readonly source: string;
  readonly active: number;
  select(index: number): void;
  /**
   * Reading rather than writing: a click selects text instead of opening the
   * block under it, and nothing on the page offers to change the file. The
   * place is kept. Review comments are made in this state (the host paints
   * them, through `decorate`).
   */
  setReadOnly(on: boolean): void;
  /**
   * What is selected in the source box open now, as a byte range of the file
   * it came from: the document when `path` is undefined, otherwise the
   * referenced file as the document names it. Undefined when nothing is
   * selected, or once the box differs from the file — a range of words not
   * written yet is a range of nothing.
   */
  sourceSelection(): { path: string | undefined; start: number; end: number; text: string } | undefined;
  /** Applies changed settings without losing the place. */
  configure(settings: EditorSettings): void;
  destroy(): void;
}

export function mountSheetView(options: SheetViewOptions): SheetView {
  const { root, render } = options;
  let source = options.source;
  let active = 1;
  let continuous = false;
  let dragging: number | undefined;
  /** Reading only: see `SheetView.setReadOnly`. */
  let readOnly = false;
  let sections: HTMLElement[] = [];
  let tabs: HTMLElement[] = [];
  let editing: BlockEdit | undefined;
  /** Where the pointer went down to open what opens next, so the caret starts there. */
  let press: { x: number; y: number } | undefined;
  /** The table whose grid is open, and where the selection sits in it. */
  let picture: { path: string } | undefined;
  let pictureControls: PictureControls | undefined;
  /** The form for a figure's file name, caption and label, while it is open. */
  let namesForm: FigureNamesForm | undefined;
  /** The question asked before a figure is taken out, while it is open. */
  let deleteForm: FigureDeleteForm | undefined;
  let grid: { path: string; at: GridPosition; target: string } | undefined;
  let mounted: Grid | undefined;
  /** The diagram open for direct manipulation, and the shapes picked in it. */
  let canvas: {
    path: string;
    selected: readonly string[];
    /** The connection picked, as `from->to`; shapes and a line never both. */
    edge: string | undefined;
  } | undefined;
  let settings = options.settings ?? DEFAULT_SETTINGS;
  let t = EDITOR_MESSAGES.in(settings.locale);
  const history = options.history ?? createHistory();
  /** An error in the author's language, when it can say itself in theirs. */
  const explain = (error: unknown): string => describeError(error, settings.locale);

  const owner = root.ownerDocument;
  const menu = createMenu(owner);
  injectStyle(owner);
  // A finger has no right button: a long press opens the same menus.
  enableLongPress(owner);
  root.classList.add('dp-editor');
  const pane = element('div', 'dp-editor-pane');
  // The listener lives on the pane, which survives a redraw; the page inside
  // it does not. Routing is on mousedown so that the open editor is closed
  // before the click is resolved — closing one can redraw the page, and a
  // click resolved beforehand would land on a node that no longer exists.
  pane.addEventListener('mousedown', onPointerDown);
  // A picture arrives either way people bring things into a document: from the
  // clipboard, or dropped on the page. The paste listener is on the document
  // because the pane itself never holds focus; both end at the same place.
  owner.addEventListener('paste', onPaste);
  pane.addEventListener('dragover', onDragOver);
  pane.addEventListener('dragleave', onDragLeave);
  pane.addEventListener('drop', onDrop);
  // A figure's names are asked for from its button, or from the menu on it.
  // The grid and the canvas have menus of their own, and keep them.
  pane.addEventListener('contextmenu', event => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.dp-grid, .dp-canvas, .dp-canvas-host, .dp-block-source')) return;
    const figure = target?.closest<HTMLElement>('.dp-figure');
    const written = figure ? undefined : target?.closest('table');
    if (written && target && !readOnly && options.tableMenu) {
      const found = proseTable(written);
      const items = found ? options.tableMenu(found) : [];
      if (items.length > 0) {
        event.preventDefault();
        menu.open(event.clientX, event.clientY, items);
      }
      return;
    }
    if (!figure || !target) return;
    const more = options.figureMenu?.(figure, target) ?? [];
    const own: MenuItem[] = readOnly || !nameable(figure) ? [] : [
      { label: t('editor.figure.button'), run: () => openNames(figure) },
      { label: t('editor.delete.button'), run: () => openDelete(figure) },
    ];
    if (own.length + more.length === 0) return;
    event.preventDefault();
    menu.open(event.clientX, event.clientY, [...own, ...more]);
  });
  const tabbar = element('div', 'dp-tabbar');
  tabbar.setAttribute('role', 'tablist');
  root.append(pane, tabbar);
  // Every sheet, one to a line, as Excel lists them: a row of tabs longer
  // than the window has no other way to reach the one at the far end.
  tabbar.addEventListener('contextmenu', event => {
    if ((event.target as HTMLElement | null)?.closest('select, input')) return;
    event.preventDefault();
    event.stopPropagation();
    const names = tabs.map(tab => tab.firstChild?.textContent ?? '');
    if (names.length === 0) return;
    menu.open(event.clientX, event.clientY, names.map((name, i): MenuItem => ({
      label: `${i + 1}. ${name}`,
      disabled: i + 1 === active,
      run: () => {
        select(i + 1);
        tabs[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      },
    })));
  });

  /** A table on the page that was written in the prose: where it is in the document, and its text. */
  function proseTable(table: Element): { line: number; text: string } | undefined {
    const prose = table.closest<HTMLElement>('.dp-prose');
    const span = prose && prose.dataset['doc'] === undefined ? spanOf(prose) : undefined;
    if (!prose || !span) return undefined;
    const nth = [...prose.querySelectorAll('table')].indexOf(table as HTMLTableElement);
    const lines = source.split('\n');
    const firstLine = sliceBytes(source, 0, span.start).split('\n').length - 1;
    const lastLine = firstLine + sliceBytes(source, span.start, span.end).split('\n').length - 1;
    const tables = markdownTables(source).filter(one => one.first >= firstLine && one.last <= lastLine);
    const found = tables[nth];
    if (!found) return undefined;
    return { line: found.first, text: lines.slice(found.first, found.last + 1).join('\n') };
  }

  function element(tag: string, className: string): HTMLElement {
    const node = owner.createElement(tag);
    node.className = className;
    return node;
  }

  // --- 本文の編集 --------------------------------------------------------
  //
  // A block is edited as what it is: the Markdown that produced it. Clicking
  // opens the source of that block and nothing else, so the byte range written
  // back is exactly the range that was opened.

  interface BlockEdit {
    readonly host: HTMLElement;
    readonly original: string;
    readonly span: { start: number; end: number };
    readonly area: HTMLTextAreaElement;
    /** Written before the text. A new block needs the blank line that separates it. */
    readonly prefix: string;
    /** A new block, so an empty box means "never mind" rather than "delete this". */
    readonly fresh: boolean;
    /** The referenced file being edited, or undefined for the document. */
    readonly path: string | undefined;
    /** The text the box opened with: the range of the file, as it is in the file. */
    readonly initial: string;
    /** The blocks after the host that the box holds too, hidden while it is open. */
    readonly merged: readonly HTMLElement[];
  }

  let toolbar = createToolbar(owner, applyFormat, settings.locale);

  function applyFormat(mark: InlineMark): void {
    const current = editing;
    if (!current) return;
    const { area } = current;
    const change = toggleInline(area.value, area.selectionStart, area.selectionEnd, mark);
    area.setRangeText(change.text, change.start, change.end, 'preserve');
    area.setSelectionRange(change.select.start, change.select.end);
    area.focus();
    resize(area);
    toolbar.sync(area.value, area.selectionStart, area.selectionEnd);
  }

  function beginEdit(pressed: HTMLElement): void {
    // A heading and the paragraphs under it are one thing to write: the
    // heading opens with them, and a paragraph opens with its heading.
    const section = sectionOf(pressed);
    const host = section?.heading ?? pressed;
    if (editing?.host === host) return;
    const span = spanOf(host);
    if (!span) return;
    const body = section?.body ?? [];
    const last = body.length === 0 ? undefined : spanOf(body[body.length - 1]!);
    const whole = last === undefined ? span : { start: span.start, end: last.end };
    // The words are the body's, so the box is in the body's type, not the heading's.
    const font = body.length === 0 ? undefined : owner.defaultView?.getComputedStyle(body[0]!).font;
    open(host, whole, sliceBytes(source, whole.start, whole.end), '', false, undefined, body);
    if (font && editing?.host === host) editing.area.style.font = font;
  }

  /**
   * The heading a block of prose sits under and the prose that follows it,
   * up to the next heading, figure or anything else — on the page as it is.
   * Nothing when the block is not part of one: prose with no heading above
   * it, or what was pulled in from another file.
   */
  function sectionOf(block: HTMLElement): { heading: HTMLElement; body: HTMLElement[] } | undefined {
    const isHeading = (node: Element): node is HTMLElement => /^H[1-6]$/.test(node.tagName);
    const isProse = (node: Element): node is HTMLElement => node.classList.contains('dp-prose');
    const own = (node: HTMLElement): boolean => node.dataset['doc'] === undefined && spanOf(node) !== undefined;
    const step = (node: Element, back: boolean): Element | null => {
      let next = back ? node.previousElementSibling : node.nextElementSibling;
      while (next && next.classList.contains('dp-append-gap')) next = back ? next.previousElementSibling : next.nextElementSibling;
      return next;
    };
    if (!own(block) || (!isHeading(block) && !isProse(block))) return undefined;
    let heading: HTMLElement | undefined = isHeading(block) ? block : undefined;
    for (let at = step(block, true); heading === undefined && at; at = step(at, true)) {
      if (!(at instanceof HTMLElement) || !own(at)) return undefined;
      if (isHeading(at)) heading = at;
      else if (!isProse(at)) return undefined;
    }
    if (heading === undefined) return undefined;
    const body: HTMLElement[] = [];
    for (let at = step(heading, false); at instanceof HTMLElement && isProse(at) && own(at); at = step(at, false)) body.push(at);
    if (body.length === 0) return undefined;
    return { heading, body };
  }

  /**
   * Opens a diagram or a table — the whole of the file it lives in. A figure
   * is one file, so its range is that file from end to end; the `@import` line
   * that placed it belongs to the document and is edited from the caption.
   */
  function beginResourceEdit(figure: HTMLElement): void {
    const body = figure.querySelector<HTMLElement>('.dp-figure-body');
    const path = figure.dataset['path'];
    if (!body || !path || editing?.host === body) return;
    const text = options.readResource?.(path);
    if (text === undefined) {
      options.onError?.(t('editor.view.cannotOpen', { path }));
      return;
    }
    // A file that will not parse has no grid and no drawing to open, and the
    // only way out is the text itself. Leaving it unopenable would leave the
    // author stuck with a figure they cannot fix.
    if (!readable(path, text)) {
      grid = undefined;
      canvas = undefined;
      open(body, { start: 0, end: byteLength(text) }, text, '', false, path);
      return;
    }
    // Nobody wants to write a table by hand, so a table opens as a grid. The
    // source is still one click away, for the parts the grid has no gesture
    // for yet.
    if (path.toLowerCase().endsWith('.table')) {
      if (grid?.path === path) return;
      const other = grid !== undefined || canvas !== undefined;
      grid = { path, at: { row: 0, column: 0 }, target: 'cell' };
      canvas = undefined;
      endEdit(true);
      // Leaving another figure's editor on the page would leave a second set
      // of controls, on a sheet nobody is looking at. Redrawing puts every
      // figure back as it is and mounts the one now open.
      if (other) draw(); else mountGrid(body);
      return;
    }
    // A library of parts has nothing placed in it, so there is nothing to drag:
    // what it holds is a list of looks, and a list is edited as text. The page
    // shows it as a specimen sheet, which is a drawing of the file rather than
    // the file itself — opening that on a canvas would let someone drag a
    // picture nothing would be written back to.
    if (path.toLowerCase().endsWith('.dgm') && parseDiagram(text).mode === 'parts') {
      grid = undefined;
      canvas = undefined;
      open(body, { start: 0, end: byteLength(text) }, text, '', false, path);
      return;
    }
    // A diagram opens as the drawing itself. Dragging a shape is the gesture
    // the layout layer was designed for; the source is still one click away.
    if (path.toLowerCase().endsWith('.dgm')) {
      if (canvas?.path === path) return;
      const other = grid !== undefined || canvas !== undefined;
      canvas = { path, selected: [], edge: undefined };
      grid = undefined;
      endEdit(true);
      if (other) draw(); else mountCanvas(body);
      return;
    }
    open(body, { start: 0, end: byteLength(text) }, text, '', false, path);
  }

  // --- 画像を持ち込む ------------------------------------------------------
  //
  // Three things can arrive, and they are not the same thing:
  //
  // - **Bytes** (a pasted screenshot, a dropped file). There is no file in the
  //   workspace yet, so the host is asked to make one. A host that finds the
  //   same picture already there hands back the path it is already at — the
  //   workspace does not need a second copy of a picture it holds.
  // - **An address** (a dropped link). Nothing is written to the workspace: the
  //   document says the address, and the build takes the picture into the
  //   output so that the delivered file still needs no network.
  // - **Text.** Not ours; the browser's own paste handles it.

  function onPaste(event: ClipboardEvent): void {
    if (readOnly || !pane.isConnected || !options.createImage) return;
    const data = event.clipboardData;
    if (!data) return;
    const file = [...data.files].find(one => one.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void bring(file, undefined);
  }

  function onDragOver(event: DragEvent): void {
    if (readOnly || !carriesPicture(event)) return;
    event.preventDefault();
    const target = dropTarget(event);
    for (const node of pane.querySelectorAll('.dp-append-over')) node.classList.remove('dp-append-over');
    target?.classList.add('dp-append-over');
  }

  function onDragLeave(event: DragEvent): void {
    if (pane.contains(event.relatedTarget as Node | null)) return;
    for (const node of pane.querySelectorAll('.dp-append-over')) node.classList.remove('dp-append-over');
  }

  function onDrop(event: DragEvent): void {
    if (readOnly || !carriesPicture(event)) return;
    event.preventDefault();
    for (const node of pane.querySelectorAll('.dp-append-over')) node.classList.remove('dp-append-over');
    const at = spanOf(dropTarget(event) ?? lastTarget())?.end;
    const address = addressOf(event.dataTransfer);
    if (address !== undefined) { place(address, at); return; }
    const file = [...(event.dataTransfer?.files ?? [])].find(one => one.type.startsWith('image/'));
    if (file) void bring(file, at);
  }

  /**
   * Where a drop lands: the place under the pointer, or — since the places
   * between blocks take no room — the one after the block under it.
   */
  function dropTarget(event: DragEvent): HTMLElement | undefined {
    const under = event.target as HTMLElement | null;
    const place = under?.closest<HTMLElement>('.dp-append');
    if (place) return place;
    let block = under?.closest<HTMLElement>('[data-span]');
    while (block && !block.parentElement?.classList.contains('dp-sheet')) {
      block = block.parentElement?.closest<HTMLElement>('[data-span]') ?? null;
    }
    const next = block?.nextElementSibling;
    return next instanceof HTMLElement && next.classList.contains('dp-append') ? next : undefined;
  }

  /** Whether a drag is carrying something this editor would take. */
  function carriesPicture(event: DragEvent): boolean {
    const data = event.dataTransfer;
    if (!data) return false;
    if (options.createImage && [...data.items].some(one => one.type.startsWith('image/'))) return true;
    return [...data.types].includes('text/uri-list');
  }

  /** A dropped link, when it points at a picture on the web. */
  function addressOf(data: DataTransfer | null): string | undefined {
    const text = data?.getData('text/uri-list') || data?.getData('text/plain') || '';
    const first = text.split(/\r?\n/).find(line => line.trim() !== '')?.trim() ?? '';
    return isAddress(first) ? first : undefined;
  }

  async function bring(file: File, at: number | undefined): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const made = options.createImage?.({ bytes, name: file.name, type: file.type });
    if (!made) {
      options.onError?.(t('editor.view.imageFailed'));
      return;
    }
    place(made.path, at);
  }

  /** Writes the `@import` line. Where the picture came from no longer matters. */
  function place(path: string, at: number | undefined): void {
    const target = at ?? spanOf(lastTarget())?.end;
    if (target === undefined) return;
    commit(() => ({
      span: { start: target, end: target },
      text: `\n\n@import "${path}"`,
      ...described(ed(isAddress(path) ? 'editor.did.refer' : 'editor.did.pasteImage', { path })),
    }), active);
  }

  /** The end of the sheet being looked at: where a paste lands. */
  function lastTarget(): HTMLElement {
    const section = sections[active - 1];
    const targets = section?.querySelectorAll<HTMLElement>('.dp-append');
    return targets?.[targets.length - 1] ?? section ?? pane;
  }

  /** A figure holding a picture: a file with no text behind it, or an address. */
  function isPicture(path: string): boolean {
    return PICTURE.test(path) || isAddress(path);
  }

  /**
   * Opens a picture. There is no source to show, so what opens is the handle
   * and the three buttons — the only things about a picture the document can
   * say, and both of them live on the `@import` line.
   */
  function beginPictureEdit(figure: HTMLElement): void {
    const path = figure.dataset['path'];
    if (!path) return;
    if (picture?.path === path) return;
    const other = grid !== undefined || canvas !== undefined;
    picture = { path };
    grid = undefined;
    canvas = undefined;
    endEdit(true);
    if (other) draw();
    else mountPictureControls(figure);
  }

  function mountPictureControls(figure: HTMLElement): void {
    const span = spanOf(figure);
    if (!span) return;
    const line = sliceBytes(source, span.start, span.end);
    pictureControls = mountPicture({
      locale: settings.locale,
      owner,
      figure,
      align: importAttribute(line, 'align'),
      width: importAttribute(line, 'width'),
      onAlign: value => writeImport(figure, 'align', value),
      onWidth: percent => writeImport(figure, 'width', percent === 0 ? undefined : `${percent}%`),
    });
  }

  // --- Mermaid の見せ方 --------------------------------------------------

  const VIEW_LABEL: Readonly<Record<MermaidView, 'editor.mermaid.diagram' | 'editor.mermaid.code' | 'editor.mermaid.both'>> = {
    diagram: 'editor.mermaid.diagram', code: 'editor.mermaid.code', both: 'editor.mermaid.both',
  };

  /**
   * The switch between a Mermaid block's drawing and its code. The choice is
   * written into the document — on the fence's opening line, or on the
   * `@import` line of a `.mmd` file — so the delivered file shows what was
   * chosen here. Editor chrome; never in the output.
   */
  function addMermaidSwitch(block: HTMLElement): void {
    const figure = block.closest<HTMLElement>('.dp-figure');
    const ranged = figure ?? block;
    // A block pulled in from another document is that document's to change.
    if (ranged.closest('[data-doc]') || !spanOf(ranged)) return;
    const current = viewOf(block.dataset['view']);
    const bar = element('div', 'dp-mermaid-switch');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', t('editor.mermaid.switch'));
    for (const view of ['diagram', 'code', 'both'] as const) {
      const button = element('button', 'dp-mermaid-choice') as HTMLButtonElement;
      button.type = 'button';
      button.textContent = t(VIEW_LABEL[view]);
      button.setAttribute('aria-pressed', String(view === current));
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setMermaidView(ranged, figure !== null, view);
      });
      bar.append(button);
    }
    block.prepend(bar);
  }

  /**
   * A button that copies a code block as written — without the colours, the
   * language label or anything else the page added. Editor chrome; never in
   * the output, where a reader selects the text instead.
   */
  function addCopyButton(block: HTMLElement): void {
    const code = block.querySelector('pre');
    if (!code) return;
    let head = block.querySelector<HTMLElement>(':scope > .dp-code-head');
    if (!head) {
      head = element('div', 'dp-code-head');
      block.prepend(head);
    }
    const button = element('button', 'dp-code-copy') as HTMLButtonElement;
    button.type = 'button';
    button.textContent = t('editor.copy');
    button.title = t('editor.copyTitle');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      // The line break that closes the last line is the block's, not the code's.
      void copyText((code.textContent ?? '').replace(/\n$/, '')).then(done => {
        button.textContent = t(done ? 'editor.copied' : 'editor.copyFailed');
        owner.defaultView?.setTimeout(() => { button.textContent = t('editor.copy'); }, 1500);
      });
    });
    head.append(button);
  }

  /** The clipboard, or the older way where the clipboard API is not allowed. */
  async function copyText(text: string): Promise<boolean> {
    try {
      await owner.defaultView?.navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = owner.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed; left:-9999px; top:0;';
      owner.body.append(area);
      area.select();
      const done = owner.execCommand('copy');
      area.remove();
      return done;
    }
  }

  function setMermaidView(ranged: HTMLElement, imported: boolean, view: MermaidView): void {
    const span = spanOf(ranged);
    if (!span) return;
    const line = sliceBytes(source, span.start, span.end);
    // The drawing is what a block shows unless told otherwise, so choosing it
    // removes the attribute rather than writing the default down.
    const written = imported
      ? setImportAttribute(line, 'view', view === 'diagram' ? undefined : view)
      : setFenceView(line, view);
    if (written === line) return;
    commit(() => ({
      span, text: written, ...described(ed('editor.did.mermaid', { view: ed(VIEW_LABEL[view]) })),
    }), active);
  }

  /** One attribute of the `@import` line that placed a figure. */
  function writeImport(figure: HTMLElement, name: string, value: string | undefined): void {
    const span = spanOf(figure);
    if (!span) return;
    const line = sliceBytes(source, span.start, span.end);
    const written = setImportAttribute(line, name, value);
    if (written === line) return;
    const said: Phrase = name === 'align'
      ? ed(value === undefined ? 'editor.did.alignLeft'
        : value === 'center' ? 'editor.did.alignCenter' : 'editor.did.alignRight')
      : (value === undefined ? ed('editor.did.unwidth') : ed('editor.did.width.set', { value }));
    commit(() => ({ span, text: written, ...described(said) }), active);
  }

  // --- 図の拡大・縮小 ----------------------------------------------------------

  /** How far each drawing is zoomed, by its path, so a redraw keeps it. */
  const zooms = new Map<string, number | undefined>();

  /**
   * Puts the zoom on a drawing. The drawing goes into a frame of its own that
   * scrolls once it outgrows the page; the buttons stay on the figure's
   * corner. Editor chrome: the output is built from the source, not from here.
   */
  function addZoom(figure: HTMLElement): void {
    const body = figure.querySelector<HTMLElement>(':scope > .dp-figure-body');
    const svg = body?.querySelector<SVGSVGElement>(':scope > svg.dp-diagram');
    if (!body || !svg) return;
    const frame = element('div', 'dp-zoom-scroll');
    svg.replaceWith(frame);
    frame.append(svg);
    const key = figure.dataset['path'] ?? '';
    attachZoom(body, frame, () => frame.querySelector<SVGSVGElement>(':scope > svg'), {
      locale: settings.locale,
      initial: zooms.get(key),
      onChange: next => {
        zooms.set(key, next);
        options.onZoom?.(figure);
      },
    });
  }

  // --- 図表の名前（ファイル名・題・ラベル） ------------------------------------

  /** A figure this document placed. One pulled in from another document is that document's to name. */
  function nameable(figure: HTMLElement): boolean {
    return options.nameFigures !== false && !figure.closest('[data-doc]')
      && spanOf(figure) !== undefined && !!figure.dataset['path'];
  }

  /** The button that opens the form. Editor chrome; never in the output. */
  function addNamesButton(figure: HTMLElement): void {
    if (!nameable(figure)) return;
    const button = element('button', 'dp-figure-names') as HTMLButtonElement;
    button.type = 'button';
    button.textContent = t('editor.figure.button');
    button.title = t('editor.figure.buttonTitle');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openNames(figure);
    });
    // Taking it out is one button and a question, not two buttons: which of
    // the two the author meant is asked when it matters.
    const remove = element('button', 'dp-figure-delete') as HTMLButtonElement;
    remove.type = 'button';
    remove.textContent = t('editor.delete.button');
    remove.title = t('editor.delete.buttonTitle');
    remove.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openDelete(figure);
    });
    const tools = element('span', 'dp-figure-tools');
    tools.append(button, remove);
    figure.prepend(tools);
  }

  /**
   * Asks whether the figure leaves only this document or its file goes too,
   * and does that: the `@import` line out of the document as one edit, and
   * the file, when asked, by the host — which keeps a file another document
   * or drawing still uses, and says so.
   */
  function openDelete(figure: HTMLElement): void {
    const span = spanOf(figure);
    const path = figure.dataset['path'];
    if (!span || !path) return;
    endEdit(true);
    namesForm?.close();
    const line = sliceBytes(source, span.start, span.end);
    const label = /\{[^}]*#([A-Za-z0-9_-]+)/.exec(line)?.[1];
    const rest = sliceBytes(source, 0, span.start) + sliceBytes(source, span.end, byteLength(source));
    const referred = label === undefined ? 0
      : rest.split(`@${label}`).length - 1;
    const twice = rest.includes(`@import "${path}"`);
    const fileFixed = isAddress(path) ? t('editor.figure.fixedAddress')
      : options.deleteResource === undefined ? t('editor.delete.fileHere')
        : twice ? t('editor.delete.fileTwice') : undefined;

    deleteForm = openFigureDelete({
      owner,
      root,
      locale: settings.locale,
      path,
      fileFixed,
      referred,
      label,
      onClose: () => { deleteForm = undefined; },
      onChoose: choice => {
        if (grid?.path === path) grid = undefined;
        if (canvas?.path === path) canvas = undefined;
        if (picture?.path === path) picture = undefined;
        const removed = removeImportLine(source, span);
        commit(() => ({
          ...removed,
          ...described(ed(choice === 'file' ? 'editor.did.deleteFile' : 'editor.did.deleteReference', { path })),
        }), active);
        // The document no longer names it, so taking the line back is all an
        // undo can do here; the file goes to the host's bin.
        if (choice === 'file') return options.deleteResource?.(path);
        return undefined;
      },
    });
  }

  /**
   * Asks for a figure's file name, caption and label, and writes what changed:
   * the file is moved by the host, and this document is rewritten as one edit
   * — the `@import` lines that name the file and every `@label` that named the
   * figure.
   */
  function openNames(figure: HTMLElement): void {
    const span = spanOf(figure);
    const path = figure.dataset['path'];
    if (!span || !path) return;
    endEdit(true);
    namesForm?.close();
    const line = sliceBytes(source, span.start, span.end);
    const slash = path.lastIndexOf('/');
    const folder = path.slice(0, slash + 1);
    const file = path.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    const extension = dot > 0 ? file.slice(dot) : '';
    const fixedName = isAddress(path) ? t('editor.figure.fixedAddress')
      : options.moveResource ? undefined : t('editor.figure.fixedHere');

    namesForm = openFigureNames({
      owner,
      root,
      locale: settings.locale,
      folder,
      extension,
      fixedName,
      prefix: labelPrefixFor(path),
      value: {
        name: dot > 0 ? file.slice(0, dot) : file,
        caption: importAttribute(line, 'caption') ?? '',
        label: /\{[^}]*#([A-Za-z0-9_-]+)/.exec(line)?.[1] ?? '',
        page: importAttribute(line, 'page') ?? '',
      },
      onClose: () => { namesForm = undefined; },
      onSubmit: value => {
        const moved = fixedName === undefined ? `${folder}${value.name}${extension}` : path;
        let change;
        try {
          change = renameFigure(source, span, {
            caption: value.caption, label: value.label, page: value.page, ...(moved === path ? {} : { path: moved }),
          });
        } catch (error) {
          return explain(error);
        }
        if (moved !== path) {
          const refused = options.moveResource!(path, moved);
          if (refused !== undefined) return refused;
          // Whatever was open on the figure follows it to its new name.
          if (grid?.path === path) grid = { ...grid, path: moved };
          if (canvas?.path === path) canvas = { ...canvas, path: moved };
          if (picture?.path === path) picture = { path: moved };
        }
        // The file has moved, and taking back the line that names it would
        // leave the document pointing at a file that is not there. The history
        // before it describes a file under its old name, so it goes too.
        if (moved !== path) history.clear();
        if (change) {
          const done = change;
          commit(() => ({ ...done, ...described(ed('editor.did.names', { path: moved })) }), active,
            moved === path);
        } else if (moved !== path) {
          draw();
        }
        return undefined;
      },
    });
  }

  /** Whether the file behind a figure can be shown as what it is. */
  function readable(path: string, text: string): boolean {
    try {
      if (path.toLowerCase().endsWith('.table')) parseTable(text);
      else if (path.toLowerCase().endsWith('.dgm')) {
        withParts(parseDiagram(text), used => options.readResource?.(joinPath(path, used)));
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Builds the grid from the file as it stands; the grid keeps no copy. */
  function mountGrid(body: HTMLElement): void {
    const current = grid;
    if (!current) return;
    const text = options.readResource?.(current.path);
    if (text === undefined) return;

    let table;
    try {
      table = parseTable(text);
    } catch (error) {
      options.onError?.(explain(error));
      grid = undefined;
      return;
    }

    mounted = createGrid({
      locale: settings.locale,
      owner,
      table,
      source: text,
      at: current.at,
      target: current.target,
      apply: (make, next) => {
        // Only move the selection if the grid is still open. A write-back that
        // arrives as the grid is closing must still be applied, but it must
        // not bring the grid back.
        // Spread the live state, not the one captured when the grid was
        // built: the target may have been changed since.
        if (grid?.path === current.path) grid = { ...grid, at: next };
        commit(() => {
          try {
            return { ...make(), path: current.path };
          } catch (error) {
            if (error instanceof TableEditError) throw new SheetEditError(error.phrase);
            throw error;
          }
        }, active);
      },
      // The grid moves its own selection; the host only remembers where it is,
      // so that a redraw after an edit can put it back.
      move: next => { if (grid) grid = { ...grid, at: next }; },
      onTarget: target => { if (grid) grid = { ...grid, target }; },
      undo: travel,
      choices: itemChoicesFor(current.path, table),
      showSource: () => {
        grid = undefined;
        const source = options.readResource?.(current.path) ?? '';
        open(body, { start: 0, end: byteLength(source) }, source, '', false, current.path);
      },
    });
    body.replaceChildren(mounted.element);
  }

  /**
   * What the cells of a screen's item table are offered; undefined for any
   * other table. The screen is the drawing that names this table, looked for
   * among the drawings the document imports and the workspace has; the types
   * offered besides its guess are this table's and the workspace's other item
   * tables'. Both are read the first time a type cell asks, and once.
   */
  function itemChoicesFor(path: string, table: TableFile): ((at: GridPosition) => CellChoices | undefined) | undefined {
    const headers = table.columns.map(one => one.header);
    if (itemColumns(headers).id === undefined) return undefined;
    const rows = table.rows.map((_, r) => headers.map((_, c) => cellAt(table, r, c)?.text ?? ''));
    const here = joinPath('', path);
    const drawings = (): string[] => [...new Set([
      ...[...source.matchAll(/@import\s+"([^"]+\.dgm)"/gi)].map(match => match[1]!),
      ...(options.listResources?.() ?? []).map(one => one.path).filter(one => /\.dgm$/i.test(one)),
    ])];
    let screen: { file: DiagramFile | undefined } | undefined;
    const findScreen = (): DiagramFile | undefined => {
      for (const drawing of drawings()) {
        const text = options.readResource?.(drawing);
        if (text === undefined) continue;
        try {
          const file = parseDiagram(text);
          if (file.itemTable === undefined || joinPath(drawing, file.itemTable.path) !== here) continue;
          return withParts(file, used => options.readResource?.(joinPath(drawing, used)));
        } catch {
          // A drawing that cannot be read names no table.
        }
      }
      return undefined;
    };
    let others: readonly string[] | undefined;
    const otherTypes = (): readonly string[] => others ??= (options.listResources?.() ?? [])
      .map(one => one.path)
      .filter(one => /\.table$/i.test(one) && joinPath('', one) !== here)
      .flatMap(one => itemTypes(options.readResource?.(one) ?? ''));
    const made = new Map<string, CellChoices | undefined>();
    return at => {
      const key = `${at.row},${at.column}`;
      if (!made.has(key)) {
        made.set(key, itemCellChoices(headers, rows, at.row, at.column, {
          get screen() { return (screen ??= { file: findScreen() }).file; },
          otherTypes,
          locale: settings.locale,
        }));
      }
      return made.get(key);
    };
  }

  /** A screen's item table just made, to be imported once the screen names it. */
  let importAfterLink: string | undefined;

  /**
   * Imports a file on the line after the one that imports `under` — a
   * screen's item table under the screen — unless the document imports it
   * already. One line, so one byte range.
   */
  function importUnder(under: string, path: string): void {
    // Measured on the text read as LF, as every range of the document is.
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    if (lines.some(line => line.trim().startsWith(`@import "${path}"`))) return;
    let at = 0;
    for (const line of lines) {
      at += byteLength(line);
      if (line.trim().startsWith(`@import "${under}"`)) {
        commit(() => ({
          span: { start: at, end: at },
          text: `\n\n@import "${path}"`,
          ...described(ed('editor.did.addTable')),
        }), active);
        return;
      }
      at += 1;
    }
  }

  /** Builds the canvas from the file as it stands; it keeps no copy either. */
  function mountCanvas(body: HTMLElement): void {
    const current = canvas;
    if (!current) return;
    const text = options.readResource?.(current.path);
    if (text === undefined) return;

    let file;
    try {
      file = withParts(parseDiagram(text),
        used => options.readResource?.(joinPath(current.path, used)));
    } catch (error) {
      options.onError?.(explain(error));
      canvas = undefined;
      return;
    }

    const shared = {
      owner,
      file,
      source: text,
      itemSource: file.itemTable === undefined
        ? undefined : options.readResource?.(joinPath(current.path, file.itemTable.path)),
      newItemTable: options.createFile === undefined ? undefined : {
        path: itemTableName(current.path),
        create: (text: string) => {
          const table = joinPath(current.path, itemTableName(current.path));
          const refused = options.createFile?.(table, text);
          // The table goes on the page under the screen, once the screen
          // names it: a list nobody can see is a list nobody edits.
          if (refused === undefined) importAfterLink = table;
          return refused;
        },
      },
      selected: current.selected,
      selectedEdge: current.edge,
      // The zoom the drawing was read at is the zoom it is edited at.
      zoom: zooms.get(current.path),
      onZoom: (next: number | undefined) => { zooms.set(current.path, next); },
      apply: (make: () => Edit, selected: readonly string[], edge?: string | undefined) => {
        if (canvas?.path === current.path) canvas = { ...canvas, selected, edge };
        commit(() => {
          try {
            // An edit to the drawing's item table names the table as the
            // drawing writes it; the document names it from where it stands.
            const made = make();
            const named = (path: string | undefined): string =>
              (path === undefined ? current.path : joinPath(current.path, path));
            return {
              ...made, path: named(made.path),
              ...(made.also ? { also: { ...made.also, path: named(made.also.path) } } : {}),
            };
          } catch (error) {
            if (error instanceof DiagramEditError) throw new SheetEditError(error.phrase);
            throw error;
          }
        }, active);
        const table = importAfterLink;
        importAfterLink = undefined;
        if (table !== undefined) importUnder(current.path, table);
      },
      select: (selected: readonly string[], edge?: string | undefined) => {
        if (canvas) canvas = { ...canvas, selected, edge };
      },
      close: (): void => { canvas = undefined; draw(); },
      ...(options.openFile === undefined ? {} : { openSourceFile: () => options.openFile!(current.path) }),
      showSource: (): void => {
        canvas = undefined;
        const source = options.readResource?.(current.path) ?? '';
        open(body, { start: 0, end: byteLength(source) }, source, '', false, current.path);
      },
      onError: (message: string) => options.onError?.(message),
      locale: settings.locale,
    };

    // An overlay is a picture with callouts on it, already on the page at the
    // image's own scale. It is taken over where it stands rather than drawn
    // again: re-rendering it here would mean resolving the image's path, which
    // is the platform's business and not the editor's.
    if (file.mode === 'overlay') {
      createOverlayEditor({ ...shared, host: body }).focus();
      return;
    }

    const mountedCanvas = createCanvas(shared);
    body.replaceChildren(mountedCanvas.element);
    // Only now is it on the page, so only now can it take the keyboard.
    mountedCanvas.focus();
  }

  /**
   * Starts a new block at the end of a sheet. An empty sheet, or the space
   * after the last block, is the only place with nothing to click — without
   * this there is no way to begin writing at all.
   */
  function beginAppend(host: HTMLElement): void {
    if (editing?.host === host) return;
    const at = spanOf(host)?.end;
    if (at === undefined) return;
    open(host, { start: at, end: at }, '', '\n\n', true, undefined);
  }

  function open(
    host: HTMLElement, span: { start: number; end: number },
    initial: string, prefix: string, fresh: boolean, path: string | undefined,
    merged: readonly HTMLElement[] = [],
  ): void {
    endEdit(true);

    // Where the block is on screen, and where in it the press was, before its
    // source takes its place: the source opens where the reader was looking,
    // with the caret near what they pressed, rather than scrolling the page to
    // the block's last line.
    const before = host.getBoundingClientRect();
    const pressed = press;
    press = undefined;
    const share = pressed ? pressShare(host, before, pressed) : undefined;

    const area = owner.createElement('textarea');
    area.className = 'dp-block-source';
    area.value = initial;
    area.spellcheck = false;
    // The box takes the type of what it is in, so prose is written in prose
    // type — but a heading's is the heading's: large and bold, and the body
    // written under it in the same box read as more heading. A heading's box
    // takes the sheet's own type instead.
    if (/^H[1-6]$/.test(host.tagName)) {
      const body = owner.defaultView?.getComputedStyle(host.closest('.dp-sheet') ?? host.parentElement ?? host);
      if (body) {
        area.style.fontFamily = body.fontFamily;
        area.style.fontSize = body.fontSize;
        area.style.fontWeight = body.fontWeight;
        area.style.fontStyle = body.fontStyle;
        area.style.lineHeight = body.lineHeight;
        area.style.letterSpacing = body.letterSpacing;
        area.style.textTransform = 'none';
      }
    }
    // Cells copied from Excel arrive as tab-separated text, which would land
    // as one long line. A table is what was copied, so a table is written.
    if (path === undefined) {
      area.addEventListener('paste', event => {
        const html = event.clipboardData?.getData('text/html') ?? '';
        const plain = event.clipboardData?.getData('text/plain') ?? '';
        if (!/<table/i.test(html) || !plain.includes('\t')) return;
        const table = tableFromTsv(plain);
        if (table === undefined) return;
        event.preventDefault();
        const before = area.value.slice(0, area.selectionStart);
        const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
        // Through the browser's own insertion, so Ctrl+Z in the box takes it back.
        if (!owner.execCommand('insertText', false, `${lead}${table}\n`)) {
          area.setRangeText(`${lead}${table}\n`, area.selectionStart, area.selectionEnd, 'end');
        }
        area.dispatchEvent(new Event('input'));
      });
    }

    const edit: BlockEdit = { host, original: host.innerHTML, span, area, prefix, fresh, path, initial, merged };
    // What the box holds besides the block it opened in is not shown twice.
    for (const node of merged) node.hidden = true;
    host.classList.add('dp-editing');
    const update = (): void => {
      resize(area);
      toolbar.sync(area.value, area.selectionStart, area.selectionEnd);
    };
    // What `@` and `@import "` can be followed by. A referenced file is a
    // drawing or a table, where neither means anything.
    const suggestions = path === undefined
      ? createSuggestions(owner, area, {
        labels: () => labelCandidates(source, written => options.readResource?.(written), settings.locale),
        files: () => (options.listResources?.() ?? []).map(one => one.path),
        importLabel: t('editor.suggest.import'),
      }, update)
      : undefined;
    // The bar writes Markdown. A table's cells take inline Markdown but its
    // meaning tokens are fills in the style section, and a diagram takes
    // neither — so a bar over a referenced file would write the wrong thing.
    host.replaceChildren(...(path === undefined ? [toolbar.element, area, suggestions!.element] : [area]));
    editing = edit;

    resize(area);
    // A new block is empty; an opened one starts where it was pressed, or at
    // its top when nothing was (a figure's source, opened from its canvas).
    // The caret is placed before the box takes focus: placed after, the
    // browser scrolls the page to show it, from wherever the page was while
    // the box replaced the block — which, for a long block, is the top.
    const caret = fresh ? area.value.length : Math.round((share ?? 0) * area.value.length);
    area.setSelectionRange(caret, caret);
    keepInView(host, before, area, share ?? 0);
    area.focus({ preventScroll: true });
    toolbar.sync(area.value, area.selectionStart, area.selectionEnd);

    /** A change worked out on the text (a list carried on, items moved), applied to the box. */
    const change = (made: TextChange): void => {
      area.setRangeText(made.text, made.start, made.end);
      area.setSelectionRange(made.select.start, made.select.end);
      update();
    };
    area.addEventListener('input', () => { update(); suggestions?.update(); });
    area.addEventListener('select', update);
    area.addEventListener('keyup', event => {
      update();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') suggestions?.update();
    });
    area.addEventListener('click', () => { update(); suggestions?.update(); });
    area.addEventListener('blur', () => endEdit(true));
    area.addEventListener('keydown', event => {
      event.stopPropagation();
      // An open list of suggestions has the arrows, Enter, Tab and Escape first.
      if (!event.isComposing && suggestions?.key(event)) { event.preventDefault(); return; }
      if (event.key === 'Escape') { event.preventDefault(); endEdit(false); }
      if (event.key === 'Enter') {
        // Enter that confirms a conversion belongs to the input method.
        if (event.isComposing) return;
        event.preventDefault();
        if (isCommit(event, settings.commitKey)) { endEdit(true); return; }
        // Every Enter that is not the commit inserts a line break, including
        // the modified ones a text box would otherwise swallow — and on a list
        // item, the next item's marker with it.
        const list = path === undefined ? enterInList(area.value, area.selectionStart, area.selectionEnd) : undefined;
        if (list) change(list);
        else { area.setRangeText('\n', area.selectionStart, area.selectionEnd, 'end'); update(); }
        return;
      }
      // Tab on list items moves them in or out; anywhere else it leaves the box as it always has.
      if (event.key === 'Tab' && path === undefined && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const moved = indentListItems(area.value, area.selectionStart, area.selectionEnd, event.shiftKey);
        if (moved) { event.preventDefault(); change(moved); }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault(); applyFormat('bold');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault(); applyFormat('italic');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault(); applyFormat('code');
      }
    });
  }

  /** Commits the open block, if any. `keep` false throws the changes away. */
  function endEdit(keep: boolean): void {
    const current = editing;
    if (!current) return;
    editing = undefined;
    current.host.classList.remove('dp-editing');

    const typed = current.area.value;
    const whole = current.path === undefined
      ? source
      : options.readResource?.(current.path) ?? '';
    const before = sliceBytes(whole, current.span.start, current.span.end);
    const abandoned = current.fresh ? typed.trim() === '' : typed === before;
    if (!keep || abandoned) {
      // Putting the saved markup back is only safe for a block of prose. A
      // figure's body may have held a live grid, and restoring its HTML would
      // leave a picture of a grid with nothing wired to it — every button
      // clickable and dead. Draw it again instead.
      if (current.path === undefined) {
        current.host.innerHTML = current.original;
        for (const node of current.merged) node.hidden = false;
      } else draw();
      return;
    }
    commit(() => ({
      span: current.span,
      text: current.prefix + typed,
      path: current.path,
      // The path is in the edit; naming it here too would say it twice.
      ...described(ed(current.path !== undefined
        ? 'editor.did.source'
        : current.fresh ? 'editor.did.addText' : 'editor.did.editText')),
    }), active);
  }

  const CLICKABLE = '.dp-grid, .dp-canvas, .dp-canvas-host, .dp-block-source, .dp-format-bar, .dp-caption,'
    + ' .dp-import-line, .dp-figure, .dp-append, .dp-prose, h1, h2, h3, h4, h5, h6';

  function onPointerDown(event: MouseEvent): void {
    // Reading: the press is the browser's, which is how text gets selected.
    if (readOnly) return;
    // The switch on a Mermaid block is a button, not a way into the text.
    if ((event.target as HTMLElement | null)?.closest('.dp-mermaid-switch, .dp-code-copy, .dp-figure-tools, .dp-zoom-bar')) return;
    // The margin beside a ＋ is only there to keep it under the pointer.
    if ((event.target as HTMLElement | null)?.closest('.dp-append-zone')) return;
    // A right press on a figure is for its menu. Opening the caption or the
    // drawing under it first would replace the element the menu belongs to.
    if (event.button === 2) {
      const pressed = event.target as HTMLElement | null;
      const figure = pressed?.closest<HTMLElement>('.dp-figure');
      if (figure && (nameable(figure) || options.figureMenu)
        && !pressed?.closest('.dp-grid, .dp-canvas, .dp-canvas-host, .dp-block-source')) return;
      // A table written in the prose has its menu too; opening the text would take it away.
      if (!figure && options.tableMenu && pressed?.closest('.dp-prose table')) return;
    }
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(CLICKABLE);
    if (!target || !pane.contains(target)) return;
    // A press inside whatever is already open belongs to it.
    if (target.classList.contains('dp-block-source')) return;
    if (target.classList.contains('dp-format-bar')) return;
    if (target.classList.contains('dp-grid')) return;
    // A press inside the open canvas is the canvas's own gesture. It reaches
    // here only when the browser sent no pointer event, so it is left alone.
    if (target.classList.contains('dp-canvas')) return;
    if (target.classList.contains('dp-canvas-host')) return;

    // We are about to open an editor and focus it. Left to itself the browser
    // would then move focus to whatever was under the pointer — by that time a
    // detached node — and the editor would blur and close on the way up.
    event.preventDefault();
    press = { x: event.clientX, y: event.clientY };

    // Remember what was pressed before closing anything, then find it again:
    // closing redraws, and the element pressed is replaced by an equal one.
    const wanted = {
      span: target.dataset['span'],
      path: target.closest<HTMLElement>('.dp-figure')?.dataset['path'],
      append: target.classList.contains('dp-append'),
      caption: target.classList.contains('dp-caption')
        || target.classList.contains('dp-import-line'),
      figure: target.classList.contains('dp-figure'),
    };

    // A picture's controls belong to that picture. Pressing anything else —
    // another figure, a paragraph, the page — takes them away; no redraw is
    // needed because they are the only thing that was added to the page.
    if (picture !== undefined && wanted.path !== picture.path) {
      picture = undefined;
      pictureControls?.destroy();
      pictureControls = undefined;
    }
    if (canvas !== undefined && !wanted.figure && wanted.path === undefined) {
      canvas = undefined;
      draw();
      return;
    }
    const hadGrid = grid !== undefined;
    if (hadGrid && !wanted.figure && wanted.path === undefined) {
      // Write back the open cell before the grid leaves the page, so nothing
      // typed is lost and no blur arrives after it is gone.
      const open = mounted;
      grid = undefined;
      open?.flush();
      draw();
      return;
    }
    endEdit(true);

    const again = resolve(wanted);
    if (!again) return;
    if (wanted.caption) {
      const figure = again.closest<HTMLElement>('.dp-figure');
      if (figure) beginEdit2(again, figure);
      return;
    }
    if (wanted.figure) {
      const path = again.dataset['path'];
      if (path && isPicture(path)) beginPictureEdit(again);
      else beginResourceEdit(again);
      return;
    }
    if (wanted.append) beginAppend(again);
    else beginEdit(again);
  }

  /** The same element in the page as it stands now. */
  function resolve(wanted: {
    span: string | undefined; path: string | undefined;
    append: boolean; caption: boolean; figure: boolean;
  }): HTMLElement | undefined {
    if (wanted.figure && wanted.path !== undefined) {
      return pane.querySelector<HTMLElement>(
        `.dp-figure[data-path="${cssEscape(wanted.path)}"]`) ?? undefined;
    }
    if (wanted.caption && wanted.path !== undefined) {
      const figure = pane.querySelector<HTMLElement>(
        `.dp-figure[data-path="${cssEscape(wanted.path)}"]`);
      return figure?.querySelector<HTMLElement>('.dp-caption, .dp-import-line') ?? undefined;
    }
    if (wanted.span === undefined) return undefined;
    const matches = [...pane.querySelectorAll<HTMLElement>(`[data-span="${wanted.span}"]`)];
    return matches.find(node => node.classList.contains('dp-append') === wanted.append);
  }

  /** Edits one element's range while showing the box somewhere else. */
  function beginEdit2(host: HTMLElement, ranged: HTMLElement): void {
    if (editing?.host === host) return;
    const span = spanOf(ranged);
    if (!span) return;
    open(host, span, sliceBytes(source, span.start, span.end), '', false, undefined);
  }

  /**
   * A figure with no caption has nothing that stands for the `@import` line,
   * so the editor shows the line itself. Editor chrome; never in the output.
   */
  function addImportTarget(figure: HTMLElement): void {
    if (figure.querySelector('.dp-caption')) return;
    const line = element('div', 'dp-import-line');
    line.textContent = `@import "${figure.dataset['path'] ?? ''}"`;
    figure.append(line);
  }

  /**
   * A place to add something after every block, not only at the end of the
   * sheet. A figure usually belongs next to the paragraph that introduces it,
   * and having to write it at the bottom and drag it up is not adding it
   * there. Editor chrome; never in the output.
   */
  function addInsertTargets(section: HTMLElement): void {
    const blocks = [...section.children].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.dataset['span'] !== undefined);
    section.classList.toggle('dp-sheet-empty', blocks.length === 0);

    if (blocks.length === 0) {
      section.append(insertTarget(section.dataset['span'] ?? '', 'empty'));
      return;
    }
    blocks.forEach((block, i) => {
      block.after(insertTarget(block.dataset['span'] ?? '', i === blocks.length - 1 ? 'end' : 'gap'));
    });
  }

  /**
   * Where something can be added. An empty sheet and the end of a sheet say
   * so and show their buttons: they are where writing begins. Between two
   * blocks the place takes no room at all — the page reads as it does in the
   * reading mode — and offers a ＋ in the margin while the pointer is on the
   * block above it, which opens a menu of what to add.
   */
  function insertTarget(span: string, kind: 'empty' | 'end' | 'gap'): HTMLElement {
    const append = element('div', kind === 'gap' ? 'dp-append dp-append-gap' : 'dp-append');
    // Whatever is added starts where the block before it ends.
    append.dataset['span'] = span;

    if (kind === 'gap') {
      // The zone in the margin keeps the ＋ under the pointer on its way from
      // the block to the button; the line shows where the addition goes.
      const zone = element('span', 'dp-append-zone');
      const plus = owner.createElement('button');
      plus.type = 'button';
      plus.className = 'dp-append-plus';
      plus.textContent = '+';
      plus.title = t('editor.append.plusTitle');
      plus.setAttribute('aria-label', t('editor.append.plusTitle'));
      plus.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        const box = plus.getBoundingClientRect();
        // Whatever is open is written back first. That redraws the page, so
        // the place is found again by where it is in the text.
        const here = settle(append);
        if (here) menu.open(box.right + 4, box.top, addMenu(here, box));
      });
      zone.append(plus);
      append.append(zone);
      return append;
    }

    const hint = element('span', 'dp-append-hint');
    hint.textContent = kind === 'empty' ? t('editor.append.hint') : '';
    // Said by the stylesheet on hover when the sheet is not empty.
    hint.dataset['hint'] = t('editor.append.hint');
    append.append(hint);

    const button = (label: string, title: string, run: (event: MouseEvent) => void): void => {
      const node = owner.createElement('button');
      node.type = 'button';
      node.className = 'dp-append-add';
      node.textContent = label;
      node.title = title;
      node.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        run(event);
      });
      append.append(node);
    };

    if (options.createResource) {
      button(t('editor.append.table'), t('editor.append.tableTitle'), () => addResource(append, 'table'));
      button(t('editor.append.diagram'), t('editor.append.diagramTitle'), () => addResource(append, 'diagram'));
    }
    if (options.listResources) {
      // Most figures in a real document already exist somewhere — in the
      // shared folder, or earlier in this one. Making a second copy of a
      // shared diagram is the thing this prevents.
      button(t('editor.append.refer'), t('editor.append.referTitle'), event => chooseResource(append, event));
    }
    return append;
  }

  /**
   * Closes whatever editor is open, as a press elsewhere on the page would,
   * and returns the place to add at as it is on the page afterwards — or
   * nothing when the edit moved it.
   */
  function settle(append: HTMLElement): HTMLElement | undefined {
    if (!editing && canvas === undefined && grid === undefined) return append;
    const span = append.dataset['span'];
    if (canvas !== undefined) {
      canvas = undefined;
      draw();
    } else if (grid !== undefined) {
      const open = mounted;
      grid = undefined;
      open?.flush();
      draw();
    } else {
      endEdit(true);
    }
    if (append.isConnected) return append;
    return resolve({ span, path: undefined, append: true, caption: false, figure: false });
  }

  /** What the ＋ between two blocks offers: the same things the end of a sheet does, and text. */
  function addMenu(append: HTMLElement, box: DOMRect): MenuItem[] {
    const items: MenuItem[] = [{ label: t('editor.append.menuText'), run: () => beginAppend(append) }];
    if (options.createResource) {
      items.push(
        { label: t('editor.append.menuTable'), run: () => addResource(append, 'table') },
        { label: t('editor.append.menuDiagram'), run: () => addResource(append, 'diagram') },
      );
    }
    if (options.listResources) {
      items.push({
        label: t('editor.append.menuRefer'),
        run: () => chooseResource(append, { clientX: box.right + 4, clientY: box.top } as MouseEvent),
      });
    }
    return items;
  }

  /**
   * Adds a figure or a table: the file is created by the host, and an
   * `@import` line for it is written at the end of the sheet. The caption is
   * left for the author to fill in — a placeholder caption is one more thing
   * to delete.
   */
  /** Picks from what exists. The same `@import` line, pointing at a file that
   *  is already there rather than one just made. */
  function chooseResource(append: HTMLElement, event: MouseEvent): void {
    const available = options.listResources?.() ?? [];
    const at = spanOf(append)?.end;
    if (at === undefined) return;
    if (available.length === 0) {
      options.onError?.(t('editor.append.nothingToRefer'));
      return;
    }
    menu.open(event.clientX, event.clientY, available.map((resource, index) => ({
      label: resource.label,
      separated: index > 0 && shared(resource.path) !== shared(available[index - 1]!.path),
      run: () => commit(() => ({
        span: { start: at, end: at },
        text: `\n\n@import "${resource.path}"`,
        ...described(ed('editor.did.refer', { path: resource.path })),
      }), active),
    })));
  }

  /** Shared resources are grouped apart; the path says which is which. */
  function shared(path: string): boolean {
    return path.includes('shared/');
  }

  function addResource(append: HTMLElement, kind: ResourceKind): void {
    const at = spanOf(append)?.end;
    const made = options.createResource?.(kind);
    if (at === undefined || !made) return;
    options.onChange?.(
      localizeEdit({
        span: { start: 0, end: 0 }, text: made.text, path: made.path,
        ...described(ed('editor.did.create', { path: made.path })),
      }, settings.locale),
      made.text,
    );
    commit(() => ({
      span: { start: at, end: at },
      text: `\n\n@import "${made.path}"`,
      ...described(ed(kind === 'table' ? 'editor.did.addTable' : 'editor.did.addDiagram')),
    }), active);
  }

  /** Paths contain dots and slashes; an attribute selector needs them quoted. */
  function cssEscape(value: string): string {
    return value.replace(/["\\]/g, '\\$&');
  }

  function spanOf(host: HTMLElement): { start: number; end: number } | undefined {
    const raw = host.dataset['span']?.split(',').map(Number);
    if (!raw || raw.length !== 2 || raw.some(Number.isNaN)) return undefined;
    return { start: raw[0]!, end: raw[1]! };
  }

  /**
   * How far through a block's text a press was, from 0 to 1: the row of the
   * block it was on and how far along that row. The source has marks the page
   * does not print, so this is near the word pressed rather than on it — near
   * enough that the caret is on screen and in the right line or two.
   */
  function pressShare(host: HTMLElement, box: DOMRect, at: { x: number; y: number }): number | undefined {
    if (box.height <= 0 || box.width <= 0 || at.y < box.top || at.y > box.bottom) return undefined;
    const style = owner.defaultView?.getComputedStyle(host);
    const line = parseFloat(style?.lineHeight ?? '') || (parseFloat(style?.fontSize ?? '') || 16) * 1.6;
    const rows = Math.max(1, Math.round(box.height / line));
    const row = Math.min(rows - 1, Math.floor(((at.y - box.top) / box.height) * rows));
    const along = Math.min(1, Math.max(0, (at.x - box.left) / box.width));
    return Math.min(1, Math.max(0, (row + along) / rows));
  }

  /**
   * Puts the block back where it was on screen once its source has replaced
   * it, then makes sure the caret's line is showing.
   */
  function keepInView(host: HTMLElement, before: DOMRect, area: HTMLTextAreaElement, share: number): void {
    pane.scrollTop += host.getBoundingClientRect().top - before.top;
    const view = pane.getBoundingClientRect();
    const box = area.getBoundingClientRect();
    const y = box.top + share * box.height;
    if (y < view.top + 24 || y > view.bottom - 24) pane.scrollTop += y - (view.top + view.height / 2);
  }

  function resize(area: HTMLTextAreaElement): void {
    // Measuring at `auto` makes a long box short for a moment, and the page
    // with it: the browser pulls the scroll back to fit, and the reader is
    // sent to the top. The scroll is put back once the box has its height.
    const keep = pane.scrollTop;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
    if (pane.scrollTop !== keep) pane.scrollTop = keep;
  }

  function sheets(): readonly Sheet[] {
    const document = parseDocument(source);
    return sheetsOf(document, undefined);
  }

  /**
   * Runs one operation, re-renders, and keeps the named sheet selected. An
   * edit that the document parser then refuses is rolled back: editing raw
   * Markdown makes an unparsable document reachable, and a broken editor is
   * worse than a refused keystroke.
   */
  function commit(make: () => Edit, select: number, record = true): boolean {
    let edit: Edit;
    try {
      edit = make();
    } catch (error) {
      if (error instanceof SheetEditError) { options.onError?.(explain(error)); return false; }
      throw error;
    }

    const previous = source;
    const before = edit.path === undefined ? undefined : options.readResource?.(edit.path);
    const written = applyEdit(
      edit.path === undefined ? source : before ?? '', edit,
    );
    if (edit.path === undefined) source = written;
    const said = localizeEdit(edit, settings.locale);
    options.onChange?.(said, written);
    // The other file the same gesture changed, written before anything is
    // drawn: the drawing is drawn from both.
    const also = edit.also;
    const alsoBefore = also?.path === undefined ? undefined : options.readResource?.(also.path);
    const alsoWritten = also === undefined || alsoBefore === undefined ? undefined : applyEdit(alsoBefore, also);
    if (also && alsoWritten !== undefined) options.onChange?.(said.also ?? also, alsoWritten);

    try {
      active = Math.max(1, Math.min(select, sheets().length));
      draw();
    } catch (error) {
      source = previous;
      if (edit.path !== undefined && before !== undefined) {
        options.onChange?.({ ...edit, phrase: undefined, description: t('editor.did.undo') }, before);
      }
      if (also && alsoBefore !== undefined) {
        options.onChange?.({ ...also, phrase: undefined, description: t('editor.did.undo') }, alsoBefore);
      }
      draw();
      options.onError?.(explain(error));
      return false;
    }
    // A file that did not exist before has no text to go back to. Writing an
    // empty one would not be taking the edit back.
    const from = edit.path === undefined ? previous : before;
    if (record && from !== undefined) {
      history.record({
        path: edit.path, before: from, after: written, description: said.description, sheet: active,
        ...(also && alsoBefore !== undefined && alsoWritten !== undefined
          ? { also: { path: also.path, before: alsoBefore, after: alsoWritten } } : {}),
      });
    }
    return true;
  }

  /**
   * Takes the last edit back, or makes the last one taken back again, as one
   * more byte-range edit through `commit` — so the host writes it like any
   * other, and a VS Code undo would take *that* back.
   */
  function travel(redo: boolean): void {
    const step = redo ? history.nextRedo() : history.nextUndo();
    if (!step) return;
    const current = step.path === undefined ? source : options.readResource?.(step.path);
    const change = redo ? redoing(step, current) : undoing(step, current);
    if (!change) {
      history.clear();
      options.onError?.(t(redo ? 'editor.redo.stale' : 'editor.undo.stale', { what: step.description }));
      return;
    }
    // The other file goes back with it, if it is still as the step left it.
    const also = step.also;
    const alsoNow = also === undefined ? undefined : also.path === undefined ? source : options.readResource?.(also.path);
    const alsoChange = also === undefined ? undefined : redo ? redoing({ ...step, ...also }, alsoNow) : undoing({ ...step, ...also }, alsoNow);
    const description = t(redo ? 'editor.did.redoOf' : 'editor.did.undoOf', { what: step.description });
    const done = commit(() => ({
      ...change,
      path: step.path,
      description,
      ...(also && alsoChange ? { also: { ...alsoChange, path: also.path, description } } : {}),
    }), step.sheet, false);
    if (!done) return;
    if (redo) history.redone(); else history.undone();
  }

  /** Rebuilds everything. Only an edit needs this. */
  /**
   * Where the reader is, in terms that survive the page being rebuilt.
   *
   * A redraw replaces every node, so a remembered element is no help. What does
   * survive is a block's byte range: the topmost block still on screen, and how
   * far below the top of the pane it was sitting. An edit moves the ranges of
   * everything after it, so the block that is found again is one *before* the
   * edit — which is exactly the part of the page the reader is looking at.
   */
  interface Place {
    readonly span: string | undefined;
    readonly offset: number;
    readonly scroll: number;
    /** The sheet it was on. Landing on another one is a change of subject. */
    readonly sheet: number;
  }

  function placeOf(): Place | undefined {
    if (pane.scrollTop === 0) return undefined;
    const top = pane.getBoundingClientRect().top;
    // Blocks only. A sheet also carries a range, but it begins far above the
    // viewport and tells us nothing about where in it the reader is.
    for (const node of pane.querySelectorAll<HTMLElement>(ANCHOR)) {
      const box = node.getBoundingClientRect();
      // A block on a sheet that is not showing has no box at all. Left in, it
      // answers "at the top of the pane" for every question asked of it.
      if (box.height === 0) continue;
      if (box.bottom <= top) continue;
      return { span: node.dataset['span'], offset: box.top - top, scroll: pane.scrollTop, sheet: active };
    }
    return { span: undefined, offset: 0, scroll: pane.scrollTop, sheet: active };
  }

  const ANCHOR = '[data-span]:not(.dp-append):not(.dp-sheet)';

  function restore(place: Place | undefined): void {
    if (!place) return;
    // An edit that moves to another sheet has changed the subject after all.
    if (place.sheet !== active) { refresh(); return; }
    const settle = (): void => {
      const again = place.span === undefined
        ? null
        : pane.querySelector<HTMLElement>(`[data-span="${place.span}"]:not(.dp-append)`);
      if (!again) {
        // The block the reader was on is the one that changed, so its range
        // moved. Putting the scrollbar back is the nearest true answer.
        pane.scrollTop = place.scroll;
        return;
      }
      pane.scrollTop += again.getBoundingClientRect().top - pane.getBoundingClientRect().top
        - place.offset;
    };
    settle();
    // A picture has no size until it is decoded, so the page is briefly shorter
    // than it will be and the first answer can be clamped. Asking again once
    // the frame is laid out costs nothing and is right either way.
    owner.defaultView?.requestAnimationFrame(settle);
  }

  /**
   * Heading numbers hang in the margin with their left edges in one line, at
   * the room the widest number in the whole document needs. Hung by their
   * right edges instead, a deeper number — longer — would reach further left
   * and read as if it were the higher level.
   */
  function alignHeadingNumbers(page: HTMLElement): void {
    const view = owner.defaultView;
    if (!view) return;
    let room = 0;
    for (const number of page.querySelectorAll<HTMLElement>(':is(h2, h3, h4) > .dp-number:first-child')) {
      const size = parseFloat(view.getComputedStyle(number).fontSize) || 16;
      // Measured where it can be, estimated where its sheet is hidden.
      const width = number.offsetWidth || (number.textContent ?? '').length * size * 0.62;
      room = Math.max(room, width);
    }
    const base = parseFloat(view.getComputedStyle(page).fontSize) || 16;
    // Never past the margin, where it would leave the page.
    page.style.setProperty('--dp-number-room', `${Math.min(room + base * 0.6, base * 5.2)}px`);
  }

  function draw(): void {
    // An edit is not a change of subject: the reader stays where they were.
    const place = placeOf();
    const page = element('div', 'dp-page');
    page.innerHTML = render(source);
    // The paper the document names: the page is shown at that size, so what
    // is written is seen as wide as it will be printed.
    const paper = paperIn(source);
    if (paper) {
      page.dataset['paper'] = paper.name;
      page.style.cssText = paperStyle(paper);
    }
    pane.replaceChildren(page);
    editing = undefined;
    sections = [...page.querySelectorAll<HTMLElement>('.dp-sheet')];
    for (const section of sections) addInsertTargets(section);
    for (const figure of page.querySelectorAll<HTMLElement>('.dp-figure')) addImportTarget(figure);
    for (const figure of page.querySelectorAll<HTMLElement>('.dp-figure')) addNamesButton(figure);
    for (const block of page.querySelectorAll<HTMLElement>('.dp-mermaid')) addMermaidSwitch(block);
    for (const block of page.querySelectorAll<HTMLElement>('.dp-code')) addCopyButton(block);
    for (const figure of page.querySelectorAll<HTMLElement>('.dp-figure')) addZoom(figure);
    // A screenshot with callouts shrinks to the page, its numbers with it.
    fitOverlays(page);
    options.decorate?.(page);
    alignHeadingNumbers(page);
    if (grid) {
      const figure = page.querySelector<HTMLElement>(`.dp-figure[data-path="${cssEscape(grid.path)}"]`);
      const body = figure?.querySelector<HTMLElement>('.dp-figure-body');
      if (body) mountGrid(body);
      else { grid = undefined; mounted = undefined; }
    } else {
      mounted = undefined;
    }
    if (canvas) {
      const figure = page.querySelector<HTMLElement>(`.dp-figure[data-path="${cssEscape(canvas.path)}"]`);
      const body = figure?.querySelector<HTMLElement>('.dp-figure-body');
      if (body) mountCanvas(body);
      else canvas = undefined;
    }
    pictureControls?.destroy();
    pictureControls = undefined;
    if (picture) {
      const figure = page.querySelector<HTMLElement>(`.dp-figure[data-path="${cssEscape(picture.path)}"]`);
      if (figure) mountPictureControls(figure);
      else picture = undefined;
    }

    drawTabs(sections.map((section, i) => ({
      title: section.dataset['title'] ?? t('editor.sheet.untitled', { index: i + 1 }),
      empty: section.textContent?.trim() === '',
    })));
    refresh('keep');
    restore(place);
  }

  /**
   * Changes only what selecting a sheet changes. Switching tabs must not
   * rebuild the tab bar: a rebuild replaces the element mid-gesture, so the
   * second half of a double-click lands on a node that is no longer there.
   */
  function refresh(place: 'top' | 'keep' = 'top'): void {
    pane.classList.toggle('dp-continuous', continuous);
    sections.forEach((section, i) => {
      section.hidden = !continuous && i + 1 !== active;
    });
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i + 1 === active));
    });
    // Choosing a sheet is a change of subject and starts at its top. A redraw
    // after an edit is not: the caller puts the reader back where they were.
    if (place === 'keep') return;
    if (continuous) sections[active - 1]?.scrollIntoView({ block: 'start' });
    else pane.scrollTop = 0;
  }

  function drawTabs(labels: readonly { title: string; empty: boolean }[]): void {
    tabbar.replaceChildren();
    tabs = [];

    labels.forEach((label, i) => {
      const index = i + 1;
      const tab = element('button', 'dp-tab') as HTMLButtonElement;
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.dataset['index'] = String(index);
      if (label.empty) tab.dataset['empty'] = 'true';
      tab.draggable = true;
      tab.append(owner.createTextNode(label.title));

      tab.addEventListener('click', () => select(index));
      tab.addEventListener('dblclick', () => { if (!readOnly) beginRename(tab, index, label.title); });
      tab.addEventListener('dragstart', event => {
        if (readOnly) { event.preventDefault(); return; }
        dragging = index;
        event.dataTransfer?.setData('text/plain', String(index));
      });
      tab.addEventListener('dragover', event => {
        event.preventDefault();
        if (dragging === undefined || dragging === index) return;
        tab.classList.add(dragging < index ? 'dp-drop-after' : 'dp-drop-before');
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('dp-drop-before', 'dp-drop-after');
      });
      tab.addEventListener('drop', event => {
        event.preventDefault();
        const from = dragging;
        dragging = undefined;
        if (from === undefined || from === index) return;
        commit(() => moveSheet(parseDocument(source), source, from, index), index);
      });

      if (labels.length > 1) {
        const close = element('button', 'dp-tab-close') as HTMLButtonElement;
        close.type = 'button';
        close.textContent = '×';
        close.title = t('editor.sheet.removeTitle');
        close.addEventListener('click', event => {
          event.stopPropagation();
          if (readOnly) return;
          commit(() => removeSheet(parseDocument(source), source, index), Math.max(1, index - 1));
        });
        tab.append(close);
      }
      tabs.push(tab);
      tabbar.append(tab);
    });

    const add = element('button', 'dp-tab dp-tab-add') as HTMLButtonElement;
    add.type = 'button';
    add.textContent = '＋';
    add.title = t('editor.sheet.addTitle');
    add.addEventListener('click', () => {
      if (readOnly) return;
      const last = labels.length;
      commit(() => insertSheet(parseDocument(source), source, last), last + 1);
    });
    tabbar.append(add, element('div', 'dp-tabbar-spacer'));

    tabbar.append(paperChoice());

    const toggle = element('button', 'dp-tabbar-toggle') as HTMLButtonElement;
    toggle.type = 'button';
    toggle.textContent = t('editor.sheet.showAll');
    toggle.setAttribute('aria-pressed', String(continuous));
    toggle.addEventListener('click', event => {
      continuous = !continuous;
      (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(continuous));
      refresh();
    });
    tabbar.append(toggle);
  }

  /**
   * The paper, chosen from the tab bar: written in the front matter, where
   * the PDF and the screen both read it.
   */
  function paperChoice(): HTMLSelectElement {
    const select = element('select', 'dp-tabbar-paper') as HTMLSelectElement;
    select.title = t('editor.paper.title');
    select.disabled = readOnly;
    const add = (value: string, label: string): void => {
      const option = owner.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    };
    add('', t('editor.paper.default'));
    for (const name of PAPER_NAMES) {
      if (name === 'slide') { add(paperValue(name, 'landscape'), t('editor.paper.slide')); continue; }
      if (name === 'slide-4:3') { add(paperValue(name, 'landscape'), t('editor.paper.slide43')); continue; }
      add(paperValue(name, 'portrait'), `${name} ${t('editor.paper.portrait')}`);
      add(paperValue(name, 'landscape'), `${name} ${t('editor.paper.landscape')}`);
    }
    const now = paperIn(source);
    select.value = now ? paperValue(now.name, now.orientation) : '';
    // A paper written some other way (`b5`, `orientation: 横`) still shows.
    if (now && select.value === '') {
      add(paperValue(now.name, now.orientation), `${now.name} ${t(now.orientation === 'landscape' ? 'editor.paper.landscape' : 'editor.paper.portrait')}`);
      select.value = paperValue(now.name, now.orientation);
    }
    select.addEventListener('change', () => {
      const value = select.value === '' ? undefined : select.value;
      commit(() => {
        // The orientation goes into the one value; a line of its own would
        // say it twice, and could say it differently.
        const first = setFrontmatterKey(source, 'orientation', undefined);
        const second = setFrontmatterKey(applyEdit(source, { ...first, ...described(ed('editor.did.paperDefault')) }), 'paper', value);
        const span = first.text === '' && first.span.start === first.span.end ? second.span : first.span;
        return {
          span, text: second.text,
          ...described(value === undefined ? ed('editor.did.paperDefault') : ed('editor.did.paper', { paper: value })),
        };
      }, active);
    });
    return select;
  }

  /** What the document's front matter says about the paper; nothing when it says nothing or will not read. */
  function paperIn(text: string): Paper | undefined {
    try { return paperOf(parseDocument(text).frontmatter.raw); } catch { return undefined; }
  }

  /** Renaming edits the heading the name comes from; there is no other name. */
  function beginRename(tab: HTMLElement, index: number, title: string): void {
    // The tab keeps the width it had. Letting the box size itself shifts every
    // tab to its right while the name is being typed.
    tab.style.width = `${tab.getBoundingClientRect().width}px`;
    const input = element('input', 'dp-tab-rename') as HTMLInputElement;
    input.value = title;
    tab.replaceChildren(input);
    input.focus();
    input.select();

    // Committing replaces the tab, which blurs the input, which would ask to
    // commit again — on a tree that no longer exists. Once is enough.
    let done = false;
    const finish = (accept: boolean): void => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      tab.style.width = '';
      if (!accept || name === '' || name === title) { draw(); return; }
      commit(() => renameSheet(parseDocument(source), source, index, name, path => options.readResource?.(path)), index);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      event.stopPropagation();
    });
  }

  function select(index: number): void {
    active = Math.max(1, Math.min(index, sections.length || 1));
    refresh();
  }

  // Ctrl+PageUp / PageDown move between sheets, as in a spreadsheet.
  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo — unless a box that takes
  // text has the keyboard, where they belong to what is being typed.
  const onKeyDown = (event: KeyboardEvent): void => {
    const step = undoKey(event);
    if (step !== undefined) {
      if (readOnly || editing || takesText(event.target)) return;
      event.preventDefault();
      // Stopped here so that a host listening further out — VS Code forwards
      // the keys a webview leaves alone — does not undo the document as well.
      event.stopPropagation();
      travel(step === 'redo');
      return;
    }
    if (!event.ctrlKey || editing) return;
    if (event.key === 'PageDown') { event.preventDefault(); select(active + 1); }
    if (event.key === 'PageUp') { event.preventDefault(); select(active - 1); }
  };
  owner.addEventListener('keydown', onKeyDown);

  draw();

  return {
    get source() { return source; },
    get active() { return active; },
    select,
    sourceSelection() {
      const current = editing;
      if (!current || current.fresh) return undefined;
      const { area } = current;
      if (area.value !== current.initial || area.selectionStart === area.selectionEnd) return undefined;
      const text = area.value.slice(area.selectionStart, area.selectionEnd);
      if (text.trim() === '') return undefined;
      const start = current.span.start + byteLength(area.value.slice(0, area.selectionStart));
      return { path: current.path, start, end: start + byteLength(text), text };
    },
    setReadOnly(on) {
      if (on === readOnly) return;
      if (on) {
        // Whatever was open is put away first, so nothing typed is lost.
        endEdit(true);
        namesForm?.close();
        deleteForm?.close();
        grid = undefined;
        canvas = undefined;
        picture = undefined;
      }
      readOnly = on;
      root.classList.toggle('dp-readonly', on);
      draw();
    },
    configure(next) {
      const relabel = next.locale !== settings.locale;
      settings = next;
      if (!relabel) return;
      // Everything on screen is in the old language. What is being typed is
      // kept — closing the block commits it — and the page is drawn again in
      // the new one, from the same place.
      if (editing) endEdit(true);
      t = EDITOR_MESSAGES.in(settings.locale);
      toolbar = createToolbar(owner, applyFormat, settings.locale);
      draw();
    },
    destroy() {
      owner.removeEventListener('keydown', onKeyDown);
      owner.removeEventListener('paste', onPaste);
      pictureControls?.destroy();
      namesForm?.close();
      deleteForm?.close();
      root.replaceChildren();
      root.classList.remove('dp-editor');
    },
  };
}

/** A text box, a text area or anything editable: it has an undo of its own. */
function takesText(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.isContentEditable || node.closest('input, textarea, select') !== null;
}

function injectStyle(document: Document): void {
  if (document.getElementById('dp-editor-style')) return;
  const style = document.createElement('style');
  style.id = 'dp-editor-style';
  // Each package styles its own chrome; the shell puts them together. Opening
  // the drawing editor on its own needs only the first two.
  style.textContent = [BASE_STYLE, DIAGRAM_STYLE, EDITOR_STYLE].join('\n');
  document.head.append(style);
  // Its dark counterpart, inert until the host turns the screen dark.
  useDarkStyle(document, 'editor', style.textContent);
  // KaTeX's own, apart: its fonts make it large, and it paints no colours to turn round.
  injectMathStyle(document);
}
