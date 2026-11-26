// Direct manipulation of a diagram. The drawing on screen is the drawing the
// renderer produces — the editor adds an outline, a handle and the guides, and
// nothing else — so what is dragged is what a reader will see.
//
// A drag is not a new kind of state: it ends as one pin, which is one line of
// the layout section. Automatic layout keeps the rest, which is the whole point
// of the three-layer model: the mouse is for the exceptions.

import { layOutDiagram, type Box } from '../layout.js';
import { containerOf, dropInto, rowRoles } from '../arrange.js';
import type { DiagramFile, Item, ShapeKind } from '../model.js';
import { drawnRoutes, renderDiagram } from '../draw/render.js';
import { roundedPath } from '../draw/geometry.js';
import { isIconPath, stencilArt, stencilParts } from '../draw/stencil.js';
import { DEFAULT_GROUPS, DEFAULT_LIBRARY } from '../default-parts.js';
import { parseDiagram } from '../parse.js';
import { withParts } from '../parts.js';
import {
  applyEdit, attachZoom, BASE_MESSAGES, DEFAULT_LOCALE, described, describeError, enableLongPress,
  type Edit, type Locale, type Phrase,
} from '@docpresenter/base';
import { DIAGRAM_MESSAGES, dgm } from '../messages.js';
import {
  addNode, bendEdge, canUnpin, editBetween, withLibrary, connectNodes, disconnectNodes, groupMembers, groupNodes,
  nextShapeId, pinNode, pinNodes, sizeNode, addZone, nextZoneId, reconnect, removeNodes, setContainerCells, setItems, setStackFlow,
  putIntoContainer, setNodePart, setNodeShape, setNodeStyle, setNodeText, unpinNode,
  setEdgeLabel, renameNode, moveToOrigin,
  DiagramEditError,
} from '../edits.js';
import {
  followLabel, isLeftOut, itemOfShape, itemShapes, linkItemTable, newItemTable, renameItemId, setItemCell, syncItemTable,
} from '../items.js';
import {
  addTableColumn, addTableRow, isEmptyTable, makeTable, removeTableColumn, removeTableRow, renameColumn,
  setColumnPart, setRowRole, setScroll, tableOf, type RowRole,
} from '../table.js';
import { stackNodes } from '../stack-up.js';
import { duplicateNodes, type Copied } from '../copy.js';
import { checkState, isDisabled, isHidden, setEnabled, setVisible, toggleCheck } from '../states.js';
import {
  addField, addLabel, fieldOf, fieldShapes, formOf, isLabelForm, setLabelColumn, setLabelSide, type AddedField,
} from '../fields.js';
import { toggleInline, type InlineMark } from '@docpresenter/base';
import { createMenu, createToolbar, type MenuItem } from '@docpresenter/base';
import { alignIcon, lineIcon, partIcon, rowIcon, shapeIcon } from './shape-icon.js';
import { isListing, rowBoxes, rowTextAt, type Listing } from '../draw/listing.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * The row of a listing that was picked, kept per document.
 *
 * Every edit builds the canvas again, and the selection the host remembers is
 * a list of shapes — it has no room for "the third row of the tree". Keeping it
 * here means pressing "add a row" twice adds two rows, which is what anybody
 * pressing it twice meant.
 */
const rowPicks = new WeakMap<Document, { id: string; index: number }>();
/**
 * A shape whose words are to be written as soon as the canvas is back — the
 * label of an input just added. The canvas is built again after every edit,
 * so "and now type its name" has to outlive the one that made it.
 */
const textPicks = new WeakMap<Document, string>();
/**
 * How far the drawing is zoomed, kept per document for the same reason: every
 * edit builds the canvas again, and an edit is no reason to zoom back out.
 * A host that keeps it itself passes `zoom` and `onZoom` instead.
 */
const zoomPicks = new WeakMap<Document, number | undefined>();
/** Whether a drag draws a band wherever it starts, per document: it outlives the redraw an edit makes. */
const bandModes = new WeakMap<Document, boolean>();
/**
 * The last thing added, to add again with F4: the same part, the same shape,
 * another row. Kept per document, outside any one canvas — every edit builds
 * the canvas again, and "again" is about the one before.
 */
type Repeat =
  | { readonly kind: 'part'; readonly name: string; readonly labelled: boolean }
  | { readonly kind: 'shape'; readonly shape: ShapeKind; readonly icon?: string | undefined; readonly text?: string | undefined }
  | { readonly kind: 'zone' }
  | { readonly kind: 'tableRow' }
  | { readonly kind: 'tableColumn' }
  | { readonly kind: 'row' };
const repeats = new WeakMap<Document, Repeat>();
/** The kinds of item that are inputs, and so come with a label. */
const INPUTS = new Set(['入力', 'input']);
/** A shape that draws itself from rows, and the rows it draws. */
interface Held {
  readonly icon: Listing;
  readonly items: readonly Item[];
}
/** How far a shape's edge may be from another's to be pulled into line. */
const SNAP = 5;
/** What a free coordinate is rounded to, so a diff shows round numbers. */
const GRID = 4;
/** A press this short of a move is a selection, not a drag. */
const THRESHOLD = 3;
const MIN_SIZE = 16;
/** An empty cell of a grid. */
const EMPTY = '.';


/**
 * The shapes on offer. Fewer than the notation has: a palette is a set of
 * choices someone has to make every time, and the ones left out (`group`, and
 * the stadium's near-twin) are either not a shape you draw or are one keystroke
 * away in the source.
 */
const PALETTE = [
  'rect',
  'round-rect',
  'stadium',
  'ellipse',
  'diamond',
  'cylinder',
  'note',
  'text',
  // A line on its own. Not a connection: it divides a screen or points at a
  // part of it, and neither of those joins two shapes together.
  'line',
  // The flowchart set. Kept together at the end, after the shapes that get
  // used in any kind of drawing.
  'parallelogram',
  'hexagon',
  'loop-start',
  'loop-end',
] as const satisfies readonly ShapeKind[];

export interface CanvasOptions {
  readonly owner: Document;
  readonly file: DiagramFile;
  /** The `.dgm` text. Edits are byte ranges in it. */
  readonly source: string;
  /** The shapes picked, in the order they were picked. */
  readonly selected: readonly string[];
  /** The connection picked, as `from->to`. A line or shapes, never both. */
  readonly selectedEdge: string | undefined;
  /** Runs one edit; the caller re-renders and mounts the canvas again. */
  readonly apply: (
    make: () => Edit, selected: readonly string[], edge?: string | undefined,
  ) => void;
  /** Remembers the selection without writing anything. */
  readonly select: (ids: readonly string[], edge?: string | undefined) => void;
  readonly showSource: () => void;
  /**
   * Opens the drawing's own file in a text editor beside this one. When
   * given, the source button offers it alongside the text shown here.
   */
  readonly openSourceFile?: (() => void) | undefined;
  /**
   * More lines for the menu about the drawing as a whole, from the host —
   * where the screen's item table is shown beside the canvas, say.
   */
  readonly drawingMenu?: (() => readonly MenuItem[]) | undefined;
  readonly close: () => void;
  readonly onError?: (message: string) => void;
  /** Which language the bar, the menus and the hints speak. */
  readonly locale?: Locale | undefined;
  /**
   * The text of the table the drawing's `items` line names, when the host can
   * write to it. An edit to it carries that table's path, as written in the
   * drawing; without it the canvas offers nothing that writes the table.
   */
  readonly itemSource?: string | undefined;
  /**
   * How a screen with no item table gets one: the name it would have (beside
   * the drawing, as its `items` line writes it) and how the host makes the
   * file. `create` returns why it could not, or undefined; a table already
   * there under that name is kept, not written over. Without it the canvas
   * does not offer to make one.
   */
  readonly newItemTable?: {
    readonly path: string;
    readonly create: (text: string) => string | undefined;
  } | undefined;
  /** The zoom to start at (1 is the drawing's own size); undefined fits it to the page. */
  readonly zoom?: number | undefined;
  /** Told when the zoom changes. Without it the canvas keeps the zoom itself, per document. */
  readonly onZoom?: ((scale: number | undefined) => void) | undefined;
  /**
   * Where a picture a shape points at (`icon: ./images/logo.png`) is to be
   * had, as the drawing writes it. Without it, or for a picture it does not
   * know, the picture is drawn as its name.
   */
  readonly picture?: ((path: string) => string | undefined) | undefined;
  /**
   * Asks the author for a picture — a file dialog, say — and answers with its
   * path as the drawing writes it, or undefined when they changed their mind.
   * Without it the canvas does not offer to choose one.
   */
  readonly pickPicture?: (() => Promise<string | undefined>) | undefined;
}

export interface Canvas {
  readonly element: HTMLElement;
  /**
   * Takes the keyboard. The caller calls this after putting the element on the
   * page: focusing a node that is not in the document yet does nothing, and a
   * redraw that lost the focus would swallow the next arrow key.
   */
  focus(): void;
}

/**
 * What Ctrl+C took, kept outside any one canvas: the canvas is built again
 * after every edit, and a copy that went with it could never be pasted.
 */
let clipboard: Copied | undefined;
/** How many times the copy has been pasted, so each paste lands a step further on rather than on the last. */
let pastes = 0;
/** How far a paste lands from what was copied. */
const PASTE_STEP = 20;

/** The resize handles: a name, and where each sits as -1, 0 or 1 across and down. */
const HANDLES: readonly (readonly [string, -1 | 0 | 1, -1 | 0 | 1])[] = [
  ['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0],
  ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0],
];

/** Which sides a handle moves. A handle with no name is the old corner one. */
function sidesOf(name: string | null | undefined): { across: -1 | 0 | 1; down: -1 | 0 | 1 } {
  const found = HANDLES.find(([one]) => one === name);
  return found ? { across: found[1], down: found[2] } : { across: 1, down: 1 };
}

