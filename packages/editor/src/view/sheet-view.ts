// The sheet view: one sheet on screen at a time, with tabs along the bottom.
//
// The view owns no model of its own. It holds the source text, asks the caller
// to render it, and turns every gesture into one of the sheet operations —
// which are byte-range edits. That means what the screen shows and what the
// file contains can never drift apart: there is only the file.

import {
  PICTURE, importAttribute, isAddress, joinPath, labelPrefixFor, parseDocument, parseTable,
  renameFigure, setFenceView, setImportAttribute, sheetsOf, viewOf, type MermaidView, type Sheet,
} from '@docpresenter/markdown';
import { parseDiagram, withParts } from '@docpresenter/diagram';
import {
  applyEdit, byteLength, describeError, described, localizeEdit, sliceBytes, toggleInline,
  type Edit, type InlineMark, type Phrase,
} from '@docpresenter/base';
import { EDITOR_MESSAGES, ed } from '../messages.js';
import { DEFAULT_SETTINGS, isCommit, type EditorSettings } from '../settings.js';
import { insertSheet, moveSheet, removeSheet, renameSheet, SheetEditError } from '../sheets.js';
import { DiagramEditError } from '@docpresenter/diagram';
import { TableEditError } from '../table.js';
import { createCanvas } from '@docpresenter/diagram';
import { createOverlayEditor } from '@docpresenter/diagram';
import { createGrid, type Grid, type GridPosition } from './grid.js';
import { createMenu } from '@docpresenter/base';
import { EDITOR_STYLE } from './style.js';
import { BASE_STYLE } from '@docpresenter/base';
import { DIAGRAM_STYLE } from '@docpresenter/diagram';
import { createToolbar } from '@docpresenter/base';
import { mountPicture, type Align, type PictureControls } from './picture.js';
import { openFigureNames, type FigureNamesForm } from './figure-names.js';

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
  /** The table whose grid is open, and where the selection sits in it. */
  let picture: { path: string } | undefined;
  let pictureControls: PictureControls | undefined;
  /** The form for a figure's file name, caption and label, while it is open. */
  let namesForm: FigureNamesForm | undefined;
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
  /** An error in the author's language, when it can say itself in theirs. */
  const explain = (error: unknown): string => describeError(error, settings.locale);

  const owner = root.ownerDocument;
  const menu = createMenu(owner);
  injectStyle(owner);
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
    if (readOnly) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.dp-grid, .dp-canvas, .dp-canvas-host, .dp-block-source')) return;
    const figure = target?.closest<HTMLElement>('.dp-figure');
    if (!figure || !nameable(figure)) return;
    event.preventDefault();
    menu.open(event.clientX, event.clientY, [{ label: t('editor.figure.button'), run: () => openNames(figure) }]);
  });
  const tabbar = element('div', 'dp-tabbar');
  tabbar.setAttribute('role', 'tablist');
  root.append(pane, tabbar);

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

  function beginEdit(host: HTMLElement): void {
    if (editing?.host === host) return;
    const span = spanOf(host);
    if (!span) return;
    open(host, span, sliceBytes(source, span.start, span.end), '', false, undefined);
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
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.dp-append');
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
    const at = spanOf((event.target as HTMLElement | null)?.closest<HTMLElement>('.dp-append')
      ?? lastTarget())?.end;
    const address = addressOf(event.dataTransfer);
    if (address !== undefined) { place(address, at); return; }
    const file = [...(event.dataTransfer?.files ?? [])].find(one => one.type.startsWith('image/'));
    if (file) void bring(file, at);
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
    figure.prepend(button);
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
      },
      onClose: () => { namesForm = undefined; },
      onSubmit: value => {
        const moved = fixedName === undefined ? `${folder}${value.name}${extension}` : path;
        let change;
        try {
          change = renameFigure(source, span, {
            caption: value.caption, label: value.label, ...(moved === path ? {} : { path: moved }),
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
        if (change) {
          const done = change;
          commit(() => ({ ...done, ...described(ed('editor.did.names', { path: moved })) }), active);
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
      showSource: () => {
        grid = undefined;
        const source = options.readResource?.(current.path) ?? '';
        open(body, { start: 0, end: byteLength(source) }, source, '', false, current.path);
      },
    });
    body.replaceChildren(mounted.element);
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
      selected: current.selected,
      selectedEdge: current.edge,
      apply: (make: () => Edit, selected: readonly string[], edge?: string | undefined) => {
        if (canvas?.path === current.path) canvas = { ...canvas, selected, edge };
        commit(() => {
          try {
            return { ...make(), path: current.path };
          } catch (error) {
            if (error instanceof DiagramEditError) throw new SheetEditError(error.phrase);
            throw error;
          }
        }, active);
      },
      select: (selected: readonly string[], edge?: string | undefined) => {
        if (canvas) canvas = { ...canvas, selected, edge };
      },
      close: (): void => { canvas = undefined; draw(); },
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
  ): void {
    endEdit(true);

    const area = owner.createElement('textarea');
    area.className = 'dp-block-source';
    area.value = initial;
    area.spellcheck = false;

    const edit: BlockEdit = { host, original: host.innerHTML, span, area, prefix, fresh, path };
    host.classList.add('dp-editing');
    // The bar writes Markdown. A table's cells take inline Markdown but its
    // meaning tokens are fills in the style section, and a diagram takes
    // neither — so a bar over a referenced file would write the wrong thing.
    host.replaceChildren(...(path === undefined ? [toolbar.element, area] : [area]));
    editing = edit;

    resize(area);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    toolbar.sync(area.value, area.selectionStart, area.selectionEnd);

    const update = (): void => {
      resize(area);
      toolbar.sync(area.value, area.selectionStart, area.selectionEnd);
    };
    area.addEventListener('input', update);
    area.addEventListener('select', update);
    area.addEventListener('keyup', update);
    area.addEventListener('click', update);
    area.addEventListener('blur', () => endEdit(true));
    area.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); endEdit(false); }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (isCommit(event, settings.commitKey)) { endEdit(true); return; }
        // Every Enter that is not the commit inserts a line break, including
        // the modified ones a text box would otherwise swallow.
        area.setRangeText('\n', area.selectionStart, area.selectionEnd, 'end');
        resize(area);
        toolbar.sync(area.value, area.selectionStart, area.selectionEnd);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault(); applyFormat('bold');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault(); applyFormat('italic');
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
      if (current.path === undefined) current.host.innerHTML = current.original;
      else draw();
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
    if ((event.target as HTMLElement | null)?.closest('.dp-mermaid-switch, .dp-code-copy, .dp-figure-names')) return;
    // A right press on a figure is for its menu. Opening the caption or the
    // drawing under it first would replace the element the menu belongs to.
    if (event.button === 2) {
      const pressed = event.target as HTMLElement | null;
      const figure = pressed?.closest<HTMLElement>('.dp-figure');
      if (figure && nameable(figure)
        && !pressed?.closest('.dp-grid, .dp-canvas, .dp-canvas-host, .dp-block-source')) return;
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
      section.append(insertTarget(section.dataset['span'] ?? '', true));
      return;
    }
    for (const block of blocks) {
      block.after(insertTarget(block.dataset['span'] ?? '', false));
    }
  }

  function insertTarget(span: string, empty: boolean): HTMLElement {
    const append = element('div', 'dp-append');
    // Whatever is added starts where the block before it ends.
    append.dataset['span'] = span;

    const hint = element('span', 'dp-append-hint');
    hint.textContent = empty ? t('editor.append.hint') : '';
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

  function resize(area: HTMLTextAreaElement): void {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
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
  function commit(make: () => Edit, select: number): void {
    let edit: Edit;
    try {
      edit = make();
    } catch (error) {
      if (error instanceof SheetEditError) { options.onError?.(explain(error)); return; }
      throw error;
    }

    const previous = source;
    const before = edit.path === undefined ? undefined : options.readResource?.(edit.path);
    const written = applyEdit(
      edit.path === undefined ? source : before ?? '', edit,
    );
    if (edit.path === undefined) source = written;
    options.onChange?.(localizeEdit(edit, settings.locale), written);

    try {
      active = Math.max(1, Math.min(select, sheets().length));
      draw();
    } catch (error) {
      source = previous;
      if (edit.path !== undefined && before !== undefined) {
        options.onChange?.({ ...edit, phrase: undefined, description: t('editor.did.undo') }, before);
      }
      draw();
      options.onError?.(explain(error));
    }
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

  function draw(): void {
    // An edit is not a change of subject: the reader stays where they were.
    const place = placeOf();
    const page = element('div', 'dp-page');
    page.innerHTML = render(source);
    pane.replaceChildren(page);
    editing = undefined;
    sections = [...page.querySelectorAll<HTMLElement>('.dp-sheet')];
    for (const section of sections) addInsertTargets(section);
    for (const figure of page.querySelectorAll<HTMLElement>('.dp-figure')) addImportTarget(figure);
    for (const figure of page.querySelectorAll<HTMLElement>('.dp-figure')) addNamesButton(figure);
    for (const block of page.querySelectorAll<HTMLElement>('.dp-mermaid')) addMermaidSwitch(block);
    for (const block of page.querySelectorAll<HTMLElement>('.dp-code')) addCopyButton(block);
    options.decorate?.(page);
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
  const onKeyDown = (event: KeyboardEvent): void => {
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
    setReadOnly(on) {
      if (on === readOnly) return;
      if (on) {
        // Whatever was open is put away first, so nothing typed is lost.
        endEdit(true);
        namesForm?.close();
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
      root.replaceChildren();
      root.classList.remove('dp-editor');
    },
  };
}

function injectStyle(document: Document): void {
  if (document.getElementById('dp-editor-style')) return;
  const style = document.createElement('style');
  style.id = 'dp-editor-style';
  // Each package styles its own chrome; the shell puts them together. Opening
  // the drawing editor on its own needs only the first two.
  style.textContent = [BASE_STYLE, DIAGRAM_STYLE, EDITOR_STYLE].join('\n');
  document.head.append(style);
}
