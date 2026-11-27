// Tests for the swim mode: a flow whose shapes are kept to the lanes it names.

import { describe, expect, it } from 'vitest';
import { applyEdit, sliceBytes } from '@docpresenter/base';
import {
  completeDiagram, DiagramParseError, formatDiagram, layOutDiagram, parseDiagram, removeNode, setNodeText,
  type Box, type LaidOutDiagram,
} from '../src/index.js';

const ORDER = (direction: string): string => `swim 受注 ${direction} {
  lane cust "顧客" { start; order; recv }
  lane shop "店舗" { accept; check; ship }
  lane wh   "倉庫" { pick; pack }

  start  ([開始])
  order  [注文する]
  accept [受注]
  check  {在庫あり?}
  pick   [ピッキング]
  pack   [梱包]
  ship   [発送]
  recv   ([受け取り])

  start  --> order
  order  --> accept
  accept --> check
  check  --> pick "はい"
  check  --> order "いいえ"
  pick   --> pack
  pack   --> ship
  ship   --> recv
}
`;

const LANES = { cust: ['start', 'order', 'recv'], shop: ['accept', 'check', 'ship'], wh: ['pick', 'pack'] };

/** Whether `inner` lies wholly inside `outer`. */
function within(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function box(laid: LaidOutDiagram, id: string): Box {
  const found = laid.boxes.get(id);
  if (!found) throw new Error(`no box for ${id}`);
  return found;
}

describe('swim の読み取り', () => {
  it('swim は flow として読み、lane はレーンの印が付いたグループになる', () => {
    const file = parseDiagram(ORDER('LR'));
    expect(file.mode).toBe('flow');
    expect(file.swim).toBe(true);
    expect(file.direction).toBe('LR');
    const lanes = file.nodes.filter(node => node.lane);
    expect(lanes.map(lane => [lane.id, lane.text, lane.shape])).toEqual([
      ['cust', '顧客', 'group'], ['shop', '店舗', 'group'], ['wh', '倉庫', 'group'],
    ]);
    expect(lanes[0]!.children).toEqual(['start', 'order', 'recv']);
  });

  it('flow は swim の印を持たない', () => {
    expect(parseDiagram('flow {\n  a [A]\n}').swim).toBeUndefined();
  });

  it('lane は swim の外では誤り', () => {
    expect(() => parseDiagram('flow {\n  a [A]\n  lane l { a }\n}')).toThrow(DiagramParseError);
  });

  it('lane の id とメンバーにハイフンは使えない', () => {
    expect(() => parseDiagram('swim {\n  a [A]\n  lane my-lane { a }\n}')).toThrow(/my-lane/);
    expect(() => parseDiagram('swim {\n  a [A]\n  lane l { a-b }\n}')).toThrow(/a-b/);
  });
});

describe('swim の配置', () => {
  for (const direction of ['LR', 'RL', 'TB', 'BT']) {
    it(`${direction}: どの図形も自分のレーンの中にあり、レーンは書いた順に並ぶ`, () => {
      const laid = layOutDiagram(parseDiagram(ORDER(direction)));
      expect(laid.diagnostics).toEqual([]);
      for (const [lane, members] of Object.entries(LANES)) {
        for (const id of members) expect(within(box(laid, id), box(laid, lane)), `${id} in ${lane}`).toBe(true);
      }
      // Across the flow, the lanes follow one another without overlapping.
      const across = direction === 'LR' || direction === 'RL';
      const [a, b, c] = ['cust', 'shop', 'wh'].map(id => box(laid, id));
      const start = (one: Box): number => (across ? one.y : one.x);
      const end = (one: Box): number => (across ? one.y + one.height : one.x + one.width);
      expect(start(a!)).toBeLessThan(start(b!));
      expect(start(b!)).toBeLessThan(start(c!));
      expect(end(a!)).toBeLessThanOrEqual(start(b!));
      expect(end(b!)).toBeLessThanOrEqual(start(c!));
      // Along it, every lane runs the same length.
      const length = (one: Box): [number, number] => (across ? [one.x, one.width] : [one.y, one.height]);
      expect(length(a!)).toEqual(length(b!));
      expect(length(b!)).toEqual(length(c!));
    });
  }

  it('流れの順は、レーンが無い flow と同じく接続が決める', () => {
    const laid = layOutDiagram(parseDiagram(ORDER('LR')));
    const x = (id: string): number => box(laid, id).x;
    expect(x('start')).toBeLessThan(x('order'));
    expect(x('order')).toBeLessThan(x('accept'));
    expect(x('accept')).toBeLessThan(x('check'));
    expect(x('check')).toBeLessThan(x('pick'));
    expect(x('pack')).toBeLessThan(x('ship'));
    expect(x('ship')).toBeLessThan(x('recv'));
  });

  it('同じ段の同じレーンに 2 つあれば、レーンを太くして並べる', () => {
    const laid = layOutDiagram(parseDiagram(`swim LR {
  lane l1 { a }
  lane l2 { b; c }
  a [A]
  b [B]
  c [C]
  a --> b
  a --> c
}`));
    const [b, c, l2] = ['b', 'c', 'l2'].map(id => box(laid, id));
    expect(within(b!, l2!)).toBe(true);
    expect(within(c!, l2!)).toBe(true);
    // Side by side across the flow, not on top of each other.
    expect(b!.y + b!.height <= c!.y || c!.y + c!.height <= b!.y).toBe(true);
    expect(box(laid, 'l1').height).toBeLessThan(l2!.height);
  });

  it('レーンを横切る線は、レーンの枠を迂回しない', () => {
    const laid = layOutDiagram(parseDiagram(ORDER('LR')));
    const line = laid.routes.find(route => route.edge.from === 'order' && route.edge.to === 'accept')!;
    // A plain elbow from one lane down into the next: no detour round the frames.
    expect(line.points.length).toBeLessThanOrEqual(4);
  });

  it('どのレーンにも無い図形は、レーンの後ろに置いて知らせる', () => {
    const laid = layOutDiagram(parseDiagram(`swim LR {
  lane l1 { a }
  a [A]
  b [B]
  a --> b
}`));
    expect(laid.notes.map(note => note.id)).toEqual(['diagram.layout.notInLane']);
    expect(box(laid, 'b').y).toBeGreaterThanOrEqual(box(laid, 'l1').y + box(laid, 'l1').height);
  });

  it('2 つのレーンにある図形は、先に書いたレーンに置いて知らせる', () => {
    const laid = layOutDiagram(parseDiagram(`swim LR {
  lane l1 { a }
  lane l2 { a; b }
  a [A]
  b [B]
  a --> b
}`));
    expect(laid.notes.map(note => note.id)).toEqual(['diagram.layout.twoLanes']);
    expect(within(box(laid, 'a'), box(laid, 'l1'))).toBe(true);
  });

  it('レーンの無い swim は flow として並べ、そう知らせる', () => {
    const laid = layOutDiagram(parseDiagram('swim {\n  a [A]\n  b [B]\n  a --> b\n}'));
    expect(laid.notes.map(note => note.id)).toEqual(['diagram.layout.noLanes']);
    expect(box(laid, 'a').y).toBeLessThan(box(laid, 'b').y);
  });

  it('レーンに入れたグループは、その中身ごとレーンに入る', () => {
    const laid = layOutDiagram(parseDiagram(`swim LR {
  lane l1 { a }
  lane l2 { g }
  a [A]
  b [B]
  c [C]
  group g "G" { b; c }
  a --> b
  b --> c
}`));
    expect(laid.diagnostics).toEqual([]);
    expect(within(box(laid, 'b'), box(laid, 'l2'))).toBe(true);
    expect(within(box(laid, 'c'), box(laid, 'l2'))).toBe(true);
  });

  it('ピン留めした図形は、レーンより書いた位置が勝つ', () => {
    const laid = layOutDiagram(parseDiagram(`swim LR {
  lane l1 { a }
  lane l2 { b }
  a [A]
  b [B]
  a --> b
}
layout {
  b @ (500, 0)
}`));
    expect(box(laid, 'b').x - laid.origin.x).toBe(500);
    expect(box(laid, 'b').y - laid.origin.y).toBe(0);
  });
});

describe('swim の整形と編集', () => {
  it('整形しても swim の見出しと lane の順は変わらない', () => {
    const source = `swim LR {
  lane zz "Z" { b }
  lane aa "A" { a }
  a [A]
  b [B]
  a-->b
}
`;
    const formatted = formatDiagram(source);
    expect(formatted.text).toBe(`swim LR {
  lane zz "Z" { b }
  lane aa "A" { a }

  a [A]
  b [B]

  a --> b
}
`);
    // And again: a formatted file stays as it is.
    expect(formatDiagram(formatted.text).changed).toBe(false);
  });

  it('レーンのメンバーを消しても、その行は lane のまま', () => {
    const source = ORDER('LR');
    const written = applyEdit(source, removeNode(parseDiagram(source), source, 'recv'));
    expect(written).toContain('lane cust "顧客" { start; order }');
    expect(parseDiagram(written).nodes.find(node => node.id === 'cust')?.lane).toBe(true);
  });
});

describe('swim の補完', () => {
  const offered = (marked: string): string[] => {
    const lines = marked.split('\n');
    const line = lines.findIndex(one => one.includes('|'));
    return completeDiagram(marked.replace('|', ''), line, lines[line]!.indexOf('|'), {}).map(one => one.label);
  };

  it('最上位で swim を出す', () => {
    expect(offered('|')).toContain('swim');
  });

  it('swim の中でだけ lane を出す', () => {
    expect(offered('swim {\n  a [A]\n  |\n}')).toContain('lane');
    expect(offered('flow {\n  a [A]\n  |\n}')).not.toContain('lane');
  });

  it('lane のメンバーには、まだ挙げていない図形を出す', () => {
    const labels = offered('swim {\n  a [A]\n  b [B]\n  lane l { a; |\n}');
    expect(labels).toContain('b');
    expect(labels).not.toContain('a');
  });

  it('swim の見出しでは向きを出す', () => {
    expect(offered('swim |')).toContain('LR');
  });
});

const BLOCK = `swim 受注 LR {
  lane cust "顧客" {
    start ([開始])
    order [注文する]
    recv  ([受け取り])
    start --> order
  }

  lane shop "店舗" {
    accept [受注]
    ship   [発送]
  }

  order  --> accept
  accept --> ship
  ship   --> recv
}
`;

describe('ブロックで書くレーン', () => {
  it('中に書いた図形がメンバーになり、レーン自身は開きの行になる', () => {
    const file = parseDiagram(BLOCK);
    const cust = file.nodes.find(node => node.id === 'cust')!;
    expect(cust.lane).toBe(true);
    expect(cust.children).toEqual(['start', 'order', 'recv']);
    expect(sliceBytes(BLOCK, cust.span.start, cust.span.end)).toBe('lane cust "顧客" {');
    expect(cust.close).toBeDefined();
    // The connection written inside is a connection like any other.
    expect(file.edges.map(edge => `${edge.from}->${edge.to}`)).toContain('start->order');
  });

  it('1 行で書くレーンと混ぜてよい', () => {
    const file = parseDiagram('swim {\n  lane a {\n    x [X]\n  }\n  lane b { y }\n  y [Y]\n  x --> y\n}');
    expect(file.nodes.filter(node => node.lane).map(node => [node.id, node.children])).toEqual([
      ['a', ['x']], ['b', ['y']],
    ]);
  });

  it('レーンの中のレーンと、閉じていないレーンは誤り', () => {
    expect(() => parseDiagram('swim {\n  lane a {\n    lane b {\n    }\n  }\n}')).toThrow(/b/);
    expect(() => parseDiagram('swim {\n  lane a {\n    x [X]\n}')).toThrow(DiagramParseError);
    expect(() => parseDiagram('flow {\n  lane a {\n    x [X]\n  }\n}')).toThrow(DiagramParseError);
  });

  it('どの図形も自分のレーンの中に置かれる', () => {
    const laid = layOutDiagram(parseDiagram(BLOCK));
    expect(laid.diagnostics).toEqual([]);
    for (const id of ['start', 'order', 'recv']) expect(within(box(laid, id), box(laid, 'cust'))).toBe(true);
    for (const id of ['accept', 'ship']) expect(within(box(laid, id), box(laid, 'shop'))).toBe(true);
  });

  it('整形すると、レーンの中は図形・グループの順に一段深く、接続は外にまとめる', () => {
    const formatted = formatDiagram(BLOCK);
    expect(formatted.text).toBe(`swim 受注 LR {
  lane cust "顧客" {
    start ([開始])
    order [注文する]
    recv  ([受け取り])
  }

  lane shop "店舗" {
    accept [受注]
    ship   [発送]
  }

  start  --> order
  order  --> accept
  accept --> ship
  ship   --> recv
}
`);
    expect(formatDiagram(formatted.text).changed).toBe(false);
  });

  it('メンバーを消すと、その行だけが消えてレーンの行は変わらない', () => {
    const written = applyEdit(BLOCK, removeNode(parseDiagram(BLOCK), BLOCK, 'recv'));
    expect(written).toContain('  lane cust "顧客" {\n    start ([開始])\n    order [注文する]\n    start --> order\n  }');
    expect(parseDiagram(written).nodes.find(node => node.id === 'cust')?.children).toEqual(['start', 'order']);
  });

  it('レーンを消すと、中の図形はレーンの外に残る', () => {
    const written = applyEdit(BLOCK, removeNode(parseDiagram(BLOCK), BLOCK, 'cust'));
    const file = parseDiagram(written);
    expect(file.nodes.some(node => node.id === 'cust')).toBe(false);
    expect(file.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['start', 'order', 'recv']));
    expect(file.edges).toHaveLength(4);
  });

  it('ラベルを直すと、開きの行だけが書き換わる', () => {
    const edit = setNodeText(parseDiagram(BLOCK), 'cust', 'お客様', BLOCK);
    const written = applyEdit(BLOCK, edit);
    expect(written).toContain('  lane cust "お客様" {\n    start ([開始])');
    expect(parseDiagram(written).nodes.find(node => node.id === 'cust')?.children).toEqual(['start', 'order', 'recv']);
  });
});
