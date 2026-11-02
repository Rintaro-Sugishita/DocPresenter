// A field of a screen: an input and the label that says what it is for.
//
// A label and its input are drawn together almost every time, so they are
// added, moved and taken away together. Nothing new is written for it: a
// field is the arrangement the screens already used — a stack holding the
// label over the input — or, where a product puts its labels on the left, one
// row of a grid that holds the whole form, so that every input starts at the
// same place because one column is one width. Which of the two a product
// uses is its library's to say; where a field goes on a screen that already
// has some is the screen's.

import { byteLength, sliceBytes, type Edit } from '@docpresenter/base';
import { containerOf, members, EMPTY_CELL } from './arrange.js';
import {
  DiagramEditError, formatPlacement, idWidth, splice, whole, type Change,
} from './edits.js';
import { itemShapes } from './items.js';
import { dgm } from './messages.js';
import type { Container, DiagramFile } from './model.js';

/** Where a product puts the label of an input. */
export type LabelSide = 'top' | 'left';

/**
 * An input and its label, as the screen holds them.
 *
 * - `top`: a stack down the page, the label over the input.
 * - `row`: a stack across, the box first and its words after — a check box.
 * - `left`: one row of a grid, the label in the cell before the input.
 */
export interface Field {
  readonly kind: 'top' | 'row' | 'left';
  readonly item: string;
  /** The words that say what the item is; none for an input given no label yet. */
  readonly label: string | undefined;
  /** The stack that is the field (`top`, `row`), or the grid it is a row of (`left`). */
  readonly container: string;
  /** `left` only: which row of the grid. */
  readonly row?: number | undefined;
}

/** Between a label and the input under it, and across a check box's row. */
const TOP_GAP = 2;
const ROW_GAP = 8;
/** Between the label column and the input column of a form, and its rows. */
const FORM_GAP = { y: 12, x: 12 };
/** A label column with no width written yet: as wide as the longest label. */
const LABEL_COLUMN = 'auto';
/** The pictures whose words come after them, on the same line. */
const BESIDE = new Set(['ui/check', 'ui/check-on', 'ui/radio', 'ui/radio-on']);

/** The words that label an item: a shape of words with no frame, not an item, not a container. */
export function isCaption(file: DiagramFile, id: string | undefined, items = itemShapes(file)): boolean {
  if (id === undefined || id === EMPTY_CELL) return false;
  const node = file.nodes.find(one => one.id === id);
  return node !== undefined && node.shape === 'text' && node.text.trim() !== ''
    && !items.has(id) && !file.containers.has(id);
}

/** Whether an item's words go after it on its row: a check box, a radio button. */
export function labelsBeside(file: DiagramFile, id: string): boolean {
  return BESIDE.has(file.style.get(id)?.get('icon') ?? '');
}

/**
 * Where the library puts labels: what its `label` part says with `field:`,
 * on top unless it says left.
 */
export function labelSide(file: DiagramFile): LabelSide {
  return file.library.get('label')?.style.get('field')?.trim() === 'left' ? 'left' : 'top';
}

/** The field a shape belongs to — as its input, its label, or the field itself. */
export function fieldOf(file: DiagramFile, id: string): Field | undefined {
  const items = itemShapes(file);
  const held = containerOf(file);
  const asField = (name: string | undefined): Field | undefined => {
    const container = name === undefined ? undefined : file.containers.get(name);
    if (!container || container.kind !== 'stack') return undefined;
    const all = members(container);
    const inputs = all.filter(one => items.has(one));
    if (inputs.length !== 1 || !all.every(one => items.has(one) || isCaption(file, one, items))) return undefined;
    const item = inputs[0]!;
    const index = all.indexOf(item);
    // The label is the words before the input, or after it in a row that
    // starts with the input — the same reading as the item's name.
    const label = container.flow === 'right' || index === 0 ? all[index + 1] : all[index - 1];
    return {
      kind: container.flow === 'right' ? 'row' : 'top', item, container: container.id,
      label: isCaption(file, label, items) ? label : undefined,
    };
  };
  const own = asField(id) ?? asField(held.get(id));
  if (own) return own;

  // A row of a form: the label in the cell before the input.
  const grid = file.containers.get(held.get(id) ?? '');
  if (!grid || grid.kind !== 'grid') return undefined;
  const row = grid.cells.findIndex(cells => cells.includes(id));
  const cells = grid.cells[row]!;
  const at = cells.indexOf(id);
  const pair = (item: number): Field | undefined => {
    const input = cells[item];
    const label = cells[item - 1];
    if (input === undefined || !items.has(input) || (label !== EMPTY_CELL && !isCaption(file, label, items))) return undefined;
    return {
      kind: 'left', item: input, container: grid.id, row,
      label: label === EMPTY_CELL ? undefined : label,
    };
  };
  return items.has(id) ? pair(at) : pair(at + 1);
}

