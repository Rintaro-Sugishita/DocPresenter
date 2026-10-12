// A new diagram: the kind asked first, then the folder — the documents' own
// first — then the name, and the file made opens in the diagram editor.

import { describe, expect, it } from 'vitest';
import { parseDiagram } from '@docpresenter/diagram';
import { newDiagram } from '../src/diagram-command.js';
import { Uri, give, held, picks } from './fake-vscode.js';

const REPO = {
  'docs/auth-design.md': '---\ndocument: SD-AUTH-001\ntitle: T\n---\n\n# T\n',
  'docs/old/flow.dgm': 'flow {\n  a [a]\n}\n',
  'shared/glossary.table': '| a |\n|---|\n',
};

/** Answers each quick pick with the item whose label `choose` names, and keeps what was offered. */
const choosing = (...choose: string[]) => {
  const offered: string[][] = [];
  picks.quick = <T>(items: readonly T[]) => {
    const labels = items.map(item => (item as { label: string }).label);
    offered.push(labels);
    const want = choose[offered.length - 1];
    return [items[want === undefined ? 0 : labels.indexOf(want)]!];
  };
  return offered;
};

describe('新しい図', () => {
  it('流れ図を選ぶと、つながった開始・処理・終了の flow ができ、そのまま読める', async () => {
    give(REPO);
    const offered = choosing('流れ図（flow）', 'docs/auth-design/');
    picks.inputs = ['ログインの流れ'];
    await newDiagram();
    expect(offered[0]).toEqual(['流れ図（flow）', '自由配置（free）']);
    // The document's own folder first, then those that hold diagrams, then shared/.
    expect(offered[1]).toEqual(['docs/auth-design/', 'docs/old/', 'shared/', '別のフォルダ…']);
    const text = held.get('docs/auth-design/ログインの流れ.dgm')!;
    expect(text).toMatch(/^flow \{/);
    expect(text).toContain('begin --> step1');
    const diagram = parseDiagram(text);
    expect([diagram.mode, diagram.nodes.map(node => node.id), diagram.edges.length]).toEqual(['flow', ['begin', 'step1', 'finish'], 2]);
  });

  it('自由配置を選ぶと、位置の決まった図形が 1 つの free ができる', async () => {
    give(REPO);
    choosing('自由配置（free）', 'shared/');
    picks.inputs = ['System.dgm'];
    await newDiagram();
    const text = held.get('shared/System.dgm')!;
    expect(text).toMatch(/^free \{/);
    expect(text).toContain('layout {');
    const diagram = parseDiagram(text);
    expect([diagram.mode, diagram.nodes.length, diagram.layout.has('a')]).toEqual(['free', 1, true]);
  });

  it('エクスプローラーのフォルダに作る。同じ名前があれば断る', async () => {
    give(REPO);
    const offered = choosing('流れ図（flow）');
    picks.inputs = ['flow'];
    await newDiagram(Uri.file('/w/docs/old'));
    expect(offered).toHaveLength(1);
    expect(picks.refused).toEqual(['docs/old/flow.dgm はもうある']);
  });
});
