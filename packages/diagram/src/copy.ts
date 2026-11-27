// Copying shapes: Ctrl+C and Ctrl+V, and Ctrl held while dragging.
//
// A copy is the lines that make the shapes, written again under new names:
// the shape's own line, its pin moved by the offset, its look, the
// arrangement it holds and what that holds, the connections among the
// copied shapes, and a group whose members are all copied. Nothing outside
// the copy is touched, and a connection to a shape that was not copied is
// left behind — copying two boxes does not wire the copies to the rest.
//
// The lines are taken from the drawing they were copied from, which need not
// be the one they go into: the copy is held as a text and its reading, so a
// shape copied before an edit, or from another drawing, still pastes.

import { sliceBytes, type Edit } from '@docpresenter/base';
import { members } from './arrange.js';
import {
  DiagramEditError, formatPlacement, groupText, idWidth, splice, type Change,
} from './edits.js';
import type { Box } from './layout.js';
import { dgm } from './messages.js';
import type { DiagramFile } from './model.js';

/** What was copied: the drawing it came from, and where its shapes were drawn there, in the file's own numbers. */
export interface Copied {
  readonly file: DiagramFile;
  readonly source: string;
  readonly ids: readonly string[];
  readonly places: ReadonlyMap<string, Box>;
}

/** What a shape's name may be made of, as the parser reads one. */
const ID_CHAR = 'A-Za-z0-9_\\u3040-\\u9fff';

/**
 * The copy written into `file`, moved by `offset`, as one edit — and the
 * names the copies of the shapes asked for were given, to pick them.
 */
