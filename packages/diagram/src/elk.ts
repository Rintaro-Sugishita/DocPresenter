// The ELK engine: node placement by Eclipse Layout Kernel, through elkjs.
//
// It is not imported by the layout, and nothing in `index.ts` reaches it, so
// a build that never asks for it never carries elkjs — which is a megabyte and
// a half. A host that wants it imports this module, which registers the engine
// on the way in, and then names it:
//
//     import '@docpresenter/diagram/elk';
//     useLayoutEngine(ELK_ENGINE);
//
// **Only the shapes' places come from ELK.** The lines are drawn by the
// routing in `layout.ts`, as they are for the engine that ships with the tool,
// because that routing is what knows about corners the author wrote, shapes a
// human pinned, group frames and self-loops — and what keeps the PDF, the deck
// and the screen drawing the same line. ELK's own routes are better than
// anything derived from its places alone, and taking them is the obvious next
// question, but it is a change to what an engine returns, not a setting.
//
// ## Why the worker is driven by hand
//
// elkjs's public API is a Promise, and the layout here is synchronous — it is
// called while a drawing is being built, from the editor, the PDF writer and
// the deck writer alike. But the work itself is synchronous: the Promise comes
// from a `setTimeout` in elkjs's wrapper around a worker that, with no real
// worker to talk to, calls straight through. So the wrapper is skipped and the
// worker's dispatcher is called directly.
//
// That reaches inside elkjs, so it is checked rather than assumed: if a later
// elkjs does not have the dispatcher, `elkEngine` throws when it is first
// asked to lay anything out, and the test for it fails loudly. It does not
// degrade quietly into a different drawing.

import {
  registerLayoutEngine,
  type GraphEdge, type GraphLayout, type GraphToLayOut, type LayoutEngine,
} from './engine.js';
import type { Point } from './model.js';
import worker from 'elkjs/lib/elk-worker.min.js';

export const ELK_ENGINE = 'elk';

/** As much of a laid-out ELK graph as the places need. */
interface ElkGraph {
  readonly id: string;
  readonly layoutOptions: Record<string, string>;
  readonly children: { id: string; width: number; height: number; x?: number; y?: number }[];
  readonly edges: { id: string; sources: string[]; targets: string[] }[];
}

interface Dispatcher { dispatch: (message: { data: unknown }) => void }
interface FakeWorker { dispatcher?: Dispatcher; onmessage?: (event: { data: unknown }) => void }

let worksheet: FakeWorker | undefined;

/**
 * The worker, made once and kept. Making one compiles ELK, which costs about
 * a tenth of a second; every layout after that is a few milliseconds.
 */
function sheet(): Dispatcher {
  if (!worksheet) {
    const made = new (worker as unknown as { Worker: new () => FakeWorker }).Worker();
    if (typeof made.dispatcher?.dispatch !== 'function') {
      throw new Error(
        'this elkjs has no synchronous dispatcher; the ELK engine cannot be used with it',
      );
    }
    // The dispatcher answers by calling `onmessage`, and throws if there is
    // nothing to call. The answer itself is not read: ELK writes the places
    // into the graph it was given.
    made.onmessage = () => {};
    made.dispatcher.dispatch({ data: { cmd: 'register', algorithms: ['layered'], id: -1 } });
    worksheet = made;
  }
  return worksheet.dispatcher!;
}

let ticket = 0;

export const elkEngine: LayoutEngine = {
  name: ELK_ENGINE,
  arrange: elk,
};

registerLayoutEngine(elkEngine);

function elk<E extends GraphEdge>(graph: GraphToLayOut<E>): GraphLayout<E> {
  const positions = new Map<string, Point>();
  if (graph.ids.length === 0) return { positions, width: 0, height: 0, back: new Set<E>() };

  const laid: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': graph.axis.across
        ? (graph.axis.reversed ? 'LEFT' : 'RIGHT')
        : (graph.axis.reversed ? 'UP' : 'DOWN'),
      // The drawing is placed on the canvas by the layout, which adds its own
      // margin; a second one from ELK would be margin inside margin.
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.spacing.nodeNode': String(graph.gap.node),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(graph.gap.rank),
      // A cycle is broken at the connection written last, not at whichever one
      // a greedy walk reaches first. Without this a flow that loops back to
      // its first screen is drawn upside down, because ELK is free to call any
      // connection in the loop the one that goes backwards.
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      // And where nothing else decides the order, the file decides it: two
      // shapes with nothing to tell them apart come out as they were written,
      // so that adding one elsewhere does not shuffle the drawing.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: graph.ids.map(id => ({ id, ...graph.size(id) })),
    edges: graph.edges.map((edge, i) => ({ id: `e${i}`, sources: [edge.from], targets: [edge.to] })),
  };
  sheet().dispatch({ data: { cmd: 'layout', graph: laid, layoutOptions: {}, id: ++ticket } });

  // The places start at the origin, as the engine's contract says: a pinned
  // coordinate is one a human read off the drawing, and both layers have to
  // agree what it means.
  let minX = 0;
  let minY = 0;
  for (const child of laid.children) {
    minX = Math.min(minX, child.x ?? 0);
    minY = Math.min(minY, child.y ?? 0);
  }
  let width = 0;
  let height = 0;
  for (const child of laid.children) {
    const at = { x: Math.round((child.x ?? 0) - minX), y: Math.round((child.y ?? 0) - minY) };
    positions.set(child.id, at);
    width = Math.max(width, at.x + child.width);
    height = Math.max(height, at.y + child.height);
  }

  // Which connections ELK had to turn round. It does not say, so it is read
  // off the places: one that does not advance along the flow goes back.
  const along = (id: string): number => {
    const at = positions.get(id);
    if (!at) return 0;
    return (graph.axis.across ? at.x : at.y) * (graph.axis.reversed ? -1 : 1);
  };
  const back = new Set(graph.edges.filter(edge => along(edge.to) < along(edge.from)));
  return { positions, width, height, back };
}