/** Whether a grid is a form with its labels on the left: some row is a label and an input. */
export function isLabelForm(file: DiagramFile, container: Container): boolean {
  if (container.kind !== 'grid') return false;
  const items = itemShapes(file);
  return container.cells.some(cells => cells.some((cell, c) =>
    items.has(cell) && c > 0 && isCaption(file, cells[c - 1], items)));
}

/**
 * Every shape that goes with an input when it goes: its label, and the stack
 * that held the two. A label in a form's row goes with it; the row is left
 * empty, and an empty row is not written.
 */
export function fieldShapes(file: DiagramFile, id: string): readonly string[] {
  const field = fieldOf(file, id);
  if (!field || field.item !== id) return [id];
  if (field.kind === 'left') return field.label === undefined ? [id] : [id, field.label];
  const container = file.containers.get(field.container)!;
  return [...members(container), field.container];
}

/** What adding a field wrote: its shapes, so the caller can pick them and open the label. */
export interface AddedField {
  readonly edit: Edit;
  readonly item: string;
  readonly label: string;
  /** The stack that is the field, when it is one. */
  readonly field: string | undefined;
}

export interface NewField {
  /** The library part the input is written as. */
  readonly part: string;
  /** What its label says. */
  readonly label: string;
  /** The shape picked when it was asked for: the new field goes after it. */
  readonly near?: string | undefined;
  /** Where to pin it when nothing is picked. */
  readonly at?: { readonly x: number; readonly y: number } | undefined;
}

/**
 * Adds an input with its label, as one change.
 *
 * Next to what is picked, the way the screen already does it: under a field,
 * as another field; under a row of a form with its labels on the left, as
 * another row; at the end of a container that is picked itself. With nothing
 * picked, at the point given and the way the library says.
 */