export function duplicateNodes(
  file: DiagramFile, source: string, copied: Copied, offset: { readonly x: number; readonly y: number },
): { edit: Edit; ids: string[] } {
  if (!file.body) throw new DiagramEditError(dgm('diagram.edit.noBody'));
  const from = copied.file;
  const nodes = new Map(from.nodes.map(node => [node.id, node]));

  // Everything that goes with what was asked for: what a container holds,
  // what a group holds, and so on down.
  const all: string[] = [];
  const take = (id: string): void => {
    if (all.includes(id) || !nodes.has(id)) return;
    all.push(id);
    const container = from.containers.get(id);
    if (container) for (const one of members(container)) take(one);
    const node = nodes.get(id)!;
    if (node.shape === 'group') for (const one of node.children) take(one);
  };
  for (const id of copied.ids) take(id);
  if (all.length === 0) throw new DiagramEditError(dgm('diagram.edit.noChange'));

  // New names: the old one's stem, numbered past every name already taken.
  const taken = new Set(file.nodes.map(node => node.id));
  const renamed = new Map<string, string>();
  for (const id of all) {
    const stem = id.replace(/\d+$/, '') || id;
    let n = 1;
    while (taken.has(`${stem}${n}`)) n++;
    taken.add(`${stem}${n}`);
    renamed.set(id, `${stem}${n}`);
  }
  const name = (id: string): string => renamed.get(id) ?? id;
  /** The line with its leading name changed: the rest is words, which are left alone. */
  const lead = (text: string, id: string): string => `${name(id)}${text.slice(id.length)}`;
  /** Every copied name standing as a word of its own in `text`. */
  const words = (text: string): string => text.replace(
    new RegExp(`(?<![${ID_CHAR}-])([${ID_CHAR}]+)(?![${ID_CHAR}-])`, 'gu'),
    (word: string) => name(word));

  const body: string[] = [];
  const layout: string[] = [];
  const style: string[] = [];
  const pinned = idWidth(file);
  const inside = new Set<string>();
  for (const container of from.containers.values()) {
    if (all.includes(container.id)) for (const one of members(container)) inside.add(one);
  }

  for (const id of all) {
    const node = nodes.get(id)!;
    const written = sliceBytes(copied.source, node.span.start, node.span.end);
    if (node.shape === 'group') {
      const indent = file.body.indent;
      body.push(groupText({ ...node, id: name(id) }, node.children.filter(one => all.includes(one)).map(name), indent));
    } else {
      body.push(lead(written, id));
    }

    // Where it goes: its own pin moved, or — for a shape some container not
    // copied arranged — a pin where it was drawn, moved. What a copied
    // container holds is placed by the copy of the container.
    const pin = from.layout.get(id);
    const box = copied.places.get(id);
    if (from.mode === 'free' && !inside.has(id)) {
      if (pin) {
        layout.push(formatPlacement(name(id), {
          x: pin.x + offset.x, y: pin.y + offset.y, width: pin.width, height: pin.height, z: pin.z,
        }, undefined, pinned));
      } else if (box) {
        layout.push(formatPlacement(name(id), {
          x: box.x + offset.x, y: box.y + offset.y, width: box.width, height: box.height,
        }, undefined, pinned));
      }
    }
    // A size written with no place goes with a copy a copied container holds.
    const sized = from.sizes?.get(id);
    if (sized && from.mode === 'free' && inside.has(id)) layout.push(`${name(id)} ${sized.width}x${sized.height}`);
    const container = from.containers.get(id);
    if (container) {
      // The block names the container, the page it shows and what it holds:
      // every one of those names changes. Its other words — `down`, `gap` —
      // are not names of anything copied, so they stay.
      layout.push(words(sliceBytes(copied.source, container.span.start, container.span.end)));
    }
    const look = from.styleSpans.get(id);
    if (look) style.push(lead(sliceBytes(copied.source, look.start, look.end), id));
  }

  for (const edge of from.edges) {
    if (!all.includes(edge.from) || !all.includes(edge.to)) continue;
    const text = sliceBytes(copied.source, edge.span.start, edge.span.end);
    const rest = text.slice(edge.from.length);
    // The far end is the first name after the connector.
    const to = rest.replace(new RegExp(`^(\\s*\\S*?[-.>~]\\s*)${escape(edge.to)}(?![${ID_CHAR}-])`, 'u'),
      (_: string, connector: string) => `${connector}${name(edge.to)}`);
    body.push(`${name(edge.from)}${to}`);
  }

  const changes: Change[] = [{
    span: { start: file.body.insertAt, end: file.body.insertAt },
    text: body.flatMap(line => line.split('\n')).map((line, i) => (i === 0 || !/^\s/.test(line)
      ? `\n${file.body!.indent}${line.trimStart()}` : `\n${line}`)).join(''),
  }];
  const tail: string[] = [];
  if (layout.length > 0) {
    const rows = layout.flatMap(line => line.split('\n'));
    if (file.layoutBlock) {
      changes.push({
        span: { start: file.layoutBlock.insertAt, end: file.layoutBlock.insertAt },
        // A block's inner lines keep the indent they were written with.
        text: rows.map(line => (/^\s/.test(line) ? `\n${line}` : `\n${file.layoutBlock!.indent}${line}`)).join(''),
      });
    } else {
      tail.push(`layout {\n${rows.map(line => `  ${line}`).join('\n')}\n}`);
    }
  }
  if (style.length > 0) {
    if (file.styleBlock) {
      changes.push({
        span: { start: file.styleBlock.insertAt, end: file.styleBlock.insertAt },
        text: style.map(line => `\n${file.styleBlock!.indent}${line}`).join(''),
      });
    } else {
      tail.push(`style {\n${style.map(line => `  ${line}`).join('\n')}\n}`);
    }
  }
  if (tail.length > 0) {
    const trimmed = source.replace(/\s+$/, '');
    const end = new TextEncoder().encode(trimmed).length;
    changes.push({
      span: { start: end, end: new TextEncoder().encode(source).length },
      text: `\n\n${tail.join('\n\n')}\n`,
    });
  }
  return {
    edit: splice(source, changes, dgm('diagram.did.copy')),
    ids: copied.ids.filter(id => renamed.has(id)).map(name),
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
