// Putting the shapes that are picked into a new stack.
//
// Arranging by hand is dragging each shape into line and getting the gaps the
// same by eye; a stack says "these, down the page, 12 apart" once, and keeps
// saying it when one of them grows. So the picked shapes become the members of
// a new stack, in the order they are on screen.
//
// Where the stack goes depends on where they were. Shapes that a container
// holds keep their place in it: the new stack takes the place of the first of
// them, which is how stacks come to be nested. Shapes that were placed by hand
// give their pins up to the stack, which is pinned where they stood.

import { applyEdit, byteLength, type Edit } from '@docpresenter/base';
import { EMPTY_CELL, containerOf, isTable } from './arrange.js';
import { DiagramEditError, editBetween, setContainerCells, splice, unpinNode } from './edits.js';
import type { Box } from './layout.js';
import { dgm } from './messages.js';
import type { DiagramFile } from './model.js';
import { parseDiagram } from './parse.js';

/**
 * A new stack holding the shapes given, down or across. `boxes` are where the
 * shapes are drawn, in the file's own numbers (a pin's numbers): they decide
 * the order, and where a stack of shapes placed by hand is pinned.
 */
export function stackNodes(
  file: DiagramFile, source: string, ids: readonly string[], flow: 'down' | 'right',
  boxes: ReadonlyMap<string, Box>,
): Edit {
  if (ids.length < 2) throw new DiagramEditError(dgm('diagram.edit.pickTwo'));
  if (!file.body) throw new DiagramEditError(dgm('diagram.edit.noBody'));
  for (const id of ids) {
    if (!file.nodes.some(node => node.id === id)) throw new DiagramEditError(dgm('diagram.edit.missingShape', { id }));
  }
  const held = containerOf(file);
  const parents = new Set(ids.map(id => held.get(id)));
  if (parents.size > 1) throw new DiagramEditError(dgm('diagram.stack.mixed'));
  const parent = [...parents][0];
  if (parent !== undefined && isTable(file, parent)) throw new DiagramEditError(dgm('diagram.stack.inTable'));

  // In the order they are on screen: top to bottom for a stack down the page,
  // left to right for one across it.
  const at = (id: string): Box | undefined => boxes.get(id);
  const order = [...ids].sort((a, b) => {
    const one = at(a); const other = at(b);
    if (!one || !other) return ids.indexOf(a) - ids.indexOf(b);
    return flow === 'down' ? one.y - other.y || one.x - other.x : one.x - other.x || one.y - other.y;
  });

  const id = freshId(file, 'stack');
  const indent = file.layoutBlock?.indent ?? '  ';
  const block = [
    `stack ${id} (${flow}; pad: 0) {`,
    ...order.map(one => `  ${one}`),
    '}',
  ];
  // Placed by hand, the stack is pinned where its shapes stood, at the corner
  // of the box round them. No size: a container pinned without one is as big
  // as what it holds.
  if (parent === undefined) {
    const placed = order.map(at).filter((one): one is Box => one !== undefined);
    const x = placed.length > 0 ? Math.round(Math.min(...placed.map(one => one.x))) : 0;
    const y = placed.length > 0 ? Math.round(Math.min(...placed.map(one => one.y))) : 0;
    block.push(`${id} @ (${x}, ${y})`);
  }
  const lines = file.layoutBlock
    ? [{ span: { start: file.layoutBlock.insertAt, end: file.layoutBlock.insertAt }, text: block.map(line => `\n${indent}${line}`).join('') }]
    : [{
      span: { start: byteLength(source.replace(/\s+$/, '')), end: byteLength(source) },
      text: `\n\nlayout {\n${block.map(line => `  ${line}`).join('\n')}\n}\n`,
    }];
  let text = applyEdit(source, splice(source, [
    { span: { start: file.body.insertAt, end: file.body.insertAt }, text: `\n${file.body.indent}${id} ""` },
    ...lines,
  ], dgm('diagram.did.stack')));

  // In a container, the stack takes the place of the first of them and the
  // others leave theirs: a stack closes up, a grid keeps the cell empty.
  if (parent !== undefined) {
    const container = parseDiagram(text).containers.get(parent)!;
    const going = new Set(order);
    let put = false;
    const cells = container.cells.map(row => row.flatMap(cell => {
      if (!going.has(cell)) return [cell];
      if (!put) { put = true; return [id]; }
      return container.kind === 'grid' ? [EMPTY_CELL] : [];
    }));
    text = applyEdit(text, setContainerCells(parseDiagram(text), text, parent, cells));
  }

  // The stack places its members now: a pin would keep one where it was.
  for (const one of order) {
    const now = parseDiagram(text);
    if (now.layout.has(one)) text = applyEdit(text, unpinNode(now, text, one));
  }
  return editBetween(source, text, dgm('diagram.did.stack'));
}

function freshId(file: DiagramFile, base: string): string {
  const taken = new Set([...file.nodes.map(node => node.id), ...file.containers.keys()]);
  for (let n = 1; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}
