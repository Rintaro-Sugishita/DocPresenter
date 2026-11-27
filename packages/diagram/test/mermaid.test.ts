// A Mermaid flowchart and a dgm flow, each written as the other.

import { describe, expect, it } from 'vitest';
import { fromMermaid, parseDiagram, toMermaid } from '../src/index.js';

describe('Mermaid → dgm', () => {
  it('reads nodes, shapes, chains, labels, subgraphs and colours', () => {
    const made = fromMermaid([
      '```mermaid',
      'flowchart LR',
      '  %% comment',
      '  A([開始]) --> B{"OK?"}',
      '  B -->|はい| C[(DB)]',
      '  B -- いいえ --> D[/入力/]',
      '  C & D -.-> E',
      '  subgraph back [Back end]',
      '    direction TB',
      '    C',
      '    E((終了))',
      '  end',
      '  style A fill:#e3f2fd,stroke:#0d47a1',
      '  classDef warn fill:#f00',
      '  click A callback',
      '```',
    ].join('\n'));
    const file = parseDiagram(made.text);
    expect(file.mode).toBe('flow');
    expect(file.direction).toBe('LR');
    const shapes = Object.fromEntries(file.nodes.map(node => [node.id, [node.shape, node.text]]));
    expect(shapes).toMatchObject({
      A: ['stadium', '開始'], B: ['diamond', 'OK?'], C: ['cylinder', 'DB'], D: ['parallelogram', '入力'],
      E: ['ellipse', '終了'], back: ['group', 'Back end'],
    });
    expect(file.nodes.find(node => node.id === 'back')).toMatchObject({ children: ['C', 'E'], direction: 'TB' });
    expect(file.edges.map(edge => [edge.from, edge.to, edge.line, edge.arrow, edge.label])).toEqual([
      ['A', 'B', 'solid', 'arrow', undefined],
      ['B', 'C', 'solid', 'arrow', 'はい'],
      ['B', 'D', 'solid', 'arrow', 'いいえ'],
      ['C', 'E', 'dashed', 'arrow', undefined],
      ['D', 'E', 'dashed', 'arrow', undefined],
    ]);
    expect(file.style.get('A')).toEqual(new Map([['fill', '#e3f2fd'], ['line', '#0d47a1']]));
    expect(made.notes.map(note => note.id)).toEqual(['diagram.mermaid.skipped', 'diagram.mermaid.skipped']);
  });

  it('makes ids dgm can read, and turns line breaks into \\n', () => {
    const made = fromMermaid('graph TD\n  my-node["一行目<br/>二行目"] --- other-node');
    const file = parseDiagram(made.text);
    expect(file.nodes.map(node => node.id)).toEqual(['my_node', 'other_node']);
    expect(file.nodes[0]!.text).toBe('一行目\\n二行目');
    expect(file.edges[0]).toMatchObject({ from: 'my_node', to: 'other_node', arrow: 'none' });
  });

  it('says what it could not carry, and refuses what is not a flowchart', () => {
    const made = fromMermaid('flowchart TB\n  a ==> b\n  a --> b\n  a --o c');
    expect(made.notes.map(note => note.id)).toEqual(['diagram.mermaid.twice', 'diagram.mermaid.linkLook']);
    expect(() => fromMermaid('sequenceDiagram\n  A->>B: hi')).toThrow();
  });
});

describe('dgm → Mermaid', () => {
  const FLOW = [
    'flow LR {',
    '  start ([開始])',
    '  check {確認\\n済み?}',
    '  db [(DB)]',
    '  note1 "注記"',
    '  group back "Back end" TB { db }',
    '  start --> check',
    '  check -.-> db "はい"',
    '  check <--> note1',
    '  start ~~~ db',
    '}',
    '',
    'style {',
    '  db { fill: #e3f2fd, line: dashed }',
    '}',
    '',
  ].join('\n');

  it('writes the shapes, groups, links and colours', () => {
    const made = toMermaid(parseDiagram(FLOW));
    expect(made.text).toBe([
      'flowchart LR',
      '  start(["開始"])',
      '  check{"確認<br>済み?"}',
      '  db[("DB")]',
      '  note1["注記"]',
      '  subgraph back["Back end"]',
      '    direction TB',
      '    db',
      '  end',
      '  start --> check',
      '  check -.->|"はい"| db',
      '  check <--> note1',
      '  start ~~~ db',
      '  style db fill:#e3f2fd,stroke-dasharray:5 5',
      '  style note1 fill:none,stroke:none',
      '',
    ].join('\n'));
    expect(made.notes).toEqual([]);
  });

  it('comes back as the same flow', () => {
    const back = parseDiagram(fromMermaid(toMermaid(parseDiagram(FLOW)).text).text);
    const before = parseDiagram(FLOW);
    expect(back.edges.map(edge => [edge.from, edge.to, edge.line, edge.arrow, edge.label]))
      .toEqual(before.edges.map(edge => [edge.from, edge.to, edge.line, edge.arrow, edge.label]));
    const shapes = (file: typeof back) => file.nodes.map(node => [node.id, node.shape, node.text].join(' ')).sort();
    expect(shapes(back))
      .toEqual(shapes(before));
  });

  it('says what Mermaid cannot hold, and refuses a drawing that is not a flow', () => {
    const free = parseDiagram('free {\n  a [A]\n}\n\nlayout {\n  a @ (0, 0)\n}\n\nstyle {\n  a { icon: net/router }\n}\n');
    expect(toMermaid(free).notes.map(note => note.id)).toEqual(['diagram.mermaid.pinsDropped', 'diagram.mermaid.iconsDropped']);
    expect(() => toMermaid(parseDiagram('parts {\n  ok [ ] 10x10\n}\n'))).toThrow();
  });
});