export function addField(file: DiagramFile, source: string, shape: NewField): AddedField {
  if (!file.body || file.mode !== 'free') throw new DiagramEditError(dgm('diagram.field.notScreen'));
  if (!file.library.has(shape.part)) throw new DiagramEditError(dgm('diagram.field.noPart', { part: shape.part }));
  const names = freeNames(file, shape.part);
  const beside = BESIDE.has(file.library.get(shape.part)?.style.get('icon') ?? '');
  const changes: Change[] = [];
  const lines: string[] = [];
  const layout: string[] = [];

  // Where it goes: the form or the container next to what is picked.
  const near = shape.near === undefined ? undefined : placeOf(file, shape.near);
  const side: LabelSide = near?.kind === 'form' ? 'left' : near ? 'top' : labelSide(file);
  // A check box's words go after it, on its own row of a stack; in a form
  // with labels on the left, that row sits in the input column.
  const field = beside || side === 'top' ? names.field : undefined;
  if (field !== undefined) {
    lines.push(`${field} ""`);
    layout.push(beside
      ? `stack ${field} (right; gap: ${ROW_GAP}; pad: 0) { ${names.item} ; ${names.label} }`
      : `stack ${field} (down; gap: ${TOP_GAP}; pad: 0) { ${names.label} ; ${names.item} }`);
  }
  lines.push(captionLine(file, names.label, shape.label));
  lines.push(`${names.item} ${shape.part}:`);

  if (near?.kind === 'form') {
    // A new row under the picked one: the label in the label column, the
    // input — or the check box's row — in the input column.
    const grid = near.container;
    const width = Math.max(2, ...grid.cells.map(cells => cells.length));
    const row = Array.from({ length: width }, () => EMPTY_CELL);
    row[near.column - 1] = beside ? EMPTY_CELL : names.label;
    row[near.column] = field ?? names.item;
    const cells = [...grid.cells];
    cells.splice(near.row + 1, 0, row);
    changes.push({ span: grid.span, text: writeContainer(file, grid, sliceBytes(source, grid.span.start, grid.span.end), cells) });
  } else if (near?.kind === 'after') {
    const container = near.container;
    const cells = container.kind === 'grid'
      ? insertRow(container.cells, near.after, field ?? names.item)
      : flowCells(container, inserted(members(container), near.after, field ?? names.item));
    changes.push({ span: container.span, text: writeContainer(file, container, sliceBytes(source, container.span.start, container.span.end), cells) });
  } else {
    // Nowhere to go but where it is put: the field is pinned, as wide as the
    // input, since a stack with no width would squeeze it.
    const at = shape.at ?? { x: 0, y: 0 };
    const input = file.library.get(shape.part)!;
    const caption = file.library.get('label');
    const box = { width: input.width ?? 320, height: input.height ?? 34 };
    const words = { width: caption?.width ?? 200, height: caption?.height ?? 18 };
    const size = beside
      ? { width: box.width + ROW_GAP + words.width, height: Math.max(box.height, words.height) }
      : side === 'left'
        ? { width: 120 + FORM_GAP.x + box.width, height: Math.max(box.height, words.height) }
        : { width: box.width, height: words.height + TOP_GAP + box.height };
    if (side === 'left' && !beside) {
      const form = names.form;
      lines.unshift(`${form} ""`);
      layout.push(`grid ${form} (cols: ${LABEL_COLUMN}, 1fr; gap: ${FORM_GAP.y} ${FORM_GAP.x}; pad: 0) { ${names.label} ; ${names.item} }`);
      layout.push(formatPlacement(form, { ...at, ...size }, undefined, idWidth(file)));
    } else {
      layout.push(formatPlacement(field!, { ...at, ...size }, undefined, idWidth(file)));
    }
  }

  changes.push({
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: lines.map(line => `\n${file.body!.indent}${line}`).join(''),
  });
  changes.push(...layoutLines(file, source, layout));
  return {
    edit: splice(source, changes, dgm('diagram.did.addField')),
    item: names.item, label: names.label, field,
  };
}

/**
 * Gives an input that has none a label: over it, or in the empty cell before
 * it in a form with its labels on the left, or after a check box on its row.
 */
