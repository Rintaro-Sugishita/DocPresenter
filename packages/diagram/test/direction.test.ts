import { describe, expect, it } from 'vitest';
import { applyEdit } from '@docpresenter/base';
import { completeDiagram, layOutDiagram, parseDiagram, setNodeText, type Box } from '../src/index.js';

const centre = (box: Box): { x: number; y: number } => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const laid = (source: string): ReturnType<typeof layOutDiagram> => layOutDiagram(parseDiagram(source));
const CHAIN = '  a [A]\n  b [B]\n  c [C]\n  a --> b\n  b --> c\n}';

describe('flow の向き', () => {
  it('Mermaid と同じ語で、見出しの最初か最後に書く', () => {
    expect(parseDiagram(`flow LR {\n${CHAIN}`).direction).toBe('LR');
    expect(parseDiagram(`flow 構成 TD {\n${CHAIN}`).direction).toBe('TD');
    expect(parseDiagram(`flow 構成 {\n${CHAIN}`).direction).toBeUndefined();
  });

  it('LR は左から右へ、RL は右から左へ並ぶ', () => {
    const lr = laid(`flow LR {\n${CHAIN}`).boxes;
    expect(lr.get('b')!.x).toBeGreaterThan(lr.get('a')!.x);
    expect(lr.get('c')!.x).toBeGreaterThan(lr.get('b')!.x);
    expect(centre(lr.get('a')!).y).toBe(centre(lr.get('c')!).y);

    const rl = laid(`flow RL {\n${CHAIN}`).boxes;
    expect(rl.get('b')!.x).toBeLessThan(rl.get('a')!.x);
    expect(rl.get('c')!.x).toBeLessThan(rl.get('b')!.x);
  });

  it('BT は下から上へ並ぶ', () => {
    const bt = laid(`flow BT {\n${CHAIN}`).boxes;
    expect(bt.get('b')!.y).toBeLessThan(bt.get('a')!.y);
    expect(bt.get('c')!.y).toBeLessThan(bt.get('b')!.y);
  });

  it('書かなければ TB。TB と TD は同じ図になる', () => {
    // 見出しの長さだけ線の行の位置がずれるので、比べるのは形だけ。
    const shape = (source: string): unknown => {
      const drawn = laid(source);
      return [drawn.boxes, drawn.routes.map(route => route.points), drawn.width, drawn.height];
    };
    const none = shape(`flow {\n${CHAIN}`);
    expect(shape(`flow TB {\n${CHAIN}`)).toEqual(none);
    expect(shape(`flow TD {\n${CHAIN}`)).toEqual(none);
  });

  it('LR の線は横から出て横から入る', () => {
    const drawn = laid('flow LR {\n  a [A]\n  b [B]\n  c [C]\n  a --> b\n  a --> c\n}');
    for (const route of drawn.routes) {
      // 最初の曲がり角までは横に進む——上下から出る線は、流れと直交してしまう。
      expect(route.points[1]!.y).toBe(route.points[0]!.y);
    }
  });

  it('自由配置に書いた向きは効かないと言う', () => {
    const drawn = laid('free LR {\n  a [A]\n  group g "G" TB { a }\n}\nlayout {\n  a @ (0,0)\n}');
    expect(drawn.diagnostics.filter(one => one.includes('flow'))).toHaveLength(2);
  });
});

describe('グループの向き', () => {
  const NESTED = [
    'flow TB {',
    '  a [A]',
    '  b [B]',
    '  c [C]',
    '  d [D]',
    '  group g "横" LR { b; c }',
    '  a --> b',
    '  b --> c',
    '  c --> d',
    '}',
  ].join('\n');

  it('グループの行に書いた向きを読む', () => {
    const group = parseDiagram(NESTED).nodes.find(node => node.id === 'g')!;
    expect(group.direction).toBe('LR');
    expect(group.children).toEqual(['b', 'c']);
  });

  it('グループの中は自分の向きで並び、外は図の向きで並ぶ', () => {
    const { boxes } = laid(NESTED);
    const [a, b, c, d, g] = ['a', 'b', 'c', 'd', 'g'].map(id => boxes.get(id)!) as [Box, Box, Box, Box, Box];
    // 中は横に
    expect(c.x).toBeGreaterThan(b.x + b.width);
    expect(centre(b).y).toBe(centre(c).y);
    // 外は縦に。枠ごと 1 つの図形として並ぶので、枠は a と d に重ならない
    expect(g.y).toBeGreaterThan(a.y + a.height);
    expect(d.y).toBeGreaterThan(g.y + g.height);
  });

  it('外とつながっていても向きを捨てない（Mermaid はここで捨てる）', () => {
    const { boxes } = laid(NESTED);
    expect(boxes.get('b')!.y).toBe(boxes.get('c')!.y);
  });

  it('入れ子のグループもそれぞれの向きで並ぶ', () => {
    const { boxes } = laid([
      'flow LR {',
      '  a [A]',
      '  b [B]',
      '  c [C]',
      '  group inner "縦" TB { b; c }',
      '  group outer "外" RL { inner }',
      '  a --> b',
      '  b --> c',
      '}',
    ].join('\n'));
    const [a, b, c] = ['a', 'b', 'c'].map(id => boxes.get(id)!) as [Box, Box, Box];
    expect(c.y).toBeGreaterThan(b.y + b.height);
    expect(b.x).toBeGreaterThan(a.x + a.width);
  });

  it('内側のグループは外側の枠より手前に描く', () => {
    // 内側は外側より先に書くしかない（外側の枠は中身から決まる）。書いた順に
    // 塗ると、外側の枠が内側を覆ってしまう。
    const { order } = laid('flow {\n  a [A]\n  group inner "内" { a }\n  group outer "外" { inner }\n}');
    expect(order.indexOf('inner')).toBeGreaterThan(order.indexOf('outer'));
  });

  it('グループの名前を変えても、向きは書いたまま残る', () => {
    const source = NESTED;
    const written = applyEdit(source, setNodeText(parseDiagram(source), 'g', '横並び'));
    expect(written).toContain('group g "横並び" LR { b; c }');
  });
});

describe('向きの補完', () => {
  const at = (marked: string): string[] => {
    const lines = marked.split('\n');
    const line = lines.findIndex(one => one.includes('|'));
    return completeDiagram(marked.replace('|', ''), line, lines[line]!.indexOf('|'), {})
      .map(one => one.label);
  };

  it('flow の後と、グループの名前の後に向きを出す', () => {
    expect(at('flow |')).toEqual(['TB', 'LR', 'BT', 'RL', 'TD']);
    expect(at('flow {\n  a [A]\n  group g "G" |\n}')).toEqual(['TB', 'LR', 'BT', 'RL', 'TD']);
  });

  it('向きを書いたグループでもメンバーを出す', () => {
    expect(at('flow {\n  a [A]\n  group g "G" LR { |\n}')).toEqual(['a']);
  });
});
