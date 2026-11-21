import { afterEach, describe, expect, it } from 'vitest';
import {
  LAYERED_ENGINE, layOutDiagram, layoutEngine, layoutEngineNames, parseDiagram,
  registerLayoutEngine, useLayoutEngine,
  type GraphEdge, type GraphLayout, type GraphToLayOut, type LayoutEngine,
} from '../src/index.js';

const SOURCE = `flow {
  a [A]
  b [B]
  a --> b
}`;

/**
 * An engine that ignores the graph and puts everything in one place. Nothing
 * about it is a sensible layout; it only has to be unmistakably not the
 * built-in one, so that a test can tell which engine answered.
 */
const stacked: LayoutEngine = {
  name: 'test-stacked',
  arrange: <E extends GraphEdge>(graph: GraphToLayOut<E>): GraphLayout<E> => {
    const positions = new Map(graph.ids.map((id, i) => [id, { x: i * 1000, y: 7 }]));
    return { positions, width: graph.ids.length * 1000, height: 7, back: new Set<E>() };
  },
};

afterEach(() => { useLayoutEngine(LAYERED_ENGINE); });

describe('the layout engine boundary', () => {
  it('ships with the layered engine, and uses it by default', () => {
    expect(layoutEngine().name).toBe(LAYERED_ENGINE);
    expect(layoutEngineNames()).toContain(LAYERED_ENGINE);
  });

  it('lays a flow out with whichever engine is in use', () => {
    const file = parseDiagram(SOURCE);

    // The built-in engine ranks `b` after `a`, so it goes further down the
    // page and the two share a column.
    const built = layOutDiagram(file).boxes;
    expect(built.get('b')!.y).toBeGreaterThan(built.get('a')!.y);
    expect(built.get('b')!.x).toBe(built.get('a')!.x);

    registerLayoutEngine(stacked);
    expect(useLayoutEngine(stacked.name)).toBe(true);

    // The stand-in puts everything on one line, 1000 apart. Which engine
    // answered is visible in the drawing, which is the point of the boundary.
    const stood = layOutDiagram(file).boxes;
    expect(stood.get('b')!.y).toBe(stood.get('a')!.y);
    expect(stood.get('b')!.x - stood.get('a')!.x).toBe(1000);
  });

  it('keeps the built-in engine for a name no build has', () => {
    expect(useLayoutEngine('tala')).toBe(false);
    expect(layoutEngine('tala').name).toBe(LAYERED_ENGINE);
    expect(layoutEngine().name).toBe(LAYERED_ENGINE);
  });

  it('gives the engine the room the drawing leaves between shapes', () => {
    let seen: GraphToLayOut<GraphEdge> | undefined;
    registerLayoutEngine({
      name: 'test-watching',
      arrange: <E extends GraphEdge>(graph: GraphToLayOut<E>): GraphLayout<E> => {
        seen = graph;
        return {
          positions: new Map(graph.ids.map(id => [id, { x: 0, y: 0 }])),
          width: 0, height: 0, back: new Set<E>(),
        };
      },
    });
    useLayoutEngine('test-watching');
    layOutDiagram(parseDiagram(SOURCE));

    expect(seen?.ids).toEqual(['a', 'b']);
    expect(seen?.edges.map(e => `${e.from}->${e.to}`)).toEqual(['a->b']);
    expect(seen?.gap.rank).toBeGreaterThan(0);
    expect(seen?.gap.node).toBeGreaterThan(0);
    expect(seen?.axis).toEqual({ across: false, reversed: false });
  });
});