export function addLabel(file: DiagramFile, source: string, id: string, text: string): AddedField {
  if (!file.body || file.mode !== 'free') throw new DiagramEditError(dgm('diagram.field.notScreen'));
  if (!itemShapes(file).has(id)) throw new DiagramEditError(dgm('diagram.field.notInput', { id }));
  if (fieldOf(file, id)?.label !== undefined) throw new DiagramEditError(dgm('diagram.field.hasLabel', { id }));
  const names = freeNames(file, id, true);
  const changes: Change[] = [];
  const layout: string[] = [];
  const lines = [captionLine(file, names.label, text)];
  const held = containerOf(file).get(id);
  const holder = held === undefined ? undefined : file.containers.get(held);

  // The empty cell before it in a form: the label goes there, and nothing else moves.
  const row = holder?.kind === 'grid' ? holder.cells.findIndex(cells => cells.includes(id)) : -1;
  const column = row < 0 ? -1 : holder!.cells[row]!.indexOf(id);
  if (holder && row >= 0 && column > 0 && holder.cells[row]![column - 1] === EMPTY_CELL && !labelsBeside(file, id)) {
    const cells = holder.cells.map((cells, r) => cells.map((cell, c) => (r === row && c === column - 1 ? names.label : cell)));
    changes.push({ span: holder.span, text: writeContainer(file, holder, sliceBytes(source, holder.span.start, holder.span.end), cells) });
  } else {
    // Otherwise the input becomes a field: a stack in its place holding the two.
    const field = names.field;
    lines.unshift(`${field} ""`);
    layout.push(labelsBeside(file, id)
      ? `stack ${field} (right; gap: ${ROW_GAP}; pad: 0) { ${id} ; ${names.label} }`
      : `stack ${field} (down; gap: ${TOP_GAP}; pad: 0) { ${names.label} ; ${id} }`);
    if (holder) {
      const cells = holder.cells.map(cells => cells.map(cell => (cell === id ? field : cell)));
      changes.push({ span: holder.span, text: writeContainer(file, holder, sliceBytes(source, holder.span.start, holder.span.end), cells) });
    }
    const pin = file.layout.get(id);
    if (pin) {
      // The pin moves to the field, and keeps the input's width: a stack with
      // none would squeeze it.
      changes.push(whole(source, pin.span, ''));
      const box = { width: pin.width ?? file.partSizes.get(id)?.width ?? 320, height: pin.height ?? file.partSizes.get(id)?.height ?? 34 };
      const caption = file.library.get('label');
      const words = { width: caption?.width ?? 200, height: caption?.height ?? 18 };
      const size = labelsBeside(file, id)
        ? { width: box.width + ROW_GAP + words.width, height: Math.max(box.height, words.height) }
        : { width: box.width, height: words.height + TOP_GAP + box.height };
      layout.push(formatPlacement(field, { x: pin.x, y: pin.y, ...size }, undefined, idWidth(file)));
    } else if (!holder) {
      throw new DiagramEditError(dgm('diagram.field.nowhere', { id }));
    }
  }
  changes.push({
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: lines.map(line => `\n${file.body!.indent}${line}`).join(''),
  });
  changes.push(...layoutLines(file, source, layout));
  return {
    edit: splice(source, changes, dgm('diagram.did.addLabel', { id })),
    item: id, label: names.label, field: layout.length > 0 ? names.field : undefined,
  };
}

/**
 * The container a form is: the grid of a form with its labels on the left,
 * or the stack its fields are listed in. Asked of anything in it.
 */
export function formOf(file: DiagramFile, id: string): Container | undefined {
  const held = containerOf(file);
  const field = fieldOf(file, id);
  if (field?.kind === 'left') return file.containers.get(field.container);
  const start = field ? field.container : id;
  const own = file.containers.get(start);
  if (own && !fieldOf(file, start) && isForm(file, own)) return own;
  const outer = file.containers.get(held.get(start) ?? '');
  return outer && isForm(file, outer) ? outer : undefined;
}

/** A container that lists fields: a form of either side. */
function isForm(file: DiagramFile, container: Container): boolean {
  if (isLabelForm(file, container)) return true;
  return container.kind === 'stack' && container.flow === 'down'
    && members(container).some(one => fieldOf(file, one)?.kind === 'top');
}

/**
 * Turns a form's labels to the other side, all of its fields at once.
 *
 * Over: each field is a stack of the label over the input, and the form a
 * stack of fields. On the left: the form is a grid of two columns, a label
 * and an input to a row, so every input starts where the others do. What is
 * not a field — a title, a button — takes the whole row; a check box's row
 * sits in the input column. Only the layout is rewritten, and the lines of
 * the fields' stacks: no shape that is drawn changes.
 */
