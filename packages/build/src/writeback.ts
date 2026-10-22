// A deck that came back, written into the drawings it came from.
//
// PowerPoint is the second editor for these drawings. Someone receives a deck,
// moves a box, retypes a label, and sends it back — and the point of putting
// node ids into the slides is that those two edits can be written into the
// `.dgm` as the same byte-range changes the canvas would have made.
//
// What cannot be read back is not guessed at. A shape nobody recognises, a
// label whose formatting was flattened, a drawing whose slide lost its name:
// each is reported. Silently dropping an edit someone made by hand is the
// worst thing this could do.

import {
  applyEdit, replaceBytes, spanInFile, toLf, type Edit,
} from '@docpresenter/base';
import {
  layOutDiagram, lineText, parseDiagram, parseLabel, pinNodes, setNodeText,
  type DiagramFile, type Pin,
} from '@docpresenter/diagram';
import { readDrawings } from '@docpresenter/pptx';
import { DEFAULT_LOCALE, describeError, type Locale } from '@docpresenter/base';
import { said } from './messages.js';
import type { BuildDiagnostic, Workspace } from './workspace.js';

export interface WriteBack {
  /** The `.dgm` this concerns. */
  readonly path: string;
  readonly source: string;
  /** What the file becomes. Identical to `source` when nothing changed. */
  readonly text: string;
  readonly changes: readonly string[];
}

export interface WriteBackResult {
  readonly files: readonly WriteBack[];
  readonly diagnostics: readonly BuildDiagnostic[];
}

/** How far a shape has to move before it counts as moved, in drawing pixels. */
const MOVED = 2;

export function writeBack(pptx: Uint8Array, workspace: Workspace, locale: Locale = DEFAULT_LOCALE): WriteBackResult {
  const { drawings, tables, diagnostics: read } = readDrawings(pptx, locale);
  const diagnostics: BuildDiagnostic[] = read.map(message => ({
    severity: 'warning', message, path: '',
  }));
  // A table changed in PowerPoint is not written back. Said, so the edit is
  // carried over by hand rather than lost.
  for (const table of tables) {
    if (!table.changed) continue;
    diagnostics.push({
      severity: 'warning', path: table.source,
      ...said(locale, 'build.writeback.table', { path: table.source, slide: table.slide }),
    });
  }
  const files: WriteBack[] = [];

  for (const drawing of drawings) {
    if (drawing.source === '') continue;
    const source = workspace.read(drawing.source);
    if (source === undefined) {
      diagnostics.push({
        severity: 'error', path: drawing.source,
        ...said(locale, 'build.writeback.missing'),
      });
      continue;
    }

    // Measured on the LF text, like every other range the build speaks
    // (asLf), and each edit restated for the file as it is: a CRLF file stays
    // CRLF, and nothing outside the edit changes.
    const measured = toLf(source);
    let file: DiagramFile;
    try {
      file = parseDiagram(measured);
    } catch (error) {
      diagnostics.push({
        severity: 'error', path: drawing.source,
        ...said(locale, 'build.unreadable', { message: describeError(error, locale) }),
      });
      continue;
    }

    // Where the slide drew each shape: the layout of the file the deck was
    // built from. Taken before any label is written back — a shorter label
    // lays out narrower and shifts its neighbours, and comparing the slide
    // with *that* would pin every shape the author never touched.
    const drawn = layOutDiagram(file);

    let text = measured;
    let written = source;
    const changes: string[] = [];
    const apply = (edit: Edit): void => {
      const there = spanInFile(written, edit);
      written = replaceBytes(written, there.span.start, there.span.end, there.text);
      text = applyEdit(text, edit);
      file = parseDiagram(text);
    };

    // Text first: a label is written by its own line, and moving a shape
    // rewrites a line in the layout block, so the two never collide — but the
    // file is re-read between them so every byte range stays true.
    for (const shape of drawing.shapes) {
      const node = file.nodes.find(one => one.id === shape.id);
      if (!node) {
        diagnostics.push({
          severity: 'warning', path: drawing.source,
          ...said(locale, 'build.writeback.extraShape', { id: shape.id }),
        });
        continue;
      }
      if (node.shape === 'group') continue;        // a group's label is its own
      // A slide's text holds its lines run together, so a `\n` the label
      // broke at is not a change.
      const shown = lineText(parseLabel(node.text)).replace(/\n/g, '');
      if (shape.text === shown || shape.text === '') continue;
      if (shown !== node.text) {
        diagnostics.push({
          severity: 'warning', path: drawing.source,
          ...said(locale, 'build.writeback.formatted', { id: shape.id, from: node.text, to: shape.text }),
        });
      }
      apply(setNodeText(file, shape.id, shape.text, text));
      changes.push(said(locale, 'build.writeback.text', { id: shape.id, text: shape.text }).message);
    }

    // A slide holds the drawing as it was laid out, which is not where the
    // file says things are: a computed layout has no coordinates at all, and
    // even a pinned one is shifted to sit on the canvas. So a shape is compared
    // with where it was drawn, and only what moved becomes a pin — pinning
    // everything would turn a computed drawing into a hand-placed one, which
    // is the opposite of what the layout layer is for.
    const laid = drawn;
    const pins = new Map<string, Pin>();
    for (const shape of drawing.shapes) {
      const node = file.nodes.find(one => one.id === shape.id);
      const box = laid.boxes.get(shape.id);
      if (!node || !box) continue;
      const pin = file.layout.get(shape.id);
      const moved = Math.abs(box.x - shape.x) > MOVED || Math.abs(box.y - shape.y) > MOVED;
      const resized = Math.abs(box.width - shape.width) > MOVED
        || Math.abs(box.height - shape.height) > MOVED;
      if (!moved && !resized) continue;
      pins.set(shape.id, {
        x: Math.round(shape.x - laid.origin.x),
        y: Math.round(shape.y - laid.origin.y),
        ...(pin?.width !== undefined || resized ? { width: shape.width } : {}),
        ...(pin?.height !== undefined || resized ? { height: shape.height } : {}),
        ...(pin?.z !== undefined ? { z: pin.z } : {}),
      });
    }
    if (pins.size > 0) {
      apply(pinNodes(file, text, pins));
      changes.push(said(locale, 'build.writeback.moved', { ids: [...pins.keys()].join(locale === 'ja' ? '・' : ', ') }).message);
    }

    for (const id of drawing.unknown) {
      diagnostics.push({
        severity: 'warning', path: drawing.source,
        ...said(locale, 'build.writeback.unreadable', { id }),
      });
    }

    // A line's label retyped in PowerPoint is not written back yet. Said out
    // loud rather than passed over: an edit someone made by hand is never
    // dropped in silence.
    for (const label of drawing.edgeLabels) {
      const edge = file.edges.find(one => one.from === label.from && one.to === label.to);
      // Its lines come back run together, as a shape's do.
      const was = edge?.label === undefined ? '' : lineText(parseLabel(edge.label)).replace(/\n/g, '');
      if (!edge || label.text === was) continue;
      diagnostics.push({
        severity: 'warning', path: drawing.source,
        ...said(locale, 'build.writeback.edgeLabel', { from: label.from, to: label.to, was, now: label.text }),
      });
    }

    files.push({ path: drawing.source, source, text: written, changes });
  }

  return { files, diagnostics };
}