export function createCanvas(options: CanvasOptions): Canvas {
  const { owner, file, source } = options;
  const locale = options.locale ?? DEFAULT_LOCALE;
  const t = DIAGRAM_MESSAGES.in(locale);
  /** What the bar says when nothing in particular is picked. */
  const HINT = t('diagram.canvas.hint');
  const laid = layOutDiagram(file, locale);
  /** The connections as they are drawn: a line to a picture meets the picture, not the box round it and its name. */
  const routes = drawnRoutes(file, laid);
  // A finger has no right button: a long press opens the same menus.
  enableLongPress(owner);
  // The selection is a list rather than one id: grouping and moving several
  // shapes at once both need to know what was picked, in what order.
  let picked = options.selected.filter(id => laid.boxes.has(id));
  const primary = (): string | undefined => picked[picked.length - 1];
  const nameOf = (edge: { from: string; to: string }): string => `${edge.from}->${edge.to}`;
  /** The connection picked, if it is a connection that is picked. */
  let line = routes.some(r => nameOf(r.edge) === options.selectedEdge)
    ? options.selectedEdge : undefined;
  const lineOf = (name: string | undefined) =>
    routes.find(r => nameOf(r.edge) === name);

  /** Which rows a shape holds, if it is a tree, a list or a menu. */
  const listingOf = (id: string | undefined): Held | undefined => {
    if (id === undefined) return undefined;
    const node = file.nodes.find(one => one.id === id);
    const icon = file.style.get(id)?.get('icon');
    return node && isListing(icon) ? { icon, items: node.items } : undefined;
  };
  /**
   * The row picked before the last edit, if that row is still there. A row
   * that is no longer drawn — the list was shortened, or a branch above it was
   * closed — is not picked either: the buttons would be acting on something
   * nobody can see.
   */
  let row = ((): { id: string; index: number } | undefined => {
    const kept = rowPicks.get(owner);
    const held = listingOf(kept?.id);
    const box = kept && laid.boxes.get(kept.id);
    if (!kept || !held || !box || !picked.includes(kept.id)) return undefined;
    return rowBoxes(held.icon, box, held.items)[kept.index] ? kept : undefined;
  })();
  /** The listing being worked on, whether or not one of its rows is picked. */
  const listingNow = (): { id: string; held: Held } | undefined => {
    const id = row?.id ?? (picked.length === 1 ? picked[0] : undefined);
    const held = listingOf(id);
    return id !== undefined && held ? { id, held } : undefined;
  };
  const pickRow = (next: { id: string; index: number } | undefined): void => {
    row = next;
    if (next) rowPicks.set(owner, next); else rowPicks.delete(owner);
  };

  // Declared up here because the bar is built before the code below runs, and
  // a `let` reached early is an error rather than an empty box.
  let where: HTMLElement | undefined;
  let naming: HTMLInputElement | undefined;
  /** The line the pointer is near, shown before it is pressed. */
  let hovered: string | undefined;
  let release: HTMLButtonElement | undefined;
  let aligners: HTMLElement | undefined;
  let liners: HTMLElement | undefined;
  let hint: HTMLElement | undefined;
  let spreaders: readonly HTMLButtonElement[] = [];
  let lookButtons: readonly HTMLButtonElement[] = [];
  let rowButtons: readonly HTMLButtonElement[] = [];
  let rows: HTMLElement | undefined;

  const root = element('div', 'dp-canvas');
  const stage = element('div', 'dp-canvas-stage');
  stage.tabIndex = 0;
  const pictureOf = options.picture;
  stage.innerHTML = renderDiagram(file, pictureOf ? path => pictureOf(path) ?? path : undefined, undefined, locale, true);
  const svg = stage.querySelector('svg');
  const bar = createBar();
  // The stage scrolls inside its own frame once it is zoomed past the page,
  // and the zoom buttons sit on the frame's corner, out of the scroll.
  const view = element('div', 'dp-canvas-view');
  const scroller = element('div', 'dp-canvas-scroll');
  scroller.append(stage);
  view.append(scroller);
  root.append(bar, view);

  function element(tag: string, className: string): HTMLElement {
    const node = owner.createElement(tag);
    node.className = className;
    return node;
  }

  function shape(tag: string, className: string): SVGElement {
    const node = owner.createElementNS(SVG_NS, tag) as SVGElement;
    node.setAttribute('class', className);
    return node;
  }

  if (!svg) return { element: root, focus: () => stage.focus({ preventScroll: true }) };
  // A local the narrowing survives into: the handlers below are declarations,
  // and a declaration's body does not inherit the check above.
  const drawing = svg;

  // The handles live inside the SVG, so they are in the drawing's own
  // coordinates and scale with it. Nothing here is ever written to a file.
  const overlay = shape('g', 'dp-canvas-overlay');
  drawing.append(overlay);

  // A drag moves shapes here, so only Space with a drag, or the middle
  // button, pans. The handles are drawn to a size on screen, so a new zoom
  // draws them again.
  attachZoom(view, scroller, () => drawing, {
    locale,
    initial: options.onZoom ? options.zoom : (options.zoom ?? zoomPicks.get(owner)),
    onChange: next => {
      if (options.onZoom) options.onZoom(next); else zoomPicks.set(owner, next);
      paint();
    },
  });

  /** Screen pixels per drawing unit: the SVG may be shown smaller than it is. */
  function scale(): number {
    const width = drawing.getBoundingClientRect().width;
    return width > 0 && laid.width > 0 ? width / laid.width : 1;
  }

  const boxOf = (id: string | undefined): Box | undefined =>
    id === undefined ? undefined : laid.boxes.get(id);

  // --- 選択と目印 --------------------------------------------------------

  interface Preview {
    readonly box: Box;
    readonly guides: readonly { readonly axis: 'x' | 'y'; readonly at: number }[];
  }
  let preview: Preview | undefined;

  function paint(): void {
    overlay.replaceChildren();

    if (band) {
      const rect = shape('rect', 'dp-canvas-band');
      place(rect, bandBox());
      overlay.append(rect);
    }

    const near = lineOf(hovered);
    if (near) {
      const mark = shape('polyline', 'dp-canvas-edge-hover');
      mark.setAttribute('points', points(near.points));
      overlay.append(mark);
    }

    const chosen = lineOf(line);
    if (chosen) {
      const path = livePath(chosen.points);
      const mark = shape('polyline', 'dp-canvas-edge-picked');
      mark.setAttribute('points', points(path));
      overlay.append(mark);

      // A hollow circle in the middle of every segment. Dragging the line
      // anywhere bends it, but nothing on screen said so; a handle does.
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 40 / scale()) continue;
        const spot = shape('circle', 'dp-canvas-bend-new');
        spot.setAttribute('cx', String((a.x + b.x) / 2));
        spot.setAttribute('cy', String((a.y + b.y) / 2));
        spot.setAttribute('r', String(4.5 / scale()));
        spot.setAttribute('data-segment', String(i));
        overlay.append(spot);
      }

      // A square for every corner the line turns through: drag one to move it,
      // drop it back on the straight line to take it out.
      for (let i = 1; i + 1 < path.length; i++) {
        const corner = path[i]!;
        const size = 7 / scale();
        const handle = shape('rect', 'dp-canvas-bend');
        handle.setAttribute('x', String(corner.x - size / 2));
        handle.setAttribute('y', String(corner.y - size / 2));
        handle.setAttribute('width', String(size));
        handle.setAttribute('height', String(size));
        handle.setAttribute('data-bend', String(i - 1));
        overlay.append(handle);
      }
      // The two ends are draggable: that is how a line is re-attached.
      const ends = [path[0], path[path.length - 1]];
      ends.forEach((at, index) => {
        if (!at) return;
        const end = shape('circle', 'dp-canvas-end');
        end.setAttribute('cx', String(reaching && index === (reaching.end === 'from' ? 0 : 1)
          ? reaching.at.x : at.x));
        end.setAttribute('cy', String(reaching && index === (reaching.end === 'from' ? 0 : 1)
          ? reaching.at.y : at.y));
        end.setAttribute('r', String(5 / scale()));
        end.setAttribute('data-end', index === 0 ? 'from' : 'to');
        overlay.append(end);
      });
      if (reaching) {
        const rubber = shape('line', 'dp-canvas-rubber');
        const fixed = reaching.end === 'from' ? path[path.length - 1]! : path[0]!;
        rubber.setAttribute('x1', String(fixed.x));
        rubber.setAttribute('y1', String(fixed.y));
        rubber.setAttribute('x2', String(reaching.at.x));
        rubber.setAttribute('y2', String(reaching.at.y));
        overlay.append(rubber);
      }
    }

    for (const id of picked) {
      const box = id === primary() ? preview?.box ?? boxOf(id) : shifted(id);
      if (!box) continue;
      // Every picked shape is washed over, not merely outlined: with several
      // picked, an outline alone is a thin line among many other thin lines.
      const outline = shape('rect', 'dp-canvas-outline');
      place(outline, thick(box));
      overlay.append(outline);
    }

    const box = preview?.box ?? boxOf(primary());
    // Resizing is one shape's business: a handle on a selection of several
    // would have to mean something, and nothing it could mean is obvious.
    if (box && picked.length === 1) {
      // The handle is drawn at a fixed size on screen, so it stays grabbable on
      // a drawing the pane had to shrink.
      // One on every corner and every side, so a shape can grow towards
      // whichever side has room — not only down and to the right.
      const size = 9 / scale();
      for (const [name, across, down] of HANDLES) {
        const handle = shape('rect', `dp-canvas-handle dp-canvas-handle-${name}`);
        handle.setAttribute('data-handle', name);
        handle.setAttribute('x', String(box.x + (box.width * (across + 1)) / 2 - size / 2));
        handle.setAttribute('y', String(box.y + (box.height * (down + 1)) / 2 - size / 2));
        handle.setAttribute('width', String(size));
        handle.setAttribute('height', String(size));
        overlay.append(handle);
      }
    }

    // The edge between a form's labels and its inputs: drag it for a width,
    // double-click it to fit the longest label.
    const column = labelColumn();
    if (column) {
      const edge = shape('rect', 'dp-canvas-column');
      const size = 6 / scale();
      place(edge, {
        x: (sizing?.at ?? column.edge) - size / 2, y: column.top, width: size, height: column.height,
        z: 0, lines: [],
      } as Box);
      const title = owner.createElementNS(SVG_NS, 'title');
      title.textContent = t('diagram.canvas.labelColumn');
      edge.append(title);
      overlay.append(edge);
    }

    const held = listingOf(row?.id);
    const listBox = boxOf(row?.id);
    if (row && held && listBox) {
      const one = rowBoxes(held.icon, listBox, held.items)[row.index];
      if (one) {
        const mark = shape('rect', 'dp-canvas-row');
        place(mark, one);
        overlay.append(mark);
      }
    }

    if (dropping) {
      const mark = shape('rect', 'dp-canvas-drop');
      place(mark, dropping.mark);
      overlay.append(mark);
    }

    for (const guide of preview?.guides ?? []) {
      const line = shape('line', 'dp-canvas-guide');
      line.setAttribute('x1', String(guide.axis === 'x' ? guide.at : 0));
      line.setAttribute('x2', String(guide.axis === 'x' ? guide.at : laid.width));
      line.setAttribute('y1', String(guide.axis === 'y' ? guide.at : 0));
      line.setAttribute('y2', String(guide.axis === 'y' ? guide.at : laid.height));
      overlay.append(line);
    }
  }

  /**
   * The picked line as it is right now: the route it was laid out on, with the
   * corner being dragged moved to where the pointer is, or a new corner put in
   * where the line was grabbed.
   */
  function livePath(
    laidPoints: readonly { x: number; y: number }[],
  ): { x: number; y: number }[] {
    const path = laidPoints.map(p => ({ x: p.x, y: p.y }));
    if (!bending) return path;
    const at = { x: bending.at.x, y: bending.at.y };
    if (bending.fresh) path.splice(bending.index + 1, 0, at);
    else path[bending.index + 1] = at;
    return path;
  }

  function points(list: readonly { x: number; y: number }[]): string {
    return list.map(p => `${p.x},${p.y}`).join(' ');
  }

  /**
   * A line of the drawing itself — one that joins nothing — nearest the
   * pointer, if one is near enough. Found by distance for the same reason a
   * connection is, below.
   */
  function ruleAt(at: { x: number; y: number }): { id: string; distance: number } | undefined {
    const near = 6 / scale();
    let best: { id: string; distance: number } | undefined;
    for (const node of file.nodes) {
      if (node.shape !== 'line') continue;
      const box = laid.boxes.get(node.id);
      if (!box) continue;
      const up = file.style.get(node.id)?.get('slope') === 'up';
      const from = { x: box.x, y: up ? box.y + box.height : box.y };
      const to = { x: box.x + box.width, y: up ? box.y : box.y + box.height };
      const distance = toSegment(at, from, to);
      if (distance <= near && (!best || distance < best.distance)) {
        best = { id: node.id, distance };
      }
    }
    return best;
  }

  /**
   * The connection under a point, if one is near enough. Lines are found by
   * distance rather than by a wide invisible shape over them: an invisible
   * shape would have to sit above the drawing, and would then take the presses
   * meant for whatever it crosses.
   */
  function edgeAt(at: { x: number; y: number }): { name: string; distance: number } | undefined {
    const near = 6 / scale();
    let best: { name: string; distance: number } | undefined;
    for (const route of routes) {
      for (let i = 0; i + 1 < route.points.length; i++) {
        const distance = toSegment(at, route.points[i]!, route.points[i + 1]!);
        if (distance <= near && (!best || distance < best.distance)) {
          best = { name: nameOf(route.edge), distance };
        }
      }
    }
    return best;
  }

  /**
   * What the pointer means where it is not on a shape: the nearer of the
   * drawing's own lines and the connections. They cross — a line marking a
   * boundary is drawn across the connections that pass through it — so at the
   * crossing the one being pointed at is the one nearer the pointer.
   */
  function nearest(at: { x: number; y: number }): { rule?: string; line?: string } {
    const rule = ruleAt(at);
    const edge = edgeAt(at);
    if (rule && (!edge || rule.distance <= edge.distance)) return { rule: rule.id };
    return edge ? { line: edge.name } : {};
  }

  /**
   * What a press is on: a shape, or the line or rule nearest it. A group's
   * frame lies under the lines that cross it, and a line is one pixel wide:
   * on a frame, a press near a line is on the line, or no line in a group
   * could be picked at all — only by hitting its one pixel.
   */
  function underPointer(event: MouseEvent): { shape?: string; rule?: string; line?: string } {
    const target = event.target as Element | null;
    const shape = target?.closest('[data-node]')?.getAttribute('data-node') ?? undefined;
    const node = shape === undefined ? undefined : file.nodes.find(one => one.id === shape);
    // Inside the box of what is picked, a press on something behind it — the
    // frame of the screen the stack sits on — is a press on what is picked.
    const held = pickedAt(pointOn(event));
    if (held !== undefined && shape !== undefined && shape !== held && pickedHolder(shape) !== held) {
      const nearLine = nearest(pointOn(event));
      return nearLine.line !== undefined ? nearLine : { shape: held };
    }
    if (shape !== undefined && node?.shape !== 'group') return { shape };
    const near = nearest(pointOn(event));
    if (near.line !== undefined || near.rule !== undefined) return near;
    if (shape !== undefined) return { shape };
    // The empty part of a picked container — a stack between its members — is
    // the container: it draws nothing there to be pressed, but it is there.
    return held === undefined ? {} : { shape: held };
  }

  /** The picked shape whose box holds the point, the innermost first. */
  function pickedAt(at: { x: number; y: number }): string | undefined {
    for (const id of [...picked].reverse()) {
      const box = laid.boxes.get(id);
      if (box && at.x >= box.x && at.x <= box.x + box.width && at.y >= box.y && at.y <= box.y + box.height) return id;
    }
    return undefined;
  }

  /** Which segment of a path a point is nearest to, counted from zero. */
  function segmentAt(path: readonly { x: number; y: number }[], at: { x: number; y: number }): number {
    let best = 0;
    let distance = Infinity;
    for (let i = 0; i + 1 < path.length; i++) {
      const found = toSegment(at, path[i]!, path[i + 1]!);
      if (found < distance) { distance = found; best = i; }
    }
    return best;
  }

  /**
   * Pulls a corner into line with the points on either side of it. A drawing of
   * a system is drawn with right angles; the alternative is a line that misses
   * being square by two pixels, which is worse than no corner at all.
   */
  function square(
    at: { x: number; y: number },
    before: { x: number; y: number }, after: { x: number; y: number },
  ): { x: number; y: number } {
    const near = SNAP;
    const x = Math.abs(at.x - before.x) <= near ? before.x
      : Math.abs(at.x - after.x) <= near ? after.x : round(at.x);
    const y = Math.abs(at.y - before.y) <= near ? before.y
      : Math.abs(at.y - after.y) <= near ? after.y : round(at.y);
    return { x, y };
  }

  /** Distance from a point to a segment. */
  function toSegment(
    p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
  ): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  /** Where a press landed, in the coordinates the laid-out boxes use. */
  function pointOn(event: MouseEvent): { x: number; y: number } {
    const rect = drawing.getBoundingClientRect();
    const factor = scale();
    return { x: (event.clientX - rect.left) / factor, y: (event.clientY - rect.top) / factor };
  }

  /**
   * A box with enough of it to see. A line's box is flat, and a wash over
   * nothing is a wash nobody sees — so the mark, not the line, is given room.
   */
  function thick(box: Box): Box {
    const least = 5 / scale();
    const grow = (size: number): number => Math.max(size, least);
    return {
      ...box,
      x: box.x - (grow(box.width) - box.width) / 2,
      y: box.y - (grow(box.height) - box.height) / 2,
      width: grow(box.width), height: grow(box.height),
    };
  }

  function place(node: SVGElement, box: Box): void {
    node.setAttribute('x', String(box.x));
    node.setAttribute('y', String(box.y));
    node.setAttribute('width', String(box.width));
    node.setAttribute('height', String(box.height));
  }

  /** Where a shape is being shown while the selection is dragged. */
  function shifted(id: string): Box | undefined {
    const box = boxOf(id);
    if (!box || !drag?.moved || !moving.has(id)) return box;
    return { ...box, x: box.x + drag.by.x, y: box.y + drag.by.y };
  }

  function bandBox(): Box {
    const from = band?.from ?? { x: 0, y: 0 };
    const to = band?.to ?? from;
    return {
      x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y),
      z: 0, lines: [],
    };
  }

  function pick(ids: readonly string[]): void {
    if (line === undefined && ids.length === picked.length
      && ids.every((id, i) => picked[i] === id)) return;
    if (row && !ids.includes(row.id)) pickRow(undefined);
    picked = [...ids];
    line = undefined;
    options.select(picked, undefined);
    describe();
    paint();
  }

  /** Picking a line unpicks the shapes: an operation acts on one or the other. */
  function pickLine(name: string | undefined): void {
    line = name;
    picked = [];
    options.select([], name);
    describe();
    paint();
  }

  /** Shift adds to the selection and takes away again, as a list does. */
  function toggle(id: string): void {
    pick(picked.includes(id) ? picked.filter(other => other !== id) : [...picked, id]);
  }

  // --- ドラッグ ----------------------------------------------------------

  interface Drag {
    readonly kind: 'move' | 'resize';
    readonly from: { x: number; y: number };
    readonly pointerId: number;
    /** The shape under the pointer: the one that snaps and resizes. */
    readonly id: string;
    readonly box: Box;
    moved: boolean;
    /** How far everything being dragged has moved, in the drawing's units. */
    by: { x: number; y: number };
    size: { width: number; height: number } | undefined;
    /** Ctrl was held when the press began: letting go leaves a copy there and the shapes where they were. */
    copy?: boolean;
    /** The shape actually under the press, when the press took hold of what holds it. */
    under?: string | undefined;
    /** While copying, what follows the pointer: a drawn copy of each shape, the shapes themselves staying put. */
    ghosts?: Map<string, Element>;
    /** Which sides a resize moves: -1 the left or top, 1 the right or bottom, 0 neither. */
    sides?: { across: -1 | 0 | 1; down: -1 | 0 | 1 };
    /** Where the shape's corner is after a resize from the left or the top. */
    corner?: { x: number; y: number };
  }
  let drag: Drag | undefined;
  /** What moves with the pointer: the picked shapes and what they contain. */
  let moving = new Set<string>();
  /** The edge of a form's label column being dragged, where the pointer has it. */
  let sizing: { form: string; left: number; at: number } | undefined;
  /** The field or form row a press took hold of, when it was one. */
  let unit: { id: string; row: boolean } | undefined;
  /** The rubber band, in the drawing's coordinates. */
  let band: { from: { x: number; y: number }; to: { x: number; y: number } } | undefined;
  /** In area selection, the shape the band started on: a click there picks it. */
  let bandStart: string | undefined;
  const bandMode = (): boolean => bandModes.get(owner) === true;

  /**
   * What holds a shape, for Alt+press: its container, or the group it is in.
   * Pressed again on the same spot, one further out — the holder of what is
   * picked, when that is already one of the shape's holders.
   */
  function holderOf(id: string): string | undefined {
    const held = containerOf(file);
    const up = (one: string): string | undefined => {
      const container = held.get(one);
      if (container !== undefined && laid.boxes.has(container)) return container;
      return file.nodes.find(node => node.shape === 'group' && node.children.includes(one))?.id;
    };
    const chain: string[] = [];
    for (let one = up(id), depth = 0; one !== undefined && depth < 32; one = up(one), depth++) chain.push(one);
    if (chain.length === 0) return undefined;
    const at = picked.length === 1 ? chain.indexOf(picked[0]!) : -1;
    return chain[Math.min(at + 1, chain.length - 1)];
  }
  /**
   * Where the shape being dragged would land inside its own container. Set
   * while the pointer is still inside it; letting go anywhere else means the
   * shape is leaving the arrangement, which is a pin.
   */
  let dropping: { container: string; cells: string[][]; mark: Box; into: boolean } | undefined;
  /** An end of the picked line being dragged onto another shape. */
  let reaching: { end: 'from' | 'to'; at: { x: number; y: number } } | undefined;
  /**
   * A corner of the picked line being dragged. `index` counts the corners the
   * file holds, so 0 is the first one after the shape the line leaves.
   */
  let bending: { index: number; at: { x: number; y: number }; fresh: boolean } | undefined;

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    // The text box and its bar sit over the drawing but are not part of it.
    if (target?.closest('.dp-canvas-text, .dp-format-bar')) return;
    const onHandle = target?.closest('.dp-canvas-handle') != null && picked.length === 1;
    const onEnd = target?.closest('.dp-canvas-end')?.getAttribute('data-end');
    const onColumn = target?.closest('.dp-canvas-column') != null ? labelColumn() : undefined;
    if (onColumn) {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      sizing = { form: onColumn.form, left: onColumn.left, at: onColumn.edge };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    // A shape under the pointer wins; only then is a line looked for.
    const under: { shape?: string | undefined; rule?: string; line?: string } = onHandle ? { shape: primary() } : underPointer(event);
    // Alt reaches past a shape to what holds it — a stack whose members cover
    // it has no other place to be pressed — and, pressed again, past that.
    const climbed = !onHandle && event.altKey && under.shape !== undefined ? holderOf(under.shape) : undefined;
    // A press on something inside what is picked — a member of the stack that
    // was picked with Alt or from the text — takes hold of what is picked, so
    // the stack is dragged rather than the member under the pointer. Letting go
    // without moving picks the member after all.
    const kept = !onHandle && !event.altKey && !event.shiftKey && under.shape !== undefined
      ? pickedHolder(under.shape) : undefined;
    const id = climbed ?? kept ?? under.shape ?? under.rule;
    const onLine = under.line;

    if (onEnd === 'from' || onEnd === 'to') {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      reaching = { end: onEnd, at: pointOn(event) };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    const onSegment = target?.closest('.dp-canvas-bend-new')?.getAttribute('data-segment');
    if (onSegment !== undefined && onSegment !== null) {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      bending = { index: Number(onSegment), at: pointOn(event), fresh: true };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    const onBend = target?.closest('.dp-canvas-bend')?.getAttribute('data-bend');
    if (onBend !== undefined && onBend !== null) {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      bending = { index: Number(onBend), at: pointOn(event), fresh: false };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    // Area selection: a drag picks what it surrounds wherever it starts, even
    // on a frame that covers the whole screen — which is where it is needed.
    if (bandMode() && !onHandle && !event.shiftKey) {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      if (connecting !== undefined) { connecting = undefined; describe(); }
      band = { from: pointOn(event), to: pointOn(event) };
      bandStart = id ?? undefined;
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    if (onLine !== undefined) {
      event.stopPropagation();
      stage.focus({ preventScroll: true });
      // A line is picked first and bent second: a drag that both selected and
      // bent would put a corner in every time someone reached for the line.
      if (onLine !== line) { pickLine(onLine); return; }
      const route = lineOf(onLine);
      if (!route) return;
      bending = { index: segmentAt(route.points, pointOn(event)), at: pointOn(event), fresh: true };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }

    // The press belongs to the canvas, not to the page behind it — but the
    // default is cancelled on the mouse event below rather than here:
    // cancelling a pointerdown also cancels the click and the double click the
    // browser would have made from it, and renaming a shape is a double click.
    event.stopPropagation();
    stage.focus({ preventScroll: true });

    if (id === undefined || id === null) {
      if (connecting !== undefined) { connecting = undefined; describe(); }
      if (!event.shiftKey) pick([]);
      // An empty press starts a rubber band. Nothing is selected until it is
      // let go, so a stray click still just clears the selection.
      band = { from: pointOn(event), to: pointOn(event) };
      drag = {
        kind: 'move', from: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId, id: '', box: bandBox(), moved: false,
        by: { x: 0, y: 0 }, size: undefined,
      };
      return;
    }
    // A connection is drawn by picking its two ends, so the second press is
    // the line rather than a selection — the same shape again is a loop.
    if (connecting !== undefined) {
      const from = connecting;
      connecting = undefined;
      options.apply(() => connectNodes(file, source, from, id), [id]);
      return;
    }
    if (event.shiftKey) { toggle(id); return; }
    // Pressing something already picked keeps the rest of the selection: that
    // is how a group of shapes is dragged as one.
    // Where the press landed, read before anything is picked: picking changes
    // what the bar above the drawing holds, the bar's height moves the drawing
    // down the page, and a point worked out after that is a point off by the
    // difference — which, for a row of a tree, is a different row.
    const at = pointOn(event);
    if (!picked.includes(id)) pick([id]);
    // A press inside a tree or a list is also a press on one of its rows. The
    // shape stays picked — it still moves and resizes — and the row becomes
    // what the row buttons act on.
    const onRow = rowAt(id, at);
    pickRow(onRow === undefined ? undefined : { id, index: onRow });
    describe();

    // A label and its input are moved as one: pressing either drags the
    // field that holds them, or the row of the form they are on.
    const whole = onHandle ? undefined : unitOf(id);
    unit = whole ? { id: whole.id, row: whole.id === id } : undefined;
    const box = boxOf(whole?.id ?? id);
    if (!box) return;
    moving = whole ? new Set(whole.shapes) : movingSet();
    if (moving.size === 0) {
      options.onError?.(t('diagram.edit.empty', { id }));
      return;
    }
    drag = {
      kind: onHandle ? 'resize' : 'move',
      from: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      id: whole?.id ?? id, box, moved: false,
      by: { x: 0, y: 0 }, size: undefined,
      copy: !onHandle && (event.ctrlKey || event.metaKey) && file.mode === 'free',
      ...(onHandle ? { sides: sidesOf(target?.closest('.dp-canvas-handle')?.getAttribute('data-handle')) } : {}),
      ...(kept !== undefined ? { under: under.shape } : {}),
    };
  });

  /** The picked shape that holds `id`, however deep, when one does. */
  function pickedHolder(id: string): string | undefined {
    if (picked.includes(id)) return undefined;
    const held = containerOf(file);
    const up = (one: string): string | undefined => held.get(one)
      ?? file.nodes.find(node => node.shape === 'group' && node.children.includes(one))?.id;
    for (let one = up(id), depth = 0; one !== undefined && depth < 64; one = up(one), depth++) {
      if (picked.includes(one)) return one;
    }
    return undefined;
  }

  /**
   * What one press moves when it is on a field: the field's stack and all it
   * holds — or, on a form with its labels on the left, the whole row. Undefined for anything else, which moves as
   * itself.
   */
  function unitOf(id: string): { id: string; shapes: readonly string[] } | undefined {
    if (picked.length !== 1 || file.mode !== 'free') return undefined;
    const row = formRow(id);
    if (row) return { id, shapes: [...new Set(row.grid.cells[row.row]!.filter(cell => cell !== '.'))] };
    const field = fieldOf(file, id);
    if (!field || field.kind === 'left' || field.container === id) return undefined;
    const container = file.containers.get(field.container)!;
    return { id: field.container, shapes: [field.container, ...container.cells.flat()] };
  }

  /**
   * The form with its labels on the left that what is picked belongs to, and
   * where the edge of its label column is: the right of its labels, half a gap
   * on. Undefined when one thing in such a form is not what is picked.
   */
  function labelColumn(): { form: string; left: number; edge: number; top: number; height: number } | undefined {
    const id = primary();
    if (id === undefined || picked.length !== 1 || file.mode !== 'free') return undefined;
    const own = file.containers.get(id);
    const grid = own && isLabelForm(file, own) ? own : formRow(id)?.grid;
    const area = grid === undefined ? undefined : laid.boxes.get(grid.id);
    if (!grid || !area) return undefined;
    const labels = grid.cells
      .filter(cells => cells.length > 1 && cells[0] !== '.' && cells[0] !== cells[1])
      .map(cells => laid.boxes.get(cells[0]!)).filter(one => one !== undefined);
    const left = area.x + grid.pad;
    const width = labels.length > 0 ? Math.max(...labels.map(one => one.x + one.width)) - left : 0;
    return { form: grid.id, left, edge: left + width + grid.gap.x / 2, top: area.y, height: area.height };
  }

  /** The row of a form with its labels on the left that a shape is on. */
  function formRow(id: string): { grid: NonNullable<ReturnType<typeof file.containers.get>>; row: number } | undefined {
    const grid = file.containers.get(containerOf(file).get(id) ?? '');
    if (!grid || !isLabelForm(file, grid)) return undefined;
    const row = grid.cells.findIndex(cells => cells.includes(id));
    return row < 0 ? undefined : { grid, row };
  }

  /**
   * What a drag moves on screen: everything picked, and everything a picked
   * group contains. A group's box is computed from its contents, so moving the
   * box without the contents would move nothing at all.
   */
  function movingSet(): Set<string> {
    const ids = new Set<string>();
    for (const id of picked) {
      const node = file.nodes.find(n => n.id === id);
      if (node?.shape === 'group') {
        for (const child of groupMembers(file, id)) ids.add(child);
        // A group the author pinned keeps its own line; one that is computed
        // from its contents follows them without being written down.
        if (file.layout.has(id)) ids.add(id);
        else if (groupMembers(file, id).length > 0) ids.add(id);
        continue;
      }
      ids.add(id);
      // What a container holds follows it on screen; the container's pin is
      // all that is written, and it places them again where it lands.
      for (const member of heldDeep(id)) ids.add(member);
    }
    return ids;
  }

  /** Everything a container holds, at any depth. */
  function heldDeep(id: string): string[] {
    const out: string[] = [];
    const visit = (at: string, depth: number): void => {
      const container = file.containers.get(at);
      if (!container || depth > 32) return;
      for (const member of container.cells.flat()) {
        if (member === EMPTY || out.includes(member) || member === at) continue;
        out.push(member);
        visit(member, depth + 1);
      }
    };
    visit(id, 0);
    return out;
  }

  /** What a drag writes: the moved shapes, minus the groups that are computed. */
  function pinnedSet(): string[] {
    const held = containerOf(file);
    return [...moving].filter(id => {
      const node = file.nodes.find(n => n.id === id);
      // A member of a container that moves is placed by it, not pinned.
      if (held.has(id) && moving.has(held.get(id)!) && !file.layout.has(id)) return false;
      return node?.shape !== 'group' || file.layout.has(id);
    });
  }

  stage.addEventListener('pointermove', event => {
    const current = drag;
    if (!current) {
      // Where a press would pick a line is shown as the pointer gets there:
      // a line is thin, and "near enough" is otherwise a guess.
      const under = event.buttons === 0 ? underPointer(event) : {};
      const near = under.line;
      const next = near !== line ? near : undefined;
      // Over the empty part of what is picked, the pointer says it can be moved.
      stage.classList.toggle('dp-canvas-on-picked', under.shape !== undefined && picked.includes(under.shape));
      if (next !== hovered) {
        hovered = next;
        stage.classList.toggle('dp-canvas-on-line', near !== undefined);
        paint();
      }
      return;
    }
    const factor = scale();
    const dx = (event.clientX - current.from.x) / factor;
    const dy = (event.clientY - current.from.y) / factor;
    if (!current.moved && Math.hypot(dx, dy) * factor < THRESHOLD) return;
    if (!current.moved) {
      // Captured only once the press has become a drag. Capturing on the press
      // itself would retarget the click the browser makes from it, and a double
      // click that lands on the canvas instead of the shape renames nothing.
      stage.setPointerCapture(current.pointerId);
      current.moved = true;
      // A copy is being made: the shapes stay where they are, and a copy of
      // them is what the pointer carries — so what letting go will do is seen.
      if (current.copy && current.kind === 'move') {
        current.ghosts = new Map();
        for (const id of moving) {
          const node = drawing.querySelector(`[data-node="${cssEscape(id)}"]`);
          if (!node) continue;
          const ghost = node.cloneNode(true) as Element;
          ghost.removeAttribute('data-node');
          ghost.classList.add('dp-canvas-ghost');
          node.parentNode?.append(ghost);
          current.ghosts.set(id, ghost);
        }
        stage.classList.add('dp-canvas-copying');
      }
    }

    if (bending) {
      const route = lineOf(line);
      if (route) {
        const path = route.points;
        const before = bending.fresh ? path[bending.index]! : path[bending.index]!;
        const after = bending.fresh ? path[bending.index + 1]! : path[bending.index + 2]!;
        bending = { ...bending, at: square(pointOn(event), before, after) };
        // The drawn line follows too, so what is being made is what is seen.
        const drawn = drawing.querySelector(`[data-edge="${cssEscape(line ?? '')}"] :is(polyline, .dp-edge-line)`);
        if (drawn?.tagName === 'path') drawn.setAttribute('d', roundedPath(livePath(path)));
        else drawn?.setAttribute('points', points(livePath(path)));
      }
      paint();
      return;
    }
    if (reaching) {
      reaching = { end: reaching.end, at: pointOn(event) };
      paint();
      return;
    }
    if (sizing) {
      sizing = { ...sizing, at: Math.max(sizing.left + 16, pointOn(event).x) };
      paint();
      return;
    }
    if (band) {
      band = { from: band.from, to: pointOn(event) };
      paint();
      return;
    }

    drawing.classList.add('dp-canvas-dragging');
    const box = current.box;
    if (current.kind === 'move') {
      // Only the shape under the pointer snaps; the others keep their offsets
      // from it, so a selection that was aligned stays aligned.
      const snapped = snap(box.x + dx, box.y + dy, box.width, box.height, moving);
      current.by = { x: snapped.x - box.x, y: snapped.y - box.y };
      preview = { box: { ...box, x: snapped.x, y: snapped.y }, guides: snapped.guides };
      for (const id of moving) {
        const node = current.ghosts?.get(id) ?? drawing.querySelector(`[data-node="${cssEscape(id)}"]`);
        // The shapes follow the pointer; their connections are re-routed when
        // they land, which is why they fade rather than stretch.
        node?.setAttribute('transform', `translate(${current.by.x}, ${current.by.y})`);
      }
      dropping = landing(current.id, pointOn(event));
    } else {
      // A line is allowed to be flat — that is what a horizontal rule is — so
      // the floor every other shape has would make one impossible to draw.
      const flat = file.nodes.find(n => n.id === primary())?.shape === 'line';
      const least = flat ? 0 : MIN_SIZE;
      const sides = current.sides ?? { across: 1, down: 1 };
      // A side pulled left or up moves the corner with it and grows the other
      // way; the side across from it stays where it was.
      let width = sides.across === 0 ? box.width : Math.max(least, round(box.width + dx * sides.across));
      let height = sides.down === 0 ? box.height : Math.max(least, round(box.height + dy * sides.down));
      // The side being pulled lines up with another shape's edge, the way a
      // moved shape does — so two boxes can be made to end at the same line.
      const guides: { axis: 'x' | 'y'; at: number }[] = [];
      const others = [...laid.boxes].filter(([one]) => one !== current.id && !moving.has(one)).map(([, other]) => other);
      const pull = (edge: number, axis: 'x' | 'y'): number => {
        let best: number | undefined;
        for (const other of others) {
          const start = axis === 'x' ? other.x : other.y;
          const size = axis === 'x' ? other.width : other.height;
          for (const candidate of [start, start + size]) {
            if (Math.abs(candidate - edge) <= SNAP && (best === undefined || Math.abs(candidate - edge) < Math.abs(best - edge))) {
              best = candidate;
            }
          }
        }
        if (best === undefined) return edge;
        guides.push({ axis, at: best });
        return best;
      };
      if (sides.across > 0) width = Math.max(least, pull(box.x + width, 'x') - box.x);
      if (sides.across < 0) width = Math.max(least, box.x + box.width - pull(box.x + box.width - width, 'x'));
      if (sides.down > 0) height = Math.max(least, pull(box.y + height, 'y') - box.y);
      if (sides.down < 0) height = Math.max(least, box.y + box.height - pull(box.y + box.height - height, 'y'));
      const x = sides.across < 0 ? box.x + box.width - width : box.x;
      const y = sides.down < 0 ? box.y + box.height - height : box.y;
      current.size = { width, height };
      current.corner = { x, y };
      preview = { box: { ...box, x, y, width, height }, guides };
    }
    describe();
    paint();
  });

  const finish = (event: PointerEvent): void => {
    const current = drag;
    if (!current) return;
    drag = undefined;
    // Taken now so that every way out of this clears it: a mark left behind
    // would say the next drag lands where the last one would have.
    const landed = dropping;
    dropping = undefined;
    drawing.classList.remove('dp-canvas-dragging');
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    for (const ghost of current.ghosts?.values() ?? []) ghost.remove();
    stage.classList.remove('dp-canvas-copying');

    if (sizing) {
      const done = sizing;
      sizing = undefined;
      // A press that did not move is half of a double click: drawing the edge
      // again now would put the second half on another element, and the
      // browser makes no double click of that.
      if (!current.moved) return;
      const form = file.containers.get(done.form);
      const width = done.at - done.left - (form?.gap.x ?? 0) / 2;
      options.apply(() => setLabelColumn(file, source, done.form, width), [...picked]);
      return;
    }

    if (bending) {
      const which = bending;
      const route = lineOf(line);
      bending = undefined;
      // Nothing moved, so nothing is redrawn: repainting here would replace the
      // handle under the pointer, and the browser makes no double click out of
      // two presses on two different elements.
      if (!route || !current.moved) return;
      const edge = route.edge;
      const path = route.points.map(p => ({ x: p.x, y: p.y }));
      if (which.fresh) path.splice(which.index + 1, 0, which.at);
      else path[which.index + 1] = which.at;
      // A corner dropped back onto the straight line between its neighbours is
      // a corner nobody wants: the gesture that made it takes it away again.
      const corners = path.slice(1, -1).filter((corner, i) => {
        const before = path[i]!;
        const after = path[i + 2]!;
        return toSegment(corner, before, after) > 6 / scale();
      });
      options.apply(
        () => bendEdge(file, source, edge.from, edge.to,
          corners.map(p => ({ x: p.x - laid.origin.x, y: p.y - laid.origin.y }))),
        [], nameOf(edge),
      );
      return;
    }

    if (reaching) {
      const end = reaching.end;
      const at = reaching.at;
      reaching = undefined;
      const chosen = lineOf(line);
      if (!chosen || !current.moved) return;
      // Whatever shape the end was let go over is the new end. Let go over
      // nothing and the line stays as it was.
      const onto = [...laid.boxes].find(([, box]) =>
        at.x >= box.x && at.x <= box.x + box.width
        && at.y >= box.y && at.y <= box.y + box.height)?.[0];
      if (onto === undefined) { paint(); return; }
      const edge = { from: chosen.edge.from, to: chosen.edge.to };
      const ends = end === 'from' ? { from: onto } : { to: onto };
      options.apply(
        () => reconnect(file, source, edge, ends), [],
        end === 'from' ? `${onto}->${edge.to}` : `${edge.from}->${onto}`,
      );
      return;
    }

    if (band) {
      const box = bandBox();
      const inside = band.to.x !== band.from.x || band.to.y !== band.from.y
        ? [...laid.boxes].filter(([, other]) => within(other, box)).map(([id]) => id)
        : [];
      band = undefined;
      const started = bandStart;
      bandStart = undefined;
      // A click in area selection is still a click: it picks what it was on.
      if (!current.moved && started !== undefined) { pick([started]); return; }
      // A field caught by the band is picked as the field, so the next step —
      // moving them, stacking them — acts on fields and not on their halves.
      if (inside.length > 0) pick(file.mode === 'free' ? wholes(inside) : inside); else paint();
      return;
    }

    if (!current.moved) {
      // A press on something already picked keeps the selection, so that a
      // selection can be dragged as one. Letting go without moving means it
      // was a click after all: the selection comes down to what was clicked.
      if (current.under !== undefined) pick([current.under]);
      else if (current.id !== '' && picked.length > 1) pick([current.id]);
      preview = undefined;
      paint();
      return;
    }
    if (current.kind === 'resize') {
      const box = current.box;
      const size = current.size;
      const id = current.id;
      if (!size) { preview = undefined; paint(); return; }
      // A shape a container arranges keeps its place there: only how big it
      // is is written. A pin would take it out of the container and leave an
      // empty cell where it was.
      if (containerOf(file).has(id) && !file.layout.has(id)) {
        options.apply(() => sizeNode(file, source, id, size), [id]);
        return;
      }
      const corner = current.corner ?? box;
      options.apply(() => pinNode(file, source, id, {
        x: corner.x - laid.origin.x, y: corner.y - laid.origin.y, ...size,
      }), [id]);
      return;
    }
    // Dropped inside its own container: the arrangement changes and nothing
    // gets a coordinate. One block of the file is rewritten.
    if (landed) {
      const id = current.id;
      options.apply(
        () => (landed.into
          ? putIntoContainer(file, source, landed.container, landed.cells, id)
          : setContainerCells(file, source, landed.container, landed.cells)),
        // What was pressed stays picked, though its field is what moved.
        picked.length === 1 ? [...picked] : [id],
      );
      return;
    }

    // The redraw that follows builds the canvas again, so the preview is left
    // in place: taking it off first would show the shapes jumping back.
    const by = current.by;
    // Ctrl held: the shapes stay, and a copy of them lands where they were let go.
    if (current.copy) {
      paste(snapshot(unit ? [unit.id] : wholes(picked)), by);
      return;
    }
    // A row of a form belongs in the form: let go outside it, it stays. A
    // field let go anywhere else is pinned there as one — its stack, not the
    // label and the input one by one.
    if (unit?.row) { preview = undefined; paint(); return; }
    const pinned = unit ? [unit.id] : pinnedSet();
    const pins = new Map(pinned.map(id => {
      const box = laid.boxes.get(id)!;
      return [id, { x: box.x - laid.origin.x + by.x, y: box.y - laid.origin.y + by.y }];
    }));
    options.apply(() => pinNodes(file, source, pins), picked);
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);

  /** True when a box is wholly inside the rubber band. */
  function within(box: Box, area: Box): boolean {
    return box.x >= area.x && box.y >= area.y
      && box.x + box.width <= area.x + area.width
      && box.y + box.height <= area.y + area.height;
  }

  // Keeps the browser from moving the focus or starting a text selection,
  // while leaving click and double click to be made as usual.
  stage.addEventListener('mousedown', event => {
    if ((event.target as Element | null)?.closest('.dp-canvas-text, .dp-format-bar')) return;
    event.preventDefault();
    event.stopPropagation();
  });

  stage.addEventListener('dblclick', event => {
    const target = event.target as Element | null;
    // The label column's edge, double-clicked: as wide as the longest label.
    const column = target?.closest('.dp-canvas-column') != null ? labelColumn() : undefined;
    if (column) {
      event.preventDefault();
      options.apply(() => setLabelColumn(file, source, column.form, 'auto'), [...picked]);
      return;
    }
    // Double clicking a corner takes it out. Dragging it back onto the line
    // does too, but that asks someone to aim at a line that is not drawn any
    // more — the corner is where the line goes now.
    const corner = target?.closest('.dp-canvas-bend')?.getAttribute('data-bend');
    if (corner !== undefined && corner !== null) {
      event.preventDefault();
      dropCorner(Number(corner));
      return;
    }
    const under = underPointer(event);
    // A line double-clicked: its words.
    if (under.line !== undefined) {
      event.preventDefault();
      beginLineText(under.line);
      return;
    }
    const id = under.shape;
    if (id === undefined) return;
    event.preventDefault();
    // A tree holds rows rather than one label, so a double click on a row is
    // about that row. Which row is the one under the pointer, not the one that
    // happened to be picked: people aim at what they want to change.
    const onRow = rowAt(id, pointOn(event));
    if (onRow !== undefined) { beginRow(id, onRow); return; }
    beginText(id);
  });

  /** Removes one corner from the picked line, or all of them. */
  function dropCorner(index: number | 'all'): void {
    const chosen = lineOf(line);
    if (!chosen) return;
    const edge = chosen.edge;
    const corners = [...file.bends.get(nameOf(edge))?.points ?? []];
    if (corners.length === 0) return;
    const left = index === 'all' ? [] : corners.filter((_, i) => i !== index);
    options.apply(
      () => bendEdge(file, source, edge.from, edge.to, left), [], nameOf(edge),
    );
  }

  /**
   * Pulls an edge, a centre or a midline into line with another shape's. This
   * is what makes a drawn screen look drawn rather than sprinkled; a coordinate
   * that lines up with nothing falls back to a round number.
   */
  function snap(
    x: number, y: number, width: number, height: number, ignore: ReadonlySet<string>,
  ): { x: number; y: number; guides: { axis: 'x' | 'y'; at: number }[] } {
    // Shapes moving with the pointer are not something to line up against.
    const others = [...laid.boxes].filter(([id]) => !ignore.has(id)).map(([, box]) => box);
    const guides: { axis: 'x' | 'y'; at: number }[] = [];

    const axis = (
      start: number, size: number, edgesOf: (box: Box) => [number, number, number],
      which: 'x' | 'y',
    ): number => {
      const mine: [number, number, number] = [start, start + size / 2, start + size];
      let best: { at: number; delta: number } | undefined;
      for (const box of others) {
        const theirs = edgesOf(box);
        // An edge lines up with an edge and a centre with a centre. Letting a
        // left edge stick to the middle of a checkbox is a line nobody drew.
        const pairs: [number, number[]][] = [
          [mine[0], [theirs[0], theirs[2]]],
          [mine[1], [theirs[1]]],
          [mine[2], [theirs[0], theirs[2]]],
        ];
        for (const [own, candidates] of pairs) {
          for (const edge of candidates) {
            const delta = edge - own;
            if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) {
              best = { at: edge, delta };
            }
          }
        }
      }
      if (!best) return round(start);
      guides.push({ axis: which, at: best.at });
      return start + best.delta;
    };

    return {
      x: axis(x, width, box => [box.x, box.x + box.width / 2, box.x + box.width], 'x'),
      y: axis(y, height, box => [box.y, box.y + box.height / 2, box.y + box.height], 'y'),
      guides,
    };
  }

  // --- 図形の追加・削除・書き換え ----------------------------------------
  //
  // These are edits to the semantics layer, which is the layer a person writes
  // by hand. They live in a context menu for the same reason the grid's row and
  // column operations do: they are used now and then, and putting them in the
  // bar would push out what is used constantly.

  const menu = createMenu(owner);
  /** While drawing a connection: the shape it starts from. */
  let connecting: string | undefined;

  stage.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as Element | null;
    const corner = target?.closest('.dp-canvas-bend')?.getAttribute('data-bend');
    if (corner !== undefined && corner !== null) {
      menu.open(event.clientX, event.clientY, [
        { label: t('diagram.canvas.dropCorner'), run: () => dropCorner(Number(corner)) },
        { label: t('diagram.canvas.straighten'), run: () => dropCorner('all') },
      ]);
      return;
    }
    const under = underPointer(event);
    const overShape = under.shape ?? under.rule;
    const onLine = under.line;
    if (onLine !== undefined) {
      pickLine(onLine);
      const items = lineItems(onLine);
      if (items.length > 0) menu.open(event.clientX, event.clientY, items);
      return;
    }
    if (overShape === undefined || overShape === null) {
      menu.open(event.clientX, event.clientY, addItems(event));
      return;
    }
    if (!picked.includes(overShape)) pick([overShape]);
    // Right clicking a row is about that row, the same as pressing it.
    const onRow = rowAt(overShape, pointOn(event));
    if (onRow !== undefined) { pickRow({ id: overShape, index: onRow }); paint(); describe(); }
    menu.open(event.clientX, event.clientY, shapeItems(overShape));
  });

  /**
   * Where the dragged shape would land in the container that holds it.
   *
   * Only while the pointer is still inside that container, and only when one
   * shape is being dragged: moving several at once is moving them somewhere
   * else, which is what a pin is for.
   */
  function landing(
    id: string, at: { x: number; y: number },
  ): { container: string; cells: string[][]; mark: Box; into: boolean } | undefined {
    if (picked.length !== 1) return undefined;
    const form = formRow(id);
    if (form) return rowLanding(form.grid, form.row, at);
    const held = containerOf(file).get(id);
    // Its own container while it is in one — dropping inside is reordering.
    // Otherwise whichever container the pointer is over: that gesture is how
    // a shape gets into an arrangement in the first place.
    const name = held ?? openTo(id, at);
    const container = name === undefined ? undefined : file.containers.get(name);
    const box = name === undefined ? undefined : laid.boxes.get(name);
    if (!container || !box || name === undefined) return undefined;
    if (at.x < box.x || at.x > box.x + box.width || at.y < box.y || at.y > box.y + box.height) {
      return undefined;
    }
    const found = dropInto(container, box, one => laid.boxes.get(one), id, at, laid.holes);
    return found ? { container: name, ...found, into: held === undefined } : undefined;
  }

  /**
   * Where a row of a form would go: between the rows the pointer is between.
   * The row moves whole, so the label stays with its input.
   */
  function rowLanding(
    grid: NonNullable<ReturnType<typeof file.containers.get>>, from: number, at: { x: number; y: number },
  ): { container: string; cells: string[][]; mark: Box; into: boolean } | undefined {
    const area = laid.boxes.get(grid.id);
    if (!area || at.x < area.x || at.x > area.x + area.width || at.y < area.y || at.y > area.y + area.height) {
      return undefined;
    }
    const spans = grid.cells.map(cells => {
      const boxes = cells.filter(cell => cell !== '.').map(cell => laid.boxes.get(cell)).filter(one => one !== undefined);
      return boxes.length === 0 ? undefined
        : { top: Math.min(...boxes.map(one => one.y)), bottom: Math.max(...boxes.map(one => one.y + one.height)) };
    });
    let to = spans.findIndex(span => span !== undefined && at.y < (span.top + span.bottom) / 2);
    if (to < 0) to = grid.cells.length;
    // Dropped where it is — above or below itself — is no move.
    if (to === from || to === from + 1) return undefined;
    const cells = grid.cells.map(row => [...row]);
    const [row] = cells.splice(from, 1);
    cells.splice(to > from ? to - 1 : to, 0, row!);
    const edge = to < spans.length ? spans[to]?.top ?? area.y : spans[spans.length - 1]?.bottom ?? area.y + area.height;
    const gap = to < spans.length ? -grid.gap.y / 2 : grid.gap.y / 2;
    return {
      container: grid.id, cells, into: false,
      mark: { x: area.x + grid.pad, y: edge + gap - 1.5, width: area.width - grid.pad * 2, height: 3, z: area.z, lines: [] },
    };
  }

  /**
   * The container a shape would be dropped into: the innermost one under the
   * pointer that is not the shape itself, nor anything the shape holds.
   *
   * Innermost because that is the one the pointer is actually over — every
   * container of a screen sits inside the frame, and "into the frame" is never
   * what somebody aiming at a row of a form meant. A container cannot go into
   * itself, and a tab control takes nothing this way: what the pointer is over
   * there is the page, not the strip.
   */
  function openTo(id: string, at: { x: number; y: number }): string | undefined {
    const held = containerOf(file);
    const inside = (name: string): boolean => {
      for (let one: string | undefined = name, depth = 0; one !== undefined && depth < 32; depth++) {
        if (one === id) return true;
        one = held.get(one);
      }
      return false;
    };
    const depthOf = (name: string): number => {
      let depth = 0;
      for (let one = held.get(name); one !== undefined && depth < 32; one = held.get(one)) depth++;
      return depth;
    };
    let found: string | undefined;
    for (const [name, container] of file.containers) {
      if (container.kind === 'tabs' || name === id || inside(name)) continue;
      const box = laid.boxes.get(name);
      if (!box || at.x < box.x || at.x > box.x + box.width) continue;
      if (at.y < box.y || at.y > box.y + box.height) continue;
      if (found === undefined || depthOf(name) > depthOf(found)) found = name;
    }
    return found;
  }

  /** Which row of a listing the pointer is on, if any. */
  function rowAt(id: string, at: { x: number; y: number }): number | undefined {
    const held = listingOf(id);
    const box = boxOf(id);
    if (!held || !box) return undefined;
    // The far edge belongs to the next row, not to both: rows touch, and a
    // press on the line between two of them has to mean one of them.
    const found = rowBoxes(held.icon, box, held.items)
      .findIndex(one => one !== undefined
        && at.x >= one.x && at.x < one.x + one.width
        && at.y >= one.y && at.y < one.y + one.height);
    return found < 0 ? undefined : found;
  }

  /**
   * Where the branch starting at a row ends: the first row after it that is
   * not nested under it. A row with nothing under it is a branch of one.
   */
  function branch(items: readonly Item[], at: number): number {
    const depth = items[at]?.depth ?? 0;
    let end = at + 1;
    while (end < items.length && items[end]!.depth > depth) end += 1;
    return end;
  }

  /** Moves a whole branch one step in or out, keeping its own shape. */
  function deepen(items: Item[], at: number, by: number): Item[] {
    const end = branch(items, at);
    for (let i = at; i < end; i += 1) {
      items[i] = { ...items[i]!, depth: items[i]!.depth + by };
    }
    return items;
  }

  /**
   * One change to the rows of the picked listing. The whole list is handed to
   * the edit, which writes the block back as one byte range; what the author
   * is told is "the list changed", because that is what happened.
   */
  function changeRows(
    make: (items: Item[], at: number) => { items: Item[]; at: number } | undefined,
  ): void {
    const current = row;
    const held = listingOf(current?.id);
    if (!current || !held) return;
    const next = make([...held.items], current.index);
    if (!next) return;
    pickRow(next.items.length === 0
      ? undefined
      : { id: current.id, index: Math.max(0, Math.min(next.at, next.items.length - 1)) });
    options.apply(() => setItems(file, source, current.id, next.items), [current.id]);
  }

  /**
   * A row at the end of a listing, when no row is pressed.
   *
   * A listing with no rows draws the picture it came with and has nothing to
   * press, so without this there is no way to write the first row from the
   * canvas at all. The new row takes the depth of the one above it: a flat
   * list is the same either way, and in a tree it carries on the branch the
   * reader was just looking at rather than starting a new one.
   */
  /**
   * A row under the picked one, with what is nested under that one kept with
   * it — or, with no row pressed, a row at the bottom: a listing with no rows
   * at all has nothing to press, which is how one gets its first.
   */
  function addRowHere(): void {
    repeats.set(owner, { kind: 'row' });
    if (row === undefined) { addRow(); return; }
    changeRows((items, at) => {
      const after = branch(items, at);
      items.splice(after, 0, {
        text: t('diagram.new.item'), depth: items[at]?.depth ?? 0, closed: false, picked: false,
      });
      return { items, at: after };
    });
  }

  /** The picked row goes, and what is nested under it with it. */
  function dropRowHere(): void {
    changeRows((items, at) => {
      items.splice(at, branch(items, at) - at);
      return { items, at: Math.max(0, at - 1) };
    });
  }

  function addRow(): void {
    const now = listingNow();
    if (!now) return;
    const items: Item[] = [...now.held.items, {
      text: t('diagram.new.item'), depth: now.held.items[now.held.items.length - 1]?.depth ?? 0,
      closed: false, picked: false,
    }];
    pickRow({ id: now.id, index: items.length - 1 });
    options.apply(() => setItems(file, source, now.id, items), [now.id]);
  }

  /** Where a new shape goes: under the drawing, in the file's own numbers. */
  function emptySpot(): { x: number; y: number } {
    const boxes = [...laid.boxes.values()];
    if (boxes.length === 0) return { x: 0, y: 0 };
    return {
      x: round(Math.min(...boxes.map(b => b.x)) - laid.origin.x),
      y: round(Math.max(...boxes.map(b => b.y + b.height)) - laid.origin.y + 24),
    };
  }

  /** What can be done to a connection: straighten it, or take it away. */
  function lineItems(name: string): MenuItem[] {
    const edge = lineOf(name)?.edge;
    if (!edge) return [];
    const bent = (file.bends.get(name)?.points.length ?? 0) > 0;
    return [
      { label: t('diagram.canvas.editLineText'), run: () => beginLineText(name) },
      ...(bent ? [{
        label: t('diagram.canvas.straighten'),
        run: () => dropCorner('all'),
      }] : []),
      {
        label: t('diagram.canvas.deleteLine'),
        separated: bent,
        run: () => options.apply(() => disconnectNodes(file, source, edge.from, edge.to), []),
      },
    ];
  }

  /**
   * The menu a right click would open on what is picked — a shape, a
   * connection, or the drawing itself — for whoever has no right button to
   * click: a finger, or somebody who never thought to try it.
   */
  function pickedItems(): MenuItem[] {
    const id = primary();
    const own = id !== undefined ? shapeItems(id) : line !== undefined ? lineItems(line) : [];
    return [...own, ...drawingItems().map((item, index) => ({ ...item, separated: index === 0 && own.length > 0 }))];
  }

  /** The shapes of the palette, put where the pointer was or beside what is picked. */
  function paletteItems(event?: MouseEvent): MenuItem[] {
    return PALETTE.map((shape): MenuItem => ({
      label: t(`diagram.shape.${shape}`),
      icon: shapeIcon(shape),
      separated: shape === 'parallelogram',
      run: () => addShape(shape, event),
    }));
  }

  function addItems(event?: MouseEvent): MenuItem[] {
    return [
      ...paletteItems(event),
      ...drawingItems().map((item, index) => ({ ...item, separated: index === 0 })),
    ];
  }

  /**
   * Everything that can be put on the drawing. A screen leads with its parts
   * and keeps the plain shapes one step in; a flow is drawn in shapes, so
   * they come first and the pictures after.
   */
  function everythingItems(event?: MouseEvent): MenuItem[] {
    if (file.mode === 'flow') {
      return [...paletteItems(event), ...stencilItems(event).map((item, index) => ({ ...item, separated: index === 0 }))];
    }
    const parts = partItems(event);
    return [...parts, { label: t('diagram.canvas.shapes'), icon: shapeIcon('rect'), separated: true, items: paletteItems(event) }];
  }

  /**
   * Gives the picked shape another name, and its item in the item table
   * with it — the table knows the item by the shape's name.
   */
  function rename(was: string, now: string): void {
    options.apply(() => {
      const edit = renameNode(file, source, was, now);
      const table = options.itemSource;
      const also = table === undefined || file.itemTable === undefined ? undefined : renameItemId(file, table, was, now);
      return also ? { ...edit, also } : edit;
    }, picked.map(one => (one === was ? now : one)));
  }

  /** What can be done about the screen's item table as a whole, if anything. */
  function tableItems(): MenuItem[] {
    if (file.itemTable !== undefined) return options.itemSource !== undefined ? [syncItem()] : [];
    // Offered for any screen, items or not yet: a table made before the
    // items are drawn fills as they are, with "match".
    if (options.newItemTable === undefined || file.mode !== 'free') return [];
    return [{ label: t('diagram.canvas.makeItemTable'), run: makeItemTable }];
  }

  /**
   * Makes the screen's item table and names it in the screen: the file first,
   * already listing the items, so the screen is drawn with it the moment the
   * line that names it is written.
   */
  function makeItemTable(): void {
    const made = options.newItemTable!;
    const refused = made.create(newItemTable(file, locale));
    if (refused !== undefined) { options.onError?.(refused); return; }
    options.apply(() => linkItemTable(file, source, made.path), [...picked]);
  }

  /**
   * What the item table says about one shape, changed from the screen. Each
   * writes one line of the table and nothing of the drawing: the table is
   * where required and alignment are written, so it is where they change.
   */
  function itemListItems(shape: string): MenuItem[] {
    const table = options.itemSource!;
    // A cell of a table's column is that column's item.
    const id = itemOfShape(file, shape);
    const link = file.itemLinks?.links.get(id);
    const out: MenuItem[] = [];
    if (link) {
      out.push({
        label: link.required ? t('diagram.canvas.itemOptional') : t('diagram.canvas.itemRequired'),
        run: () => options.apply(() => setItemCell(file, table, id, 'required', !link.required), [shape]),
      });
      const sides = ['left', 'center', 'right', undefined] as const;
      out.push({
        label: t('diagram.canvas.itemAlign'),
        items: sides.map((side): MenuItem => ({
          label: t(side === undefined ? 'diagram.canvas.itemAlignPart' : `diagram.canvas.itemAlign.${side}`),
          run: () => options.apply(() => setItemCell(file, table, id, 'align', side), [shape]),
        })),
      });
    }
    out.push({ ...syncItem(), separated: link !== undefined });
    return out;
  }

  /** Lists the screen's items in its table, in the screen's order. */
  function syncItem(): MenuItem {
    const table = options.itemSource!;
    return {
      label: t('diagram.items.synced'),
      run: () => options.apply(() => {
        const edit = syncItemTable(file, table);
        if (!edit) throw new DiagramEditError(dgm('diagram.items.inStep'));
        return edit;
      }, [...picked]),
    };
  }

  /**
   * The parts library, on its own list. There are many of them and they are
   * pictures of particular things, so putting them among the shapes would bury
   * "四角" under a hundred routers.
   *
   * One row per kind, each opening the pictures of that kind. The whole set is
   * longer than a screen, and a screen's worth of scrolling is what the reader
   * pays whether the list is labelled or not; a row per kind is as long as the
   * number of kinds, and only the kind that was picked is ever shown.
   */
  /**
   * What can be put on this drawing, as a menu.
   *
   * A drawing that uses a parts library is written in that library's words —
   * `textbox`, `primary`, `checked` — so that is what the menu offers. The
   * pictures shipped with the tool are the answer only for a drawing with no
   * library to speak of, such as a network diagram.
   */
  function partItems(event?: MouseEvent): MenuItem[] {
    // A screen drawn with no library still wants a text box and a button,
    // which are no pictures: the shipped library's parts are offered, and the
    // first one put on it names that library in the file. The pictures stay
    // after them, for a drawing that is not a screen.
    const drawing = file.library.size > 0 ? { file, source } : file.mode === 'free' ? shipped() : undefined;
    if (!drawing) return stencilItems(event);
    const items = libraryItems(name => addPart(name, event, true, drawing), undefined, drawing.file);
    // An input comes with its label. For the odd one that should not, the
    // same parts again, as they are.
    if (drawing.file.mode === 'free' && [...drawing.file.library.keys()].some(name => isInputPart(name, drawing.file))) {
      items.push({
        label: t('diagram.canvas.addBare'), separated: true,
        items: libraryItems(name => addPart(name, event, false, drawing), undefined, drawing.file),
      });
    }
    // The pictures stay on a drawing that names a library too: putting one
    // screen part on it wrote the `use` line, and that is no reason for the
    // network pictures to be gone from it.
    items.push(...stencilItems(event).map((item, index) => ({ ...item, separated: index === 0 })));
    return items;
  }

  /**
   * The drawing as it would be with the shipped parts named — for a screen
   * that names no library, worked out on the text it will have once the
   * `use` line is written.
   */
  function shipped(): { file: DiagramFile; source: string } {
    const text = withLibrary(source, DEFAULT_LIBRARY);
    return { file: withParts(parseDiagram(text), () => undefined), source: text };
  }

  /**
   * An edit worked out on `drawing`, written as one change to the file as it
   * is: the `use` line a shipped part needs comes with the part.
   */
  function onFile(drawing: { file: DiagramFile; source: string }, edit: Edit): Edit {
    if (drawing.source === source) return edit;
    // Worked out on the text read as LF, written back in the file's own line
    // endings: a range measured on the one and applied to the other lands as
    // many bytes early as there are line breaks before it — and a CRLF file
    // ended up with its `free {` written twice.
    const after = applyEdit(drawing.source, edit);
    const written = source.includes('\r\n') ? after.replace(/\r?\n/g, '\r\n') : after;
    return editBetween(source, written, edit.phrase ?? dgm('diagram.did.addPart'));
  }

  /** Whether a part of the library is an input, which is drawn with a label. */
  function isInputPart(name: string, drawing: DiagramFile = file): boolean {
    return INPUTS.has(drawing.library.get(name)?.style.get('item')?.trim().toLowerCase() ?? '');
  }

  /**
   * Adds an input with its label, next to what is picked, and opens the
   * label's words: what the field is called is the next thing anyone does.
   */
  function addInput(name: string, event?: MouseEvent, drawing = { file, source }): void {
    const near = picked.length === 1 ? picked[0] : undefined;
    let added: AddedField;
    try {
      added = addField(drawing.file, drawing.source, {
        // The point is where it goes only when what is picked has no
        // arrangement to put it in.
        part: name, label: t('diagram.new.label'), near,
        at: event ? pointIn(event) : besidePicked() ?? emptySpot(),
      });
    } catch (error) {
      if (error instanceof DiagramEditError) { options.onError?.(describeEdit(error)); return; }
      throw error;
    }
    textPicks.set(owner, added.label);
    options.apply(() => onFile(drawing, added.edit), [added.item]);
  }

  /** Gives an input a label, and opens its words. */
  function labelInput(id: string): void {
    let added: AddedField;
    try {
      added = addLabel(file, source, id, t('diagram.new.label'));
    } catch (error) {
      if (error instanceof DiagramEditError) { options.onError?.(describeEdit(error)); return; }
      throw error;
    }
    textPicks.set(owner, added.label);
    options.apply(() => added.edit, [id]);
  }

  function stencilItems(event?: MouseEvent): MenuItem[] {
    const kinds = new Map<string, MenuItem[]>();
    for (const part of stencilParts(locale)) {
      const one: MenuItem = {
        label: part.label,
        icon: partIcon(part.body),
        run: () => addShape('text', event, part.name, part.label),
      };
      const kind = kinds.get(part.group);
      if (kind) kind.push(one);
      else kinds.set(part.group, [one]);
    }
    const menus = [...kinds].map(([group, items]): MenuItem => ({ label: group, items }));
    // A zone — the frame round a LAN or a DMZ — goes with the pictures: it is
    // what a network drawing puts them in. A drawing laid out by its flow has
    // nowhere to pin one.
    if (file.mode === 'free') {
      menus.push({
        label: t('diagram.canvas.addZone'),
        icon: shapeIcon('group'),
        run: () => addZoneHere(event),
      });
    }
    return menus;
  }

  /**
   * The library's parts, under the headings the library wrote them under.
   *
   * Forty parts in one list is a list nobody reads to the end, and the author
   * of the library already divided them — the same answer the picture menu
   * gives, taken from the file instead of from this code.
   */
  function libraryItems(run: (name: string) => void, current?: string, drawing: DiagramFile = file): MenuItem[] {
    const kinds = new Map<string, MenuItem[]>();
    for (const [name, part] of drawing.library) {
      const icon = part.style.get('icon');
      const drawn = icon === undefined ? undefined : stencilArt(icon);
      const one: MenuItem = {
        label: name,
        icon: drawn ? partIcon(drawn.body) : shapeIcon(part.shape),
        disabled: name === current,
        run: () => run(name),
      };
      // A heading of the shipped library is shown in the reader's language;
      // one the author wrote is the author's own words, and stays as written.
      const shipped = part.group === undefined ? undefined : DEFAULT_GROUPS[part.group];
      const group = part.group === undefined ? t('diagram.stencil.group.other')
        : shipped ? t(shipped as never) : part.group;
      const kind = kinds.get(group);
      if (kind) kind.push(one);
      else kinds.set(group, [one]);
    }
    return [...kinds].map(([group, items]): MenuItem => ({ label: group, items }));
  }

  /** Adds a shape written as one of the library's parts — an input with its label, unless told not to. */
  function addPart(name: string, event?: MouseEvent, labelled = true, drawing = { file, source }): void {
    repeats.set(owner, { kind: 'part', name, labelled });
    // A table's columns have their headings for labels: what is put in one is
    // the part alone, in a cell, not a field with words of its own beside it.
    const one = picked.length === 1 ? picked[0]! : undefined;
    const inTable = one !== undefined && tableOf(drawing.file, one) !== undefined;
    if (labelled && !inTable && drawing.file.mode === 'free' && isInputPart(name, drawing.file)) {
      addInput(name, event, drawing);
      return;
    }
    const into = beside();
    const at = file.mode === 'free' && !into
      ? (event ? pointIn(event) : besidePicked() ?? emptySpot())
      : undefined;
    options.apply(
      () => onFile(drawing, addNode(drawing.file, drawing.source, { shape: 'rect', text: '', at, part: name, into })),
      [nextShapeId(drawing.file, 'part', name)],
    );
  }

  function addShape(
    shape: ShapeKind, event?: MouseEvent, icon?: string, text = t('diagram.new.shape'),
  ): void {
    repeats.set(owner, { kind: 'shape', shape, icon, text });
    const into = beside();
    // A freely placed drawing has no engine to decide where a shape goes, so
    // the new one is pinned: at the pointer if it came from the drawing, under
    // the shape picked, or under the drawing. Unless something in an
    // arrangement is picked — then the arrangement is the engine, and it says where.
    const at = file.mode === 'free' && !into
      ? (event ? pointIn(event) : besidePicked() ?? emptySpot())
      : undefined;
    // Selected as soon as it exists, so the next gesture — dragging it, or
    // typing over its text — lands on the shape just added.
    options.apply(
      () => addNode(file, source, { shape, text, at, icon, into }),
      [nextShapeId(file, icon === undefined ? shape : 'part', icon)],
    );
  }

  /**
   * Where a new shape goes when something is picked: into the same container,
   * next to it.
   *
   * Somebody who picked the third field of a form and asked for another one
   * wants a fourth field, not a shape pinned on top of the drawing that then
   * has to be dragged in. A container picked itself takes it at the end —
   * that is the one gesture there is for "put something in here".
   */
  function beside(): { container: string; after?: string } | undefined {
    const one = picked.length === 1 ? picked[0] : undefined;
    if (one === undefined || file.mode !== 'free') return undefined;
    if (file.containers.has(one) && file.containers.get(one)?.kind !== 'tabs') {
      return { container: one };
    }
    const held = containerOf(file).get(one);
    // A shape with a pin was taken out of the arrangement on purpose; what is
    // added beside it belongs where it is, not where it came from.
    return held !== undefined && !file.layout.has(one)
      ? { container: held, after: one } : undefined;
  }

  /**
   * The point a press landed on, in the file's coordinates — what a pin holds.
   * Everything drawn on screen uses `pointOn` instead: the drawing is laid out
   * with a shift applied, and mixing the two puts the band and the line's ends
   * that shift away from the pointer.
   */
  function pointIn(event: MouseEvent): { x: number; y: number } {
    const rect = drawing.getBoundingClientRect();
    const factor = scale();
    return {
      x: round((event.clientX - rect.left) / factor - laid.origin.x),
      y: round((event.clientY - rect.top) / factor - laid.origin.y),
    };
  }

  /**
   * The picked shapes as the things they are parts of. A label and its input
   * are one field, held in a stack of their own: picking several fields by
   * dragging a band round them picks their labels and inputs, and stacking
   * those would try to pull each out of its own field. So each is taken as
   * its field, and a shape whose container is picked too goes with it.
   */
  function wholes(ids: readonly string[]): string[] {
    const held = containerOf(file);
    const out: string[] = [];
    for (const one of ids) {
      const field = fieldOf(file, one);
      const whole = field && field.kind !== 'left' ? field.container : one;
      if (!out.includes(whole)) out.push(whole);
    }
    return out.filter(one => {
      for (let at = held.get(one), depth = 0; at !== undefined && depth < 64; at = held.get(at), depth++) {
        if (out.includes(at)) return false;
      }
      return true;
    });
  }

  /** The shapes given, as a copy: the drawing as it is now, and where they are drawn in it. */
  function snapshot(ids: readonly string[]): Copied {
    const places = new Map([...laid.boxes].map(([key, box]) =>
      [key, { ...box, x: box.x - laid.origin.x, y: box.y - laid.origin.y }]));
    return { file, source, ids: [...ids], places };
  }

  /** Writes a copy into this drawing, moved by `by`, and picks what was made. */
  function paste(copied: Copied, by: { x: number; y: number }): void {
    if (file.mode !== 'free' && file.mode !== 'flow') return;
    let made: { edit: Edit; ids: string[] };
    try {
      made = duplicateNodes(file, source, copied, { x: Math.round(by.x), y: Math.round(by.y) });
    } catch (error) {
      if (error instanceof DiagramEditError) { options.onError?.(describeEdit(error)); preview = undefined; paint(); return; }
      throw error;
    }
    options.apply(() => made.edit, made.ids);
  }

  /**
   * The colours of a shape: its fill, its outline and its words, each a short
   * row of ready colours, "none", and the way back to what the theme or the
   * part says. They are written to the style section, where a hand-written
   * `{ fill: … }` would go — the menu is a way to write it, not a second
   * place for colours to live.
   */
  function colourItems(id: string): MenuItem {
    type Swatch = readonly [string, string];
    const FILLS: readonly Swatch[] = [
      ['#ffffff', 'white'], ['#f7f8fa', 'grey'], ['#e3f2fd', 'blue'], ['#e8f5e9', 'green'],
      ['#fff8e1', 'yellow'], ['#fdecea', 'red'],
    ];
    const LINES: readonly Swatch[] = [
      ['#3a4048', 'dark'], ['#d3d7dd', 'grey'], ['#1f5fa8', 'blue'], ['#2e7d32', 'green'], ['#b3261e', 'red'],
    ];
    const TEXTS: readonly Swatch[] = [
      ['#1c1f24', 'black'], ['#ffffff', 'white'], ['#1f5fa8', 'blue'], ['#2e7d32', 'green'], ['#b3261e', 'red'],
    ];
    const swatch = (colour: string): string => colour === 'none'
      ? '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke="#888"/><line x1="3" y1="13" x2="13" y2="3" stroke="#b3261e"/></svg>'
      : `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="2.5" width="11" height="11" fill="${colour}" stroke="#888"/></svg>`;
    const node = file.nodes.find(one => one.id === id);
    const set = (property: string, value: string | undefined): void => {
      if (lookOf(property, id) === value) return;
      options.apply(() => setNodeStyle(file, source, id, { [property]: value }), [id]);
    };
    const row = (property: string, swatches: readonly Swatch[], none: boolean): MenuItem[] => [
      ...swatches.map(([colour, name]): MenuItem => ({
        label: t(`diagram.canvas.colour.${name}` as never), icon: swatch(colour),
        disabled: lookOf(property, id) === colour,
        run: () => set(property, colour),
      })),
      ...(none ? [{
        label: t('diagram.canvas.noColour'), icon: swatch('none'),
        disabled: lookOf(property, id) === 'none',
        run: () => set(property, 'none'),
      }] : []),
      {
        label: t('diagram.canvas.defaultColour'), separated: true,
        disabled: lookOf(property, id) === undefined,
        run: () => set(property, undefined),
      },
    ];
    return {
      label: t('diagram.canvas.colours'), separated: true,
      disabled: node?.shape === 'line',
      items: [
        { label: t('diagram.canvas.fillColour'), items: row('fill', FILLS, true) },
        { label: t('diagram.canvas.lineColour'), items: row('line', LINES, true) },
        { label: t('diagram.canvas.textColour'), items: row('color', TEXTS, false) },
      ],
    };
  }

  /**
   * The picture a shape shows: chosen from a file, or taken away. Written as
   * the shape's `icon`, the path as the drawing writes it.
   */
  function pictureItems(id: string): MenuItem[] {
    const pick = options.pickPicture;
    const node = file.nodes.find(one => one.id === id);
    if (!pick || node === undefined || node.shape === 'line' || node.shape === 'group') return [];
    const own = file.style.get(id)?.get('icon');
    // Offered on a picture: the image part, or a shape already showing a file.
    // On every text box it was a line nobody wanted between the ones they do.
    if (own === undefined || (own !== 'ui/image' && !isIconPath(own))) return [];
    const items: MenuItem[] = [{
      label: t('diagram.canvas.pickPicture'),
      run: () => {
        void pick().then(path => {
          if (path === undefined) return;
          options.apply(() => setNodeStyle(file, source, id, { icon: path }), [id]);
        }).catch((error: unknown) => options.onError?.(String(error)));
      },
    }];
    if (own !== undefined && /\.(png|jpe?g|gif|svg|webp)$/i.test(own)) {
      items.push({
        label: t('diagram.canvas.dropPicture'),
        run: () => options.apply(() => setNodeStyle(file, source, id, { icon: undefined }), [id]),
      });
    }
    return items;
  }

  /**
   * One change made to each of several shapes, as one edit: each worked out on
   * the text the one before left, so their ranges never collide. A shape the
   * change does not apply to (already that part) is passed over.
   */
  function eachOf(
    ids: readonly string[], step: (now: DiagramFile, text: string, id: string) => Edit, phrase: Phrase,
  ): Edit {
    if (ids.length === 1) return step(file, source, ids[0]!);
    let text = source;
    let now: DiagramFile = file;
    let refused: unknown;
    let changed = false;
    for (const id of ids) {
      try {
        text = applyEdit(text, step(now, text, id));
        now = parseDiagram(text);
        changed = true;
      } catch (error) {
        if (!(error instanceof DiagramEditError)) throw error;
        refused = error;
      }
    }
    if (!changed) throw refused ?? new DiagramEditError(dgm('diagram.edit.noChange'));
    return editBetween(source, text, phrase);
  }

  /**
   * Where the words sit in a shape: left, centre or right. A shape the item
   * table aligns is aligned there — the table wins over the style, so writing
   * the style would change nothing on screen.
   */
  function alignItems(id: string): MenuItem[] {
    const node = file.nodes.find(n => n.id === id);
    if (!node || node.shape === 'line' || node.shape === 'group' || node.items.length > 0) return [];
    const targets = picked.filter(one => {
      const other = file.nodes.find(n => n.id === one);
      return other !== undefined && other.shape !== 'line' && other.shape !== 'group';
    });
    const current = file.style.get(id)?.get('align');
    const table = options.itemSource;
    const linked = (one: string): string | undefined => {
      if (table === undefined) return undefined;
      const item = itemOfShape(file, one);
      return file.itemLinks?.links.has(item) ? item : undefined;
    };
    const set = (side: 'left' | 'center' | 'right' | undefined): void => options.apply(() => {
      const inTable = targets.filter(one => linked(one) !== undefined);
      const inStyle = targets.filter(one => linked(one) === undefined);
      let drawingEdit: Edit | undefined;
      if (inStyle.length > 0) {
        drawingEdit = eachOf(inStyle, (_, text, one) => {
          const own = parseDiagram(text);
          return setNodeStyle(own, text, one, { align: side });
        }, dgm('diagram.did.alignText'));
      }
      let tableEdit: Edit | undefined;
      if (inTable.length > 0 && table !== undefined) {
        let text = table;
        for (const one of inTable) {
          try { text = applyEdit(text, setItemCell(file, text, linked(one)!, 'align', side)); } catch (error) {
            if (!(error instanceof DiagramEditError)) throw error;
          }
        }
        if (text !== table) {
          const first = setItemCell(file, table, linked(inTable[0]!)!, 'align', side);
          tableEdit = { ...editBetween(table, text, dgm('diagram.did.alignText')), ...(first.path === undefined ? {} : { path: first.path }) };
        }
      }
      if (drawingEdit && tableEdit) return { ...drawingEdit, also: tableEdit };
      const one = drawingEdit ?? tableEdit;
      if (!one) throw new DiagramEditError(dgm('diagram.edit.sameLook'));
      return one;
    }, [...picked]);
    const sides = ['left', 'center', 'right'] as const;
    return [{
      label: t('diagram.canvas.textAlign'),
      items: [
        ...sides.map((side): MenuItem => ({
          label: t(`diagram.canvas.textAlign.${side}`),
          icon: alignIcon(side === 'center' ? 'centre' : side),
          disabled: targets.length <= 1 && current === side,
          run: () => set(side),
        })),
        { label: t('diagram.canvas.textAlign.default'), separated: true, run: () => set(undefined) },
      ],
    }];
  }

  /**
   * Another picture for a shape that shows one of the shipped pictures — a
   * router for a switch. The screen's own controls are parts, not pictures,
   * and are changed with the part.
   */
  function iconItems(id: string): MenuItem[] {
    const icon = file.style.get(id)?.get('icon');
    if (icon === undefined || icon.startsWith('ui/') || stencilArt(icon) === undefined) return [];
    const targets = picked.filter(one => {
      const other = file.style.get(one)?.get('icon');
      return other !== undefined && !other.startsWith('ui/') && stencilArt(other) !== undefined;
    });
    const kinds = new Map<string, MenuItem[]>();
    for (const part of stencilParts(locale)) {
      if (part.name.startsWith('ui/')) continue;
      const one: MenuItem = {
        label: part.label,
        icon: partIcon(part.body),
        disabled: part.name === icon && targets.length <= 1,
        run: () => options.apply(() => eachOf(targets.length > 0 ? targets : [id],
          (_, text, shape) => setNodeStyle(parseDiagram(text), text, shape, { icon: part.name }), dgm('diagram.did.icon')), [...picked]),
      };
      const kind = kinds.get(part.group);
      if (kind) kind.push(one); else kinds.set(part.group, [one]);
    }
    return [{ label: t('diagram.canvas.changeIcon'), items: [...kinds].map(([group, list]): MenuItem => ({ label: group, items: list })) }];
  }

  /**
   * Keeping a shape off the screen's item table, or putting it back: `item: no`
   * in its own style. Every shape picked that is the same way goes with it.
   */
  function leaveOutItems(id: string): MenuItem[] {
    if (file.mode !== 'free') return [];
    const listed = itemShapes(file);
    const out = isLeftOut(file, id);
    if (!out && !listed.has(id)) return [];
    const targets = picked.filter(one => (out ? isLeftOut(file, one) : listed.has(one)));
    return [{
      label: t(out ? 'diagram.canvas.putBackItem' : 'diagram.canvas.leaveOutItem'),
      separated: true,
      run: () => options.apply(() => eachOf(targets.length > 0 ? targets : [id],
        (_, text, one) => setNodeStyle(parseDiagram(text), text, one, { item: out ? undefined : 'no' }),
        dgm(out ? 'diagram.did.putBackItem' : 'diagram.did.leaveOutItem')), [...picked]),
    }];
  }

  function shapeItems(id: string): MenuItem[] {
    const node = file.nodes.find(n => n.id === id);
    const items: MenuItem[] = [];
    // A table's rows and columns first: adding a row is what a table is
    // pressed for, and it should not be at the bottom of a long menu.
    const table = gridTableItems(id);
    if (table.length > 0) {
      const [first] = table;
      items.push(...(first?.items ?? [first!]).map((one, index): MenuItem => ({ ...one, separated: index === 0 ? false : one.separated === true })));
    }
    // What holds it: a stack whose members cover it can be picked from here.
    const holder = picked.length === 1 ? holderOf(id) : undefined;
    if (holder !== undefined) {
      items.push({ label: t('diagram.canvas.pickContainer', { id: holder }), separated: items.length > 0, run: () => pick([holder]) });
    }
    if (picked.length > 1) {
      // Grouping adds one line naming what is inside. Nothing moves, so the
      // drawing looks the same the moment after.
      const ids = wholes(picked);
      items.push({
        label: t('diagram.canvas.groupCount', { count: ids.length }),
        run: () => options.apply(() => groupNodes(file, source, ids, t('diagram.new.group')), ids),
      });
      // Into a new stack, in the order they are on screen. Where they are is
      // given in the file's own numbers, which is what a pin holds.
      const inFile = new Map([...laid.boxes].map(([key, box]) =>
        [key, { ...box, x: box.x - laid.origin.x, y: box.y - laid.origin.y }]));
      for (const flow of ['down', 'right'] as const) {
        items.push({
          label: t(flow === 'down' ? 'diagram.canvas.stackDown' : 'diagram.canvas.stackRight', { count: ids.length }),
          run: () => options.apply(() => stackNodes(file, source, ids, flow, inFile), ids),
        });
      }
    }
    // A shape that holds rows has no label of its own: what the menu offers is
    // the row that is picked, and only once one is.
    const held = listingOf(id);
    const onRow = held && row?.id === id ? row.index : undefined;
    items.push(
      // A line holds no words, so there is nothing for a text box to edit.
      {
        label: held ? t('diagram.canvas.editRowText') : t('diagram.canvas.editText'),
        run: () => (onRow === undefined ? beginText(id) : beginRow(id, onRow)),
        disabled: node?.shape === 'line' || (held !== undefined && onRow === undefined),
      },
      // The rows, said in words here as well as on the small buttons of the
      // bar: a row is what a list is for, and a picture alone is easy to miss.
      ...(held ? [
        {
          label: onRow !== undefined ? t('diagram.canvas.addRowBelow')
            : held.items.length === 0 ? t('diagram.canvas.addFirstRow') : t('diagram.canvas.addLastRow'),
          run: addRowHere,
        },
        { label: t('diagram.canvas.dropRow'), run: dropRowHere, disabled: onRow === undefined },
      ] : []),
      {
        label: connecting === undefined ? t('diagram.canvas.connect') : t('diagram.canvas.connectPick'),
        // A group can be either end: the line runs from its frame.
        run: () => { connecting = id; describe(); },
        disabled: picked.length > 1,
      },
      colourItems(id),
      ...alignItems(id),
      ...iconItems(id),
      ...pictureItems(id),
    );
    for (const shape of PALETTE) {
      items.push({
        label: t(`diagram.shape.${shape}`),
        icon: shapeIcon(shape),
        separated: shape === PALETTE[0] || shape === 'parallelogram',
        // Becoming a line means losing the words: the notation has nowhere to
        // keep them. So it is offered for a shape that has none, and a shape
        // with words is left to be emptied first — rather than quietly emptied.
        disabled: node?.shape === shape || node?.shape === 'group'
          || (node?.items.length ?? 0) > 0
          || (shape === 'line' && (node?.text ?? '') !== ''),
        run: () => options.apply(() => setNodeShape(file, id, shape), [id]),
      });
    }
    if (file.library.size > 0 && node?.shape !== 'group') {
      // A cell of a table's body is one of a column: changing it changes the
      // column, and changing just the one cell is offered beside it.
      const column = bodyColumnOf(id);
      if (column) {
        items.push({
          label: t('diagram.canvas.columnPart'),
          separated: true,
          items: libraryItems(
            name => options.apply(() => setColumnPart(file, source, column.table, column.col, name), [id])),
        });
      }
      // Every shape picked becomes the part, not only the last one pressed.
      const targets = picked.filter(one => file.nodes.find(n => n.id === one)?.shape !== 'group');
      items.push({
        label: column ? t('diagram.canvas.cellPart')
          : file.partOf.has(id) ? t('diagram.canvas.changePart') : t('diagram.canvas.makePart'),
        separated: column === undefined,
        items: libraryItems(
          name => options.apply(() => eachOf(targets.length > 0 ? targets : [id],
            (now, text, one) => setNodePart(now, text, one, name), dgm('diagram.did.changePart')), [...picked]),
          targets.length > 1 ? undefined : file.partOf.get(id)),
      });
    }
    items.push(...stateItems(id));
    items.push(...fieldItems(id));
    items.push(...flowItems(id));
    items.push(...scrollItems(id));
    if (file.itemTable !== undefined && options.itemSource !== undefined) {
      items.push({ label: t('diagram.canvas.itemList'), separated: true, items: itemListItems(id) });
    }
    items.push(...leaveOutItems(id));
    items.push({
      label: t('diagram.canvas.unpin'),
      separated: true,
      disabled: !canUnpin(file, id),
      run: () => options.apply(() => unpinNode(file, source, id), [id]),
    });
    const going = withFields(picked);
    items.push({
      label: deleteLabel(going),
      run: () => options.apply(() => removeNodes(file, source, going), []),
    });
    // An input goes with its label; taking the input alone is still there.
    if (going.length !== picked.length) {
      items.push({
        label: t('diagram.canvas.deleteInputOnly'),
        run: () => options.apply(() => removeNodes(file, source, [...picked]), []),
      });
    }
    return items;
  }

  /**
   * A table's own: giving an empty one cells, and rows and columns for one
   * that has them — at the row and column of the cell that is picked.
   */
  function gridTableItems(id: string): MenuItem[] {
    if (isEmptyTable(file, id)) {
      const columns = [1, 2, 3].map(number => t('diagram.table.column', { n: number }));
      return [{
        label: t('diagram.canvas.makeTable'), separated: true,
        run: () => options.apply(() => makeTable(file, source, id, columns), [`${id}H1`]),
      }];
    }
    const cell = tableOf(file, id);
    if (!cell) return [];
    const { table, row, col } = cell;
    const width = Math.max(1, ...(file.containers.get(table)?.cells.map(cells => cells.length) ?? [1]));
    const rows = file.containers.get(table)?.cells.length ?? 1;
    return [{
      label: t('diagram.canvas.table'), separated: true,
      items: [
        {
          label: t('diagram.canvas.tableRowBelow'),
          run: () => { repeats.set(owner, { kind: 'tableRow' }); options.apply(() => addTableRow(file, source, table, row), [id]); },
        },
        {
          label: t('diagram.canvas.tableColumnRight'),
          run: () => {
            repeats.set(owner, { kind: 'tableColumn' });
            options.apply(() => addTableColumn(file, source, table, col, t('diagram.table.column', { n: width + 1 })), [id]);
          },
        },
        ...(row === undefined ? [] : [{
          label: t('diagram.canvas.rowRole'), separated: true,
          items: (['head', 'body', 'foot'] as const).map((role): MenuItem => ({
            label: t(`diagram.canvas.rowRole.${role}`),
            disabled: rowRole(table, row) === role,
            run: () => options.apply(() => setRowRole(file, source, table, row, role), [id]),
          })),
        }]),
        ...(col === undefined ? [] : [{
          label: t('diagram.canvas.renameColumn'),
          run: () => beginColumnName(table, col, id),
        }]),
        {
          label: t('diagram.canvas.tableDropRow'), separated: true, disabled: row === undefined || rows <= 1,
          run: () => options.apply(() => removeTableRow(file, source, table, row!), [table]),
        },
        {
          label: t('diagram.canvas.tableDropColumn'), disabled: col === undefined || width <= 1,
          run: () => options.apply(() => removeTableColumn(file, source, table, col!), [table]),
        },
      ],
    }];
  }

  /** What a row of a table is: a heading, a row of the body, or a footer. */
  function rowRole(table: string, row: number): RowRole {
    const grid = file.containers.get(table);
    if (!grid) return 'body';
    const { head, foot } = rowRoles(grid);
    return row < head ? 'head' : row >= grid.cells.length - foot ? 'foot' : 'body';
  }

  /** The table and column of a cell of a table's body; undefined for any other shape. */
  /**
   * What a control on a screen is showing: a check box ticked or not — this
   * one shape, so a column of check boxes can tick some rows and not others —
   * and whether it can be used at all.
   */
  function stateItems(id: string): MenuItem[] {
    const node = file.nodes.find(one => one.id === id);
    if (!node || node.shape === 'group' || file.mode !== 'free') return [];
    const items: MenuItem[] = [];
    const state = checkState(file, id);
    if (state !== undefined) {
      items.push({
        label: t(state === 'on' ? 'diagram.canvas.uncheck' : 'diagram.canvas.check'),
        separated: true,
        run: () => options.apply(() => toggleCheck(file, source, id), [id]),
      });
    }
    const unseen = isHidden(file.style.get(id));
    const quiet = picked.filter(one => isHidden(file.style.get(one)) === unseen
      && file.nodes.find(n => n.id === one)?.shape !== 'group');
    items.push({
      label: t(unseen ? 'diagram.canvas.show' : 'diagram.canvas.hide'),
      separated: state === undefined,
      run: () => options.apply(() => eachOf(quiet.length > 0 ? quiet : [id],
        (_, text, one) => setVisible(text, one, unseen),
        dgm(unseen ? 'diagram.did.show' : 'diagram.did.hide')), [...picked]),
    });
    const disabled = isDisabled(file.style.get(id));
    // All that is picked goes the way the one pressed goes, so a mixed
    // selection ends up all usable or all not.
    const targets = picked.filter(one => {
      const other = file.nodes.find(n => n.id === one);
      return other !== undefined && other.shape !== 'group' && isDisabled(file.style.get(one)) === disabled;
    });
    items.push({
      label: t(disabled ? 'diagram.canvas.enable' : 'diagram.canvas.disable'),
      run: () => options.apply(() => eachOf(targets.length > 0 ? targets : [id],
        (_, text, one) => setEnabled(text, one, disabled),
        dgm(disabled ? 'diagram.did.enable' : 'diagram.did.disable')), [...picked]),
    });
    return items;
  }

  function bodyColumnOf(id: string): { table: string; col: number } | undefined {
    const cell = tableOf(file, id);
    if (!cell || cell.row === undefined || cell.col === undefined || cell.row < 0) return undefined;
    return rowRole(cell.table, cell.row) === 'body' ? { table: cell.table, col: cell.col } : undefined;
  }

  /**
   * How an area scrolls, for the container picked or the one the picked
   * shape is in. Any container can: a list, a table, a panel of a form.
   */
  function scrollItems(id: string): MenuItem[] {
    const ids = [file.containers.get(id)?.id, containerOf(file).get(id)].filter((one): one is string => one !== undefined);
    return [...new Set(ids)].map((name, index): MenuItem => ({
      label: t('diagram.canvas.scroll', { id: name }),
      separated: index === 0,
      items: (['none', 'down', 'right', 'both'] as const).map((scroll): MenuItem => ({
        label: t(`diagram.canvas.scroll.${scroll}`),
        disabled: file.containers.get(name)?.scroll === scroll,
        run: () => options.apply(() => setScroll(file, source, name, scroll), [id]),
      })),
    }));
  }

  /**
   * Opens a box over a column's heading for its name — the name the item
   * table knows the column by, which is changed there with it.
   */
  function beginColumnName(table: string, col: number, near: string): void {
    const grid = file.containers.get(table);
    const box = boxOf(grid?.cells[0]?.[col] ?? near) ?? boxOf(near);
    if (!grid || !box) return;
    const was = grid.names[col];
    const rect = drawing.getBoundingClientRect();
    const stageAt = stage.getBoundingClientRect();
    const factor = scale();
    const input = owner.createElement('input');
    input.className = 'dp-canvas-text';
    input.value = was ?? '';
    input.placeholder = String(col + 1);
    input.spellcheck = false;
    input.style.left = `${rect.left - stageAt.left + box.x * factor}px`;
    input.style.top = `${rect.top - stageAt.top + box.y * factor}px`;
    input.style.width = `${Math.max(80, box.width * factor)}px`;
    input.style.height = `${box.height * factor}px`;
    stage.append(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      input.remove();
      stage.focus({ preventScroll: true });
      if (!keep || name === '' || name === was) return;
      options.apply(() => {
        const edit = renameColumn(file, source, table, col, name);
        const itemTable = options.itemSource;
        const also = itemTable === undefined ? undefined
          : renameItemId(file, itemTable, `${table}.${was ?? String(col + 1)}`, `${table}.${name}`);
        return also ? { ...edit, also } : edit;
      }, [near]);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
  }

  /**
   * Which way a stack runs, turned from the menu: on the stack itself, or on
   * anything it holds. The container that does the arranging is named, since
   * a shape can sit in a stack inside another.
   */
  function flowItems(id: string): MenuItem[] {
    const ids = [file.containers.get(id)?.id, containerOf(file).get(id)].filter((one): one is string => one !== undefined);
    const out: MenuItem[] = [];
    for (const [index, name] of [...new Set(ids)].entries()) {
      const container = file.containers.get(name);
      if (container?.kind !== 'stack') continue;
      const across = container.flow === 'right';
      out.push({
        label: t(across ? 'diagram.canvas.flowDown' : 'diagram.canvas.flowRight', { id: name }),
        separated: index === 0 || out.length === 0,
        run: () => options.apply(() => setStackFlow(file, source, name, across ? 'down' : 'right'), [id]),
      });
    }
    return out;
  }

  /**
   * What a screen's inputs offer: a label for one that has none, and the
   * side its form puts labels on.
   */
  function fieldItems(id: string): MenuItem[] {
    if (file.mode !== 'free') return [];
    const out: MenuItem[] = [];
    const field = fieldOf(file, id);
    if (itemShapes(file).has(id) && field?.label === undefined) {
      out.push({ label: t('diagram.canvas.addLabel'), run: () => labelInput(id) });
    }
    const form = formOf(file, id);
    if (form) {
      const left = isLabelForm(file, form);
      out.push({
        label: left ? t('diagram.canvas.labelsTop') : t('diagram.canvas.labelsLeft'),
        run: () => options.apply(() => setLabelSide(file, source, id, left ? 'top' : 'left'), [id]),
      });
    }
    return out.map((one, index) => ({ ...one, separated: index === 0 }));
  }

  /**
   * A label's new words, and its item's name in the table with them — while
   * the name is still the label's old words. Only for a label that names one
   * item: a caption over a row of two inputs names neither on its own.
   */
  function withItemName(edit: Edit, id: string, was: string, now: string): Edit {
    const table = options.itemSource;
    const links = [...file.itemLinks?.links.values() ?? []].filter(link => link.label === id);
    if (table === undefined || links.length !== 1) return edit;
    const also = followLabel(file, table, links[0]!.id, was, now);
    return also ? { ...edit, also } : edit;
  }

  /** The shapes picked, and the labels and fields that go with the inputs among them. */
  function withFields(ids: readonly string[]): string[] {
    return [...new Set(ids.flatMap(id => fieldShapes(file, id)))];
  }

  function describeEdit(error: DiagramEditError): string {
    return describeError(error, locale);
  }

  /**
   * Says what else goes with it. Ctrl+Z brings it back, but a connection
   * that went with a shape is easy not to notice going, so it is said beforehand.
   * Deleting a group is an ungrouping: the line that names its contents goes,
   * and the contents stay where they are.
   */
  function deleteLabel(going: readonly string[] = picked): string {
    const ids = new Set(going);
    if (picked.length === 1 && file.nodes.find(n => n.id === picked[0])?.shape === 'group') {
      return t('diagram.canvas.ungroup');
    }
    const lines = file.edges.filter(e => ids.has(e.from) || ids.has(e.to)).length;
    // An input and its label are one thing to whoever deletes them.
    const what = picked.length > 1
      ? t('diagram.canvas.deleteCount', { count: picked.length })
      : going.length > picked.length ? t('diagram.canvas.deleteField') : t('diagram.canvas.delete');
    return lines === 0 ? what : t('diagram.canvas.deleteWithLines', { what, lines });
  }

  /**
   * Opens a text box over the shape. A box over the thing being renamed is not
   * decoration: it is where the IME needs somewhere to compose from, the same
   * reason the grid keeps one over the selected cell.
   */
  function beginText(id: string): void {
    const node = file.nodes.find(n => n.id === id);
    const box = boxOf(id);
    if (!node || !box || node.shape === 'line' || node.items.length > 0) return;
    const rect = drawing.getBoundingClientRect();
    const stageAt = stage.getBoundingClientRect();
    const factor = scale();

    const input = owner.createElement('input');
    input.className = 'dp-canvas-text';
    input.value = node.text;
    input.spellcheck = false;
    const left = rect.left - stageAt.left + box.x * factor;
    const top = rect.top - stageAt.top + box.y * factor;
    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.width = `${box.width * factor}px`;
    input.style.height = `${box.height * factor}px`;
    stage.append(input);

    // The same bar a paragraph and a table cell get: a label holds the same
    // inline Markdown they do, so it gets the same way of writing it.
    const toolbar = createToolbar(owner, mark => applyMark(mark), locale);
    toolbar.element.classList.add('dp-canvas-format');
    stage.append(toolbar.element);
    const bar = toolbar.element.getBoundingClientRect();
    // Above the shape, or below it when the shape is against the top edge.
    const above = top - bar.height - 4;
    toolbar.element.style.left = `${Math.max(0, left)}px`;
    toolbar.element.style.top = `${above >= 0 ? above : top + box.height * factor + 4}px`;

    input.focus();
    input.select();
    const sync = (): void =>
      toolbar.sync(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0);
    sync();

    function applyMark(mark: InlineMark): void {
      const change = toggleInline(
        input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0, mark);
      input.setRangeText(change.text, change.start, change.end, 'preserve');
      input.setSelectionRange(change.select.start, change.select.end);
      input.focus();
      sync();
    }

    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const text = input.value;
      input.remove();
      toolbar.element.remove();
      stage.focus({ preventScroll: true });
      if (!keep || text === node.text) return;
      options.apply(() => withItemName(setNodeText(file, id, text, options.source), id, node.text, text), [id]);
    };
    input.addEventListener('blur', () => finish(true));
    for (const event of ['input', 'select', 'keyup', 'click']) {
      input.addEventListener(event, sync);
    }
    input.addEventListener('keydown', event => {
      // Every key here belongs to the text, including the ones the canvas uses.
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        applyMark('bold');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        applyMark('italic');
      }
    });
  }

  /**
   * Opens a text box over a line's words — or, for a line with none, over the
   * middle of its longest stretch, where the words will be drawn.
   */
  function beginLineText(name: string): void {
    const route = lineOf(name);
    if (!route) return;
    if (line !== name) pickLine(name);
    let at = route.labelAt;
    if (!at) {
      let best = 0;
      for (let i = 0; i + 1 < route.points.length; i++) {
        const a = route.points[i]!; const b = route.points[i + 1]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length > best) { best = length; at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      }
    }
    if (!at) return;
    const rect = drawing.getBoundingClientRect();
    const stageAt = stage.getBoundingClientRect();
    const factor = scale();
    const was = route.edge.label ?? '';
    const input = owner.createElement('input');
    input.className = 'dp-canvas-text';
    input.value = was;
    input.spellcheck = false;
    const width = Math.max(120, (was.length + 4) * 13);
    input.style.left = `${rect.left - stageAt.left + at.x * factor - width / 2}px`;
    input.style.top = `${rect.top - stageAt.top + at.y * factor - 12}px`;
    input.style.width = `${width}px`;
    input.style.height = '24px';
    stage.append(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      input.remove();
      stage.focus({ preventScroll: true });
      if (!keep || text === was) return;
      const edge = route.edge;
      options.apply(() => setEdgeLabel(file, source, edge.from, edge.to, text), [], name);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
  }

  /**
   * Opens a text box over one row of a tree, a list or a menu.
   *
   * The row has no id, so there is no shape to place the box over: it goes
   * where `rowTextAt` says the words are drawn, which is the only way the box
   * and the picture can agree. Confirming writes the whole block back, because
   * one row is not a byte range the file has a line of its own for.
   */
  function beginRow(id: string, index: number): void {
    const held = listingOf(id);
    const box = boxOf(id);
    const item = held?.items[index];
    if (!held || !box || !item) return;
    const at = rowTextAt(held.icon, box, held.items, index);
    const rect = drawing.getBoundingClientRect();
    const stageAt = stage.getBoundingClientRect();
    const factor = scale();

    const input = owner.createElement('input');
    input.className = 'dp-canvas-text dp-canvas-row-text';
    input.value = item.text;
    input.spellcheck = false;
    input.style.left = `${rect.left - stageAt.left + at.x * factor}px`;
    input.style.top = `${rect.top - stageAt.top + at.y * factor}px`;
    input.style.width = `${Math.max(40, at.width * factor)}px`;
    input.style.height = `${at.height * factor}px`;
    stage.append(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      input.remove();
      stage.focus({ preventScroll: true });
      // Emptying the box is not how a row is removed — the button next to it
      // is — so an empty box leaves the row as it was rather than writing a
      // bullet with nothing after it.
      if (!keep || text === '' || text === item.text) return;
      const rows = held.items.map((one, i) => (i === index ? { ...one, text } : one));
      options.apply(() => setItems(file, source, id, rows), [id]);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', event => {
      // Every key here belongs to the text, including the ones the canvas uses.
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
  }

  // --- キーボード --------------------------------------------------------
  //
  // Everything the mouse does, the keyboard does too. A shape nudged by 4 is
  // still the same one line of the file.

  // Alt on its own, pressed for Alt+click, is VS Code's way into its menu bar:
  // the arrow keys pressed next would then move through the menu, not the
  // shape. The canvas keeps it.
  const keepAlt = (event: KeyboardEvent): void => { if (event.key === 'Alt') event.preventDefault(); };
  stage.addEventListener('keyup', keepAlt);
  stage.addEventListener('keydown', event => {
    if (event.key === 'Alt') { event.preventDefault(); return; }
    const ids = [...laid.boxes.keys()];
    const at = primary();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (connecting !== undefined) { connecting = undefined; describe(); return; }
      options.close();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (ids.length === 0) return;
      const index = at === undefined ? -1 : ids.indexOf(at);
      const step = event.shiftKey ? -1 : 1;
      const next = ids[(index + step + ids.length * 2) % ids.length];
      pick(next === undefined ? [] : [next]);
      return;
    }
    const chosen = lineOf(line);
    if ((event.key === 'Delete' || event.key === 'Backspace') && chosen) {
      event.preventDefault();
      const edge = chosen.edge;
      options.apply(() => disconnectNodes(file, source, edge.from, edge.to), []);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && picked.length > 0) {
      event.preventDefault();
      const ids = withFields(picked);
      const going = new Set(ids);
      // A deletion that takes connections with it is confirmed where the shape
      // is, the way the grid confirms a merge: Ctrl+Z would bring them back,
      // but only if anyone noticed they had gone.
      if (file.edges.some(e => going.has(e.from) || going.has(e.to))) {
        const box = boxOf(at);
        const rect = drawing.getBoundingClientRect();
        const factor = scale();
        menu.open(
          rect.left + ((box?.x ?? 0) + (box?.width ?? 0) / 2) * factor,
          rect.top + ((box?.y ?? 0) + (box?.height ?? 0)) * factor,
          [
            {
              label: deleteLabel(ids),
              run: () => options.apply(() => removeNodes(file, source, ids), []),
            },
            { label: BASE_MESSAGES.in(locale)('base.cancel'), run: () => {} },
          ],
        );
        return;
      }
      options.apply(() => removeNodes(file, source, ids), []);
      return;
    }
    // Copy, paste, and both at once. The copy is the drawing's own lines, so
    // it pastes into this drawing or another one opened in the same window.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 'c' && picked.length > 0) {
        event.preventDefault();
        clipboard = snapshot(wholes(picked));
        pastes = 0;
        return;
      }
      if (key === 'v' && clipboard) {
        event.preventDefault();
        pastes += 1;
        paste(clipboard, { x: PASTE_STEP * pastes, y: PASTE_STEP * pastes });
        return;
      }
      if (key === 'd' && picked.length > 0) {
        event.preventDefault();
        paste(snapshot(wholes(picked)), { x: PASTE_STEP, y: PASTE_STEP });
        return;
      }
      if (key === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }
    }
    if (event.key === 'F4') {
      event.preventDefault();
      repeat();
      return;
    }
    if (event.key === 'F2' && at !== undefined) {
      event.preventDefault();
      beginText(at);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    if (picked.length === 0) return;
    // Shift is the fine adjustment: one unit, for the last pixel of a screen.
    const by = event.shiftKey ? 1 : GRID;
    moving = movingSet();
    const targets = pinnedSet();
    if (targets.length === 0) return;
    const pins = new Map(targets.map(id => {
      const box = laid.boxes.get(id)!;
      return [id, {
        x: box.x - laid.origin.x + move[0]! * by,
        y: box.y - laid.origin.y + move[1]! * by,
      }];
    }));
    options.apply(() => pinNodes(file, source, pins), [...picked]);
  });

  /**
   * Every shape, as what it is part of: a shape a container or a field holds
   * is picked through its holder, so moving them all moves the arrangement
   * and does not pull each member out of it with a pin of its own.
   */
  function selectAll(): void {
    const ids = [...laid.boxes.keys()];
    if (ids.length === 0) return;
    const held = containerOf(file);
    const top = ids.filter(id => {
      for (let at = held.get(id), depth = 0; at !== undefined && depth < 64; at = held.get(at), depth++) {
        if (laid.boxes.has(at)) return false;
      }
      return true;
    });
    pick(file.mode === 'free' ? wholes(top) : top);
  }

  /** The last addition, again: F4, as in a spreadsheet. */
  function repeat(): void {
    const last = repeats.get(owner);
    if (!last) { options.onError?.(t('diagram.canvas.nothingToRepeat')); return; }
    switch (last.kind) {
      case 'part': {
        const drawing = file.library.size > 0 ? { file, source } : file.mode === 'free' ? shipped() : undefined;
        if (drawing) addPart(last.name, undefined, last.labelled, drawing);
        return;
      }
      case 'shape': addShape(last.shape, undefined, last.icon, last.text); return;
      case 'zone': addZoneHere(); return;
      case 'row': addRowHere(); return;
      case 'tableRow':
      case 'tableColumn': {
        const one = primary();
        const cell = one === undefined ? undefined : tableOf(file, one);
        if (!one || !cell) { options.onError?.(t('diagram.canvas.nothingToRepeat')); return; }
        const width = Math.max(1, ...(file.containers.get(cell.table)?.cells.map(cells => cells.length) ?? [1]));
        if (last.kind === 'tableRow') options.apply(() => addTableRow(file, source, cell.table, cell.row), [one]);
        else options.apply(() => addTableColumn(file, source, cell.table, cell.col, t('diagram.table.column', { n: width + 1 })), [one]);
        return;
      }
    }
  }

  /** A zone where the pointer was, or under the drawing. */
  function addZoneHere(event?: MouseEvent): void {
    repeats.set(owner, { kind: 'zone' });
    const at = event ? pointIn(event) : besidePicked() ?? emptySpot();
    options.apply(() => addZone(file, source, at, t('diagram.new.zone')), [nextZoneId(file)]);
  }

  /**
   * Under the shape picked, when it is placed by hand: where the next of a
   * run of the same thing goes. Undefined when nothing, or more than one
   * thing, is picked.
   */
  function besidePicked(): { x: number; y: number } | undefined {
    const one = picked.length === 1 ? picked[0] : undefined;
    const box = one === undefined ? undefined : laid.boxes.get(one);
    if (!box || file.mode !== 'free') return undefined;
    return { x: round(box.x - laid.origin.x), y: round(box.y + box.height - laid.origin.y + 8) };
  }

  /** Moves the whole drawing so its top left is (0, 0). Asked for, never done on the quiet. */
  function toOrigin(): void {
    options.apply(() => moveToOrigin(file, source), [...picked]);
  }

  /**
   * The menu that is not about any one shape: the item table, picking
   * everything, the last addition again, the drawing to (0, 0).
   */
  function drawingItems(): MenuItem[] {
    return [
      { label: t('diagram.canvas.selectAll'), run: selectAll },
      { label: t('diagram.canvas.repeat'), disabled: !repeats.has(owner), run: repeat },
      ...(file.layout.size > 0 ? [{ label: t('diagram.canvas.toOrigin'), run: toOrigin }] : []),
      ...tableItems().map((item, index) => ({ ...item, separated: index === 0 })),
      ...(options.drawingMenu?.() ?? []).map((item, index) => ({ ...item, separated: index === 0 })),
    ];
  }

  // --- 整列 --------------------------------------------------------------
  //
  // Lining shapes up by hand is what the snapping is for when there are two of
  // them; with six it is a command. Each shape gets its own offset, and they
  // all land in one write.

  type Edge = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

  function align(edge: Edge): void {
    const boxes = picked
      .map(id => [id, laid.boxes.get(id)] as const)
      .filter((pair): pair is readonly [string, Box] => pair[1] !== undefined);
    if (boxes.length < 2) return;

    const lefts = boxes.map(([, box]) => box.x);
    const rights = boxes.map(([, box]) => box.x + box.width);
    const tops = boxes.map(([, box]) => box.y);
    const bottoms = boxes.map(([, box]) => box.y + box.height);
    const target = {
      left: Math.min(...lefts),
      right: Math.max(...rights),
      centre: (Math.min(...lefts) + Math.max(...rights)) / 2,
      top: Math.min(...tops),
      bottom: Math.max(...bottoms),
      middle: (Math.min(...tops) + Math.max(...bottoms)) / 2,
    }[edge];

    const deltas = new Map<string, { x: number; y: number }>();
    for (const [id, box] of boxes) {
      switch (edge) {
        case 'left': deltas.set(id, { x: target - box.x, y: 0 }); break;
        case 'right': deltas.set(id, { x: target - (box.x + box.width), y: 0 }); break;
        case 'centre': deltas.set(id, { x: target - (box.x + box.width / 2), y: 0 }); break;
        case 'top': deltas.set(id, { x: 0, y: target - box.y }); break;
        case 'bottom': deltas.set(id, { x: 0, y: target - (box.y + box.height) }); break;
        case 'middle': deltas.set(id, { x: 0, y: target - (box.y + box.height / 2) }); break;
      }
    }
    shiftAll(deltas, dgm('diagram.did.align'));
  }

  /** Spreads the picked shapes so the gaps between them are equal. */
  function spread(axis: 'x' | 'y'): void {
    const boxes = picked
      .map(id => [id, laid.boxes.get(id)] as const)
      .filter((pair): pair is readonly [string, Box] => pair[1] !== undefined)
      .sort((a, b) => a[1][axis] - b[1][axis]);
    if (boxes.length < 3) return;
    const size = axis === 'x' ? 'width' : 'height';
    const first = boxes[0]![1];
    const last = boxes[boxes.length - 1]![1];
    const room = (last[axis] + last[size]) - first[axis]
      - boxes.reduce((total, [, box]) => total + box[size], 0);
    const gap = room / (boxes.length - 1);

    const deltas = new Map<string, { x: number; y: number }>();
    let at = first[axis];
    for (const [id, box] of boxes) {
      deltas.set(id, axis === 'x' ? { x: at - box.x, y: 0 } : { x: 0, y: at - box.y });
      at += box[size] + gap;
    }
    shiftAll(deltas, dgm('diagram.did.spread'));
  }

  /**
   * Moves each shape by its own offset. A group moves what it holds, the same
   * way dragging it does.
   */
  function shiftAll(deltas: ReadonlyMap<string, { x: number; y: number }>, what: Phrase): void {
    const pins = new Map<string, { x: number; y: number }>();
    const add = (id: string, by: { x: number; y: number }): void => {
      const node = file.nodes.find(n => n.id === id);
      if (node?.shape === 'group') {
        for (const child of groupMembers(file, id)) add(child, by);
        if (!file.layout.has(id)) return;
      }
      const box = laid.boxes.get(id);
      if (!box) return;
      pins.set(id, {
        x: round(box.x - laid.origin.x + by.x),
        y: round(box.y - laid.origin.y + by.y),
      });
    };
    for (const [id, by] of deltas) add(id, by);
    if (pins.size === 0) return;
    options.apply(() => ({ ...pinNodes(file, source, pins), ...described(what) }), [...picked]);
  }

  // --- 操作列 ------------------------------------------------------------

  function describe(): void {
    // A shape that cannot be handed back says so before it is pressed, not
    // after: in a freely placed drawing there is no engine to hand it to.
    const at = primary();
    if (release) {
      release.disabled = picked.length !== 1 || at === undefined || !canUnpin(file, at);
      // A shape a container holds has somewhere to go back to, and saying
      // "the layout engine" about a form's own frame would mean nothing.
      const inContainer = at !== undefined && containerOf(file).has(at);
      release.textContent = inContainer ? t('diagram.canvas.backToContainer') : t('diagram.canvas.unpin');
      release.title = picked.length === 1 && at !== undefined && !canUnpin(file, at)
        && file.mode !== 'flow'
        ? t('diagram.canvas.freeCannotUnpin')
        : inContainer
          ? t('diagram.canvas.unpinToContainer')
          : t('diagram.canvas.unpinToEngine');
    }
    if (aligners) aligners.hidden = picked.length < 2;
    for (const button of spreaders) button.disabled = picked.length < 3;
    const alone = picked.length === 1 ? file.nodes.find(n => n.id === picked[0]) : undefined;
    if (liners) liners.hidden = alone?.shape !== 'line';
    const inRow = listingNow()?.held;
    if (rows) rows.hidden = inRow === undefined;
    for (const button of rowButtons) {
      const adds = button.dataset.rowAdd === 'add';
      // Everything but adding needs a row to act on. Adding is what is left
      // when there is none — otherwise an empty list has no way back.
      // A list or a menu has no depths and no branches: those buttons are not
      // shown for it at all, rather than shown and dead.
      button.hidden = button.dataset.rowOnly === 'tree' && inRow?.icon !== 'ui/tree';
      button.disabled = row === undefined && !adds;
      if (adds) {
        button.title = row !== undefined ? t('diagram.canvas.addRowBelow')
          : (inRow?.items.length ?? 0) === 0 ? t('diagram.canvas.addFirstRow') : t('diagram.canvas.addLastRow');
      }
    }
    for (const button of lookButtons) {
      const [property, value] = (button.dataset.look ?? '=').split('=');
      button.classList.toggle('dp-canvas-on',
        alone !== undefined
        && lookOf(property ?? '', alone.id) === (value === '' ? undefined : value));
    }
    if (!where) return;
    if (naming) naming.hidden = true;
    if (connecting !== undefined) {
      where.textContent = t('diagram.canvas.connectFrom', { id: connecting });
      return;
    }
    const chosen = lineOf(line);
    if (chosen) {
      where.textContent = t('diagram.canvas.lineName', { from: chosen.edge.from, to: chosen.edge.to });
      if (hint) {
        hint.textContent = t('diagram.canvas.lineHint');
      }
      return;
    }
    if (hint) {
      // A row is picked inside a shape, so the line about the shape would be
      // answering a question nobody asked. The buttons are small pictures;
      // this is where they are named.
      hint.textContent = row !== undefined
        ? t('diagram.canvas.rowHint')
        : alone?.shape === 'line'
          ? t('diagram.canvas.lineShapeHint')
          : HINT;
    }
    if (picked.length > 1) {
      where.textContent = t('diagram.canvas.pickedCount', { count: picked.length });
      return;
    }
    const box = preview?.box ?? boxOf(at);
    if (at === undefined || !box) {
      where.textContent = t('diagram.canvas.pickShape');
      return;
    }
    const pinned = file.layout.has(at) ? t('diagram.canvas.pinned') : t('diagram.canvas.auto');
    if (naming && file.nodes.some(node => node.id === at)) {
      naming.hidden = false;
      // Not while it is being typed in: a redraw must not take the words back.
      if (owner.activeElement !== naming || naming.dataset.id !== at) naming.value = at;
      naming.dataset.id = at;
      naming.size = Math.max(6, at.length + 2);
      where.textContent = `${round(box.x - laid.origin.x)}, `
        + `${round(box.y - laid.origin.y)}  ${round(box.width)}×${round(box.height)}  (${pinned})`;
      return;
    }
    where.textContent = `${at}  ${round(box.x - laid.origin.x)}, `
      + `${round(box.y - laid.origin.y)}  ${round(box.width)}×${round(box.height)}  (${pinned})`;
  }

  /**
   * What a declaration says for this shape now. `arrow: none` and no `arrow` at
   * all are the same drawing, so they are the same answer: a button should be
   * marked for what is on screen, not for which words happen to be in the file.
   */
  function lookOf(property: string, id: string): string | undefined {
    const value = file.style.get(id)?.get(property);
    return property === 'arrow' && value === 'none' ? undefined : value;
  }

  function createBar(): HTMLElement {
    const node = element('div', 'dp-canvas-bar');
    // The picked shape's name, to change where it is shown: renaming it
    // renames every line that names it.
    naming = owner.createElement('input');
    naming.className = 'dp-canvas-name';
    naming.spellcheck = false;
    naming.title = t('diagram.canvas.renameTitle');
    naming.hidden = true;
    naming.addEventListener('pointerdown', event => event.stopPropagation());
    naming.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      const box = naming!;
      const was = box.dataset.id ?? '';
      if (event.key === 'Escape') { event.preventDefault(); box.value = was; stage.focus({ preventScroll: true }); return; }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const now = box.value.trim();
      if (now === '' || now === was) { box.value = was; stage.focus({ preventScroll: true }); return; }
      rename(was, now);
    });
    naming.addEventListener('blur', () => { naming!.value = naming!.dataset.id ?? ''; });
    node.append(naming);
    where = element('span', 'dp-canvas-where');
    node.append(where);

    const add = (label: string, title: string, run: () => void): HTMLButtonElement => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      node.append(button);
      return button;
    };

    // Lining up is a command once there are more than two shapes, so the row
    // appears with the selection that makes it mean something.
    aligners = element('span', 'dp-canvas-aligners');
    const spread_: HTMLButtonElement[] = [];
    const icon = (picture: string, title: string, run: () => void, keep = false): void => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.className = 'dp-canvas-icon';
      button.innerHTML = picture;
      button.title = title;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      aligners?.append(button);
      if (keep) spread_.push(button);
    };
    icon(alignIcon('left'), t('diagram.canvas.alignLeft'), () => align('left'));
    icon(alignIcon('centre'), t('diagram.canvas.alignCentre'), () => align('centre'));
    icon(alignIcon('right'), t('diagram.canvas.alignRight'), () => align('right'));
    icon(alignIcon('top'), t('diagram.canvas.alignTop'), () => align('top'));
    icon(alignIcon('middle'), t('diagram.canvas.alignMiddle'), () => align('middle'));
    icon(alignIcon('bottom'), t('diagram.canvas.alignBottom'), () => align('bottom'));
    icon(alignIcon('spread-x'), t('diagram.canvas.spreadX'), () => spread('x'), true);
    icon(alignIcon('spread-y'), t('diagram.canvas.spreadY'), () => spread('y'), true);
    spreaders = spread_;
    node.append(aligners);

    // The look of a line: where it points, how thick it is. It appears with a
    // line picked, the way the lining-up row appears with several shapes — and
    // it writes to the style section, which is where every other look lives.
    liners = element('span', 'dp-canvas-liners');
    const looks: HTMLButtonElement[] = [];
    const look = (
      picture: string, title: string, property: string, value: string | undefined,
    ): void => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.className = 'dp-canvas-icon';
      button.innerHTML = picture;
      button.title = title;
      button.dataset.look = `${property}=${value ?? ''}`;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        const id = primary();
        if (id === undefined || lookOf(property, id) === value) return;
        options.apply(() => setNodeStyle(file, source, id, { [property]: value }), [id]);
      });
      liners?.append(button);
      looks.push(button);
    };
    look(lineIcon('arrow-none'), t('diagram.canvas.arrowNone'), 'arrow', undefined);
    look(lineIcon('arrow-end'), t('diagram.canvas.arrowEnd'), 'arrow', 'end');
    look(lineIcon('arrow-start'), t('diagram.canvas.arrowStart'), 'arrow', 'start');
    look(lineIcon('arrow-both'), t('diagram.canvas.arrowBoth'), 'arrow', 'both');
    look(lineIcon('weight-1'), t('diagram.canvas.weightThin'), 'weight', undefined);
    look(lineIcon('weight-2'), t('diagram.canvas.weightMedium'), 'weight', '2.5');
    look(lineIcon('weight-4'), t('diagram.canvas.weightThick'), 'weight', '4');
    lookButtons = looks;
    node.append(liners);

    // The rows of a tree, a list or a menu. One row at a time, because that is
    // how they are read and how they are written.
    rows = element('span', 'dp-canvas-rows');
    const rowed: HTMLButtonElement[] = [];
    const onRow = (
      picture: string, title: string, run: () => void, only?: 'tree', marks?: 'add',
    ): void => {
      const button = owner.createElement('button');
      button.type = 'button';
      button.className = 'dp-canvas-icon';
      button.innerHTML = picture;
      button.title = title;
      if (only) button.dataset.rowOnly = only;
      if (marks) button.dataset.rowAdd = marks;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      rows?.append(button);
      rowed.push(button);
    };
    // Every one of these acts on the branch, not on the line: a row and what
    // is nested under it are one thing on the screen, and moving or removing
    // the row alone would leave its children hanging off whatever came before
    // — a different tree than the one anybody asked for, and sometimes one
    // with a gap in its depths that cannot be drawn at all.
    onRow(rowIcon('add'), t('diagram.canvas.addRowBelow'), addRowHere, undefined, 'add');
    onRow(rowIcon('drop'), t('diagram.canvas.dropRow'), dropRowHere);
    onRow(rowIcon('in'), t('diagram.canvas.deeper'), () => changeRows((items, at) => {
      // A row can only be as deep as one step past the row above it: a gap in
      // the depths is a tree nobody can draw.
      const most = at === 0 ? 0 : (items[at - 1]?.depth ?? 0) + 1;
      const one = items[at];
      if (!one || one.depth >= most) return undefined;
      return { items: deepen(items, at, 1), at };
    }), 'tree');
    onRow(rowIcon('out'), t('diagram.canvas.shallower'), () => changeRows((items, at) => {
      const one = items[at];
      if (!one || one.depth === 0) return undefined;
      return { items: deepen(items, at, -1), at };
    }), 'tree');
    onRow(rowIcon('pick'), t('diagram.canvas.pickRow'), () => changeRows((items, at) => {
      const was = items[at]?.picked ?? false;
      // One row at a time is chosen, as on the screen being drawn.
      return { items: items.map((one, i) => ({ ...one, picked: i === at && !was })), at };
    }));
    onRow(rowIcon('fold'), t('diagram.canvas.fold'), () => changeRows((items, at) => {
      const one = items[at];
      if (!one) return undefined;
      items[at] = { ...one, closed: !one.closed };
      return { items, at };
    }), 'tree');
    rowButtons = rowed;
    node.append(rows);

    // One menu for everything that can be put on the drawing — parts, shapes,
    // pictures — and one for what can be done to what is picked. The rest
    // (back to automatic, the item table) lives in those two.
    add(t('diagram.canvas.add'), t('diagram.canvas.addTitle'), () => {
      const at = bar.getBoundingClientRect();
      menu.open(at.left + 8, at.bottom + 4, everythingItems());
    });
    // Area selection, on until it is pressed again.
    // Read from the map, not through bandMode(): the bar is built before that is declared.
    const banding = add(t('diagram.canvas.bandMode'), t('diagram.canvas.bandModeTitle'), () => {
      bandModes.set(owner, bandModes.get(owner) !== true);
      banding.classList.toggle('dp-canvas-on', bandModes.get(owner) === true);
    });
    banding.classList.toggle('dp-canvas-on', bandModes.get(owner) === true);
    add(t('diagram.canvas.source'), t('diagram.canvas.sourceTitle'), () => {
      const open = options.openSourceFile;
      if (!open) { options.showSource(); return; }
      const at = bar.getBoundingClientRect();
      menu.open(at.left + 8, at.bottom + 4, [
        { label: t('diagram.canvas.sourceFile'), run: open },
        { label: t('diagram.canvas.sourceHere'), run: () => options.showSource() },
      ]);
    });
    add(t('diagram.canvas.more'), t('diagram.canvas.moreTitle'), () => {
      const at = bar.getBoundingClientRect();
      menu.open(at.right - 8, at.bottom + 4, pickedItems());
    }).classList.add('dp-canvas-more');

    hint = element('span', 'dp-canvas-hint');
    hint.textContent = HINT;
    node.append(hint);
    return node;
  }

  describe();
  paint();
  return {
    element: root,
    focus: () => {
      stage.focus({ preventScroll: true });
      // The label of an input just added: its words are what comes next.
      const pending = textPicks.get(owner);
      textPicks.delete(owner);
      if (pending !== undefined && file.nodes.some(n => n.id === pending)) beginText(pending);
    },
  };
}

/** Ids come from the file, so they may hold anything a quoted name can. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function round(value: number): number {
  return Math.round(value);
}