export function setLabelSide(file: DiagramFile, source: string, id: string, side: LabelSide): Edit {
  const form = formOf(file, id);
  if (!form || !file.body) throw new DiagramEditError(dgm('diagram.field.noForm'));
  const changes: Change[] = [];
  const lines: string[] = [];
  const layout: string[] = [];
  const text = sliceBytes(source, form.span.start, form.span.end);

  if (side === 'left') {
    if (form.kind === 'grid') throw new DiagramEditError(dgm('diagram.field.already'));
    const rows: string[][] = [];
    for (const one of members(form)) {
      const field = fieldOf(file, one);
      if (field?.kind === 'top' && field.container === one) {
        const container = file.containers.get(one)!;
        // The stack goes, and its own line with it: the row holds the two now.
        rows.push([field.label ?? EMPTY_CELL, field.item]);
        changes.push(whole(source, container.span, ''));
        const node = file.nodes.find(n => n.id === one);
        if (node) changes.push(whole(source, node.span, ''));
        // Words under the input — a hint — go under it in the input column.
        for (const extra of members(container)) {
          if (extra !== field.item && extra !== field.label) rows.push([EMPTY_CELL, extra]);
        }
        continue;
      }
      rows.push(field?.kind === 'row' ? [EMPTY_CELL, one] : [one, one]);
    }
    const head = `grid ${form.id} (cols: ${LABEL_COLUMN}, 1fr; gap: ${form.gap.y} ${FORM_GAP.x}; pad: ${form.pad})`;
    changes.push({ span: form.span, text: blockText(head, text, rows, { grid: true, indent: file.layoutBlock?.indent ?? '  ' }) });
  } else {
    if (form.kind !== 'grid') throw new DiagramEditError(dgm('diagram.field.already'));
    const taken = new Set(file.nodes.map(n => n.id));
    const down: string[] = [];
    const placed = new Set<string>();
    const items = itemShapes(file);
    // The field the last row made, while the rows after it are its words —
    // a hint under the input goes back into the field it came out of.
    let open: { name: string; held: string[] } | undefined;
    const fields: { name: string; held: string[] }[] = [];
    form.cells.forEach((cells, r) => {
      const field = cells.map((_, c) => fieldOf(file, cells[c]!)).find(one => one?.kind === 'left' && one.row === r);
      if (field) {
        const name = fieldName(field.item, taken);
        taken.add(name);
        open = { name, held: [field.label, field.item].filter(one => one !== undefined) };
        fields.push(open);
        down.push(name);
        placed.add(field.item);
        if (field.label !== undefined) placed.add(field.label);
      }
      const rest = cells.filter(cell => cell !== EMPTY_CELL && !placed.has(cell));
      if (!field && open && rest.length === 1 && cells[0] === EMPTY_CELL && isCaption(file, rest[0], items)) {
        open.held.push(rest[0]!);
        placed.add(rest[0]!);
        return;
      }
      if (!field) open = undefined;
      for (const cell of rest) {
        if (placed.has(cell)) continue;
        placed.add(cell);
        down.push(cell);
      }
    });
    for (const one of fields) {
      lines.push(`${one.name} ""`);
      layout.push(`stack ${one.name} (down; gap: ${TOP_GAP}; pad: 0) { ${one.held.join(' ; ')} }`);
    }
    const head = `stack ${form.id} (down; gap: ${form.gap.y}; pad: ${form.pad})`;
    changes.push({ span: form.span, text: blockText(head, text, [down], { grid: false, indent: file.layoutBlock?.indent ?? '  ' }) });
  }
  if (lines.length > 0) {
    changes.push({
      span: { start: file.body.insertAt, end: file.body.insertAt },
      text: lines.map(line => `\n${file.body!.indent}${line}`).join(''),
    });
  }
  changes.push(...layoutLines(file, source, layout));
  return splice(source, changes, dgm(side === 'left' ? 'diagram.did.labelsLeft' : 'diagram.did.labelsTop'));
}

/**
 * Sets how wide a form's label column is: a number, or `auto` for as wide as
 * the longest label. The other columns keep what they say.
 */
export function setLabelColumn(file: DiagramFile, source: string, id: string, width: number | 'auto'): Edit {
  const form = file.containers.get(id);
  if (!form || form.kind !== 'grid') throw new DiagramEditError(dgm('diagram.field.noForm'));
  const count = Math.max(1, ...form.cells.map(cells => cells.length));
  const cols = Array.from({ length: count }, (_, i) => form.cols[i] ?? '1fr');
  cols[0] = width === 'auto' ? 'auto' : String(Math.max(16, Math.round(width)));
  const text = sliceBytes(source, form.span.start, form.span.end);
  const open = text.indexOf('{');
  const head = text.slice(0, open);
  const settings = /\(([^)]*)\)/.exec(head);
  const written = `cols: ${cols.join(', ')}`;
  // The `cols` setting where it was written, or first; the others as they are.
  const others = (settings?.[1] ?? '').split(';').map(one => one.trim()).filter(one => one !== '');
  const at = others.findIndex(one => /^cols\s*:/.test(one));
  if (at >= 0) others[at] = written; else others.unshift(written);
  const next = settings
    ? head.replace(settings[0], `(${others.join('; ')})`)
    : `${head.trimEnd()} (${written}) `;
  if (next === head) throw new DiagramEditError(dgm('diagram.edit.noChange'));
  return splice(source, [{ span: { start: form.span.start, end: form.span.start + byteLength(head) }, text: next }],
    dgm('diagram.did.labelColumn'));
}

/** The rows of a form moved: one row taken out and put in again at `to`. */
export function moveFormRow(file: DiagramFile, source: string, id: string, from: number, to: number): Edit {
  const form = file.containers.get(id);
  if (!form || form.kind !== 'grid') throw new DiagramEditError(dgm('diagram.field.noForm'));
  if (from === to || from < 0 || from >= form.cells.length) throw new DiagramEditError(dgm('diagram.edit.sameOrder'));
  const cells = [...form.cells];
  const [row] = cells.splice(from, 1);
  cells.splice(Math.max(0, Math.min(cells.length, to)), 0, row!);
  return splice(source, [{
    span: form.span, text: writeContainer(file, form, sliceBytes(source, form.span.start, form.span.end), cells),
  }], dgm('diagram.did.reorder'));
}

// --- 内部 ---------------------------------------------------------------

/** Where a new field goes, from what is picked. */
function placeOf(file: DiagramFile, near: string):
  | { kind: 'form'; container: Container; row: number; column: number }
  | { kind: 'after'; container: Container; after: string | undefined }
  | undefined {
  const field = fieldOf(file, near);
  if (field?.kind === 'left') {
    const grid = file.containers.get(field.container)!;
    return { kind: 'form', container: grid, row: field.row!, column: grid.cells[field.row!]!.indexOf(field.item) };
  }
  const held = containerOf(file);
  // A form picked itself takes the field at its end.
  const own = file.containers.get(near);
  if (own && !field && own.kind !== 'tabs') {
    if (isLabelForm(file, own)) {
      const last = own.cells.length - 1;
      const column = own.cells.reduce((found, cells) => {
        const at = cells.findIndex((cell, c) => c > 0 && fieldOf(file, cell)?.kind === 'left');
        return found > 0 ? found : at;
      }, -1);
      return { kind: 'form', container: own, row: last, column: Math.max(1, column) };
    }
    return { kind: 'after', container: own, after: undefined };
  }
  // A field, or a shape in a row of a form that is not a field (a check box's
  // row): after it, in what holds it.
  const start = field ? field.container : near;
  const outer = file.containers.get(held.get(start) ?? '');
  if (!outer || outer.kind === 'tabs') return undefined;
  if (outer.kind === 'grid' && isLabelForm(file, outer)) {
    const row = outer.cells.findIndex(cells => cells.includes(start));
    return { kind: 'form', container: outer, row, column: Math.max(1, outer.cells[row]!.indexOf(start)) };
  }
  return { kind: 'after', container: outer, after: start };
}

/** Names nobody uses for an input, its label, the field and a form: `textbox1`, `textbox1Label`, … */
function freeNames(file: DiagramFile, base: string, given = false): { item: string; label: string; field: string; form: string } {
  const taken = new Set(file.nodes.map(n => n.id));
  const clean = base.replace(/[^A-Za-z0-9_぀-鿿]/g, '') || 'item';
  for (let n = 1; ; n++) {
    const item = given ? base : `${clean}${n}`;
    const stem = given ? `${clean}${n === 1 ? '' : n}` : item;
    const names = { item, label: `${stem}Label`, field: `${stem}Field`, form: `${stem}Form` };
    if ((given || !taken.has(item)) && !taken.has(names.label) && !taken.has(names.field) && !taken.has(names.form)) {
      return names;
    }
  }
}

/** The name of a field made for an input: `idBox` → `idField`, else `<input>Field`. */
function fieldName(item: string, taken: ReadonlySet<string>): string {
  const stem = item.replace(/(Box|Input|Field|Select|Area)$/, '') || item;
  for (let n = 1; ; n++) {
    const name = `${stem}Field${n === 1 ? '' : n}`;
    if (!taken.has(name)) return name;
  }
}

/** A label, written as the library's `label` part when it has one. */
function captionLine(file: DiagramFile, id: string, text: string): string {
  const words = `"${text.replace(/"/g, '')}"`;
  return file.library.has('label') ? `${id} label:${words}` : `${id} ${words}`;
}

/** Lines for the layout section, in it or in a new one at the end. */
function layoutLines(file: DiagramFile, source: string, lines: readonly string[]): Change[] {
  if (lines.length === 0) return [];
  if (file.layoutBlock) {
    return [{
      span: { start: file.layoutBlock.insertAt, end: file.layoutBlock.insertAt },
      text: lines.map(line => `\n${file.layoutBlock!.indent}${line}`).join(''),
    }];
  }
  const end = byteLength(source.replace(/\s+$/, ''));
  return [{ span: { start: end, end: byteLength(source) }, text: `\n\nlayout {\n${lines.map(line => `  ${line}`).join('\n')}\n}\n` }];
}

/** A stack's members as its cells. */
function flowCells(container: Container, held: readonly string[]): string[][] {
  return container.flow === 'down' ? held.map(one => [one]) : [[...held]];
}

function inserted(held: readonly string[], after: string | undefined, id: string): string[] {
  const out = [...held];
  const at = after === undefined ? -1 : out.indexOf(after);
  out.splice(at < 0 ? out.length : at + 1, 0, id);
  return out;
}

/** A grid with a new row under the one holding `after`, the new name where `after` was. */
function insertRow(cells: readonly (readonly string[])[], after: string | undefined, id: string): string[][] {
  const out = cells.map(row => [...row]);
  const width = Math.max(1, ...out.map(row => row.length));
  const at = after === undefined ? -1 : out.findIndex(row => row.includes(after));
  const column = at < 0 ? 0 : out[at]!.indexOf(after!);
  const row = Array.from({ length: width }, (_, c) => (c === column ? id : EMPTY_CELL));
  out.splice(at < 0 ? out.length : at + 1, 0, row);
  return out;
}

/**
 * A container's text with other cells: its head kept, one row to a line once
 * it is a grid of more than one row — a grid's rows are its lines.
 */
function writeContainer(
  file: DiagramFile, container: Container, text: string, cells: readonly (readonly string[])[],
): string {
  const head = text.slice(0, text.indexOf('{')).trimEnd();
  const rows = cells
    .map(row => row.filter(cell => container.kind === 'grid' || cell !== EMPTY_CELL))
    .filter(row => row.length > 0 && row.some(cell => cell !== EMPTY_CELL));
  const indent = file.layoutBlock?.indent ?? '  ';
  if (container.kind !== 'grid') {
    const flat = container.flow === 'down' ? rows.map(row => row[0]!) : rows.flat();
    return blockText(head, text, [flat], { grid: false, indent });
  }
  return blockText(head, text, rows, { grid: true, indent });
}

/**
 * A container written from its head and rows. A stack is a list, written on
 * one line if it was; a grid of one row too. A grid of several rows is a
 * block, a row to a line, at the indent its block had or the layout's.
 */
function blockText(
  head: string, was: string, rows: readonly (readonly string[])[], how: { grid: boolean; indent: string },
): string {
  const list = how.grid ? rows : [rows.flat()];
  if (!was.includes('\n') && list.length === 1) return `${head} { ${list[0]!.join(' ; ')} }`;
  const close = /\n(\s*)\}$/.exec(was)?.[1] ?? how.indent;
  const inner = /\n(\s*)\S/.exec(was)?.[1] ?? `${close}  `;
  const lines = how.grid ? list.map(row => row.join(' ; ')) : list[0]!;
  return `${head} {\n${lines.map(line => inner + line).join('\n')}\n${close}}`;
}
