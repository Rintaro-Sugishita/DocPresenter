import { describe, expect, it } from 'vitest';
import { completeDiagram, DEFAULT_PARTS, parseDiagram, partsOf } from '../src/index.js';

/** The file with `|` where the cursor is, and what is offered there. */
function at(marked: string, context = {}): ReturnType<typeof completeDiagram> {
  const lines = marked.split('\n');
  const line = lines.findIndex(one => one.includes('|'));
  const column = lines[line]!.indexOf('|');
  return completeDiagram(marked.replace('|', ''), line, column, context);
}
const labels = (marked: string, context = {}): string[] => at(marked, context).map(one => one.label);

const DRAWING = [
  'flow Login {',
  '  start ([Start])',
  '  form  [Login form]',
  '  check {Valid?}',
  '  db    [(Users)]',
  '  group back "Back end" { db }',
  '  start --> form',
  '  form -> check',
  '  |',
  '}',
].join('\n');

describe('作図ファイルの補完', () => {
  it('最上位ではセクションを出し、図が既にあれば図の種類は出さない', () => {
    expect(labels('|')).toEqual(['flow', 'free', 'overlay', 'layout', 'style', 'use', 'items', 'parts']);
    expect(labels('flow {\n  a [A]\n}\n\nla|')).toEqual(['layout', 'style', 'use', 'parts']);
    // 置き換えるのは打ちかけの語だけ
    expect(at('flow {\n}\nla|')[0]!.from).toBe(0);
    // overlay の図に layout は意味を持たない
    expect(labels('overlay "a.png" {\n}\n|')).toEqual(['style', 'use', 'parts']);
  });

  it('use の引用符の中では、同梱の 2 つと作業場の部品ファイルを出す', () => {
    const offered = at('use "../|"', { libraries: ['../shared/ui-parts.dgm'] });
    expect(offered.map(one => one.label)).toEqual(['default', 'icons', '../shared/ui-parts.dgm']);
    expect(offered[0]!.from).toBe(5);
  });

  it('id の後ろでは図形の括弧・部品・接続をこの順に出す', () => {
    const offered = at('flow {\n  api |\n}', { parts: partsOf(parseDiagram('use "default"\n'), () => undefined) });
    const kinds = offered.map(one => one.kind);
    expect(kinds.indexOf('shape')).toBe(0);
    expect(kinds.lastIndexOf('shape')).toBeLessThan(kinds.indexOf('part'));
    expect(kinds.lastIndexOf('part')).toBeLessThan(kinds.indexOf('connector'));
    // 括弧は中にカーソルが入る形で書かれる
    expect(offered.find(one => one.detail === '円柱')!.insert).toBe('[($1)]');
    expect(offered.find(one => one.label === 'textbox:')!.insert).toBe('textbox:"$0"');
    // 行を持つ部品は、行を書く形で入る
    expect(offered.find(one => one.label === 'tree:')!.insert).toBe('tree: {\n\t- $0\n}');
  });

  it('接続の先には、まだつないでいない図形を出す（グループと自分は除く）', () => {
    expect(labels(DRAWING.replace('  |', '  form --> |'))).toEqual(['start', 'db']);
    expect(labels(DRAWING.replace('  |', '  start -.-> c|'))).toEqual(['check', 'db']);
  });

  it('打ちかけの接続記号には、その続きになる記号を出す', () => {
    expect(labels(DRAWING.replace('  |', '  start -|'))).toEqual(['-->', '->', '--', '-.->']);
    expect(labels(DRAWING.replace('  |', '  start -.|'))).toEqual(['-.->']);
    expect(at(DRAWING.replace('  |', '  start --|'))[0]!.insert).toBe('--> ');
  });

  it('新しい行では、ある図形（線の起点）と group を出す。打ちかけの行は図形に数えない', () => {
    expect(labels(DRAWING)).toEqual(['start', 'form', 'check', 'db', 'group']);
    expect(labels(DRAWING.replace('  |', '  fo|'))).toContain('form');
    expect(labels(DRAWING.replace('  |', '  fo|'))).not.toContain('fo');
  });

  it('グループの中には、まだ入っていない図形を出す', () => {
    expect(labels(DRAWING.replace('  |', '  group front { start; |'))).toEqual(['form', 'check', 'db']);
  });

  it('::: の後ろにはテーマの分類を出す', () => {
    expect(labels('flow {\n  a [A] :::ch|\n}')).toEqual(['changed', 'pending', 'removed', 'disabled']);
  });

  it('layout では、位置の無い図形と折れ点の無い線と入れ物を出す', () => {
    const file = DRAWING.replace('  |\n', '') + '\n\nlayout {\n  form @ (10, 20)\n  start -> form @ (5, 5)\n  |\n}';
    const offered = at(file);
    expect(offered.map(one => one.label)).toEqual(
      ['start', 'check', 'db', 'back', 'form -> check', 'stack', 'grid', 'tabs']);
    expect(offered[0]!.insert).toBe('start @ (${1:0}, ${2:0})');
  });

  it('入れ物の設定と中身を補う', () => {
    const file = DRAWING.replace('  |\n', '') + '\n\nlayout {\n  |\n}';
    expect(labels(file.replace('  |', '  grid g (|'))).toEqual(['cols', 'gap', 'pad', 'scroll']);
    expect(labels(file.replace('  |', '  tabs t (show: |'))).toContain('form');
    expect(labels(file.replace('  |', '  stack s (down) { start; |'))).toEqual(['form', 'check', 'db']);
    // 何行にも分けた入れ物の中でも出す。入っているものは出さない
    expect(labels(file.replace('  |', '  stack s (down) {\n    start\n    |\n  }'))).toEqual(['form', 'check', 'db']);
  });

  it('style では、見た目の無い図形・プロパティ・トークン・絵の名前を出す', () => {
    const file = DRAWING.replace('  |\n', '') + '\n\nstyle {\n  theme: default\n  db { fill: #eee }\n  |\n}';
    expect(labels(file)).toEqual(['start', 'form', 'check', 'back']);
    expect(labels(file.replace('  |', '  form { fill: shade, |'))).toEqual(
      ['line', 'color', 'align', 'icon', 'arrow', 'slope', 'weight']);
    expect(labels(file.replace('  |', '  form { line: |'))).toEqual(['dashed']);
    const icons = at(file.replace('  |', '  form { icon: net/r|'));
    expect(icons.map(one => one.label)).toContain('net/router');
    expect(icons[0]!.from).toBe('  form { icon: '.length);
  });

  it('parts の行の { } の中でもプロパティを出す', () => {
    expect(labels('parts {\n  ok ( ) { fill: #fff, |\n}')).toContain('line');
  });

  it('overlay では次の番号の注釈を出す', () => {
    expect(labels('overlay "a.png" {\n  ① @ (1, 2) -> (3, 4)\n  |\n}')).toEqual(['②']);
  });

  it('行を持つ部品の中では何も出さない', () => {
    expect(at('free {\n  nav tree: {\n    - |\n  }\n}')).toEqual([]);
  });

  it('英語でも説明が出る', () => {
    expect(at('|', { locale: 'en' })[0]!.detail).toBe('Laid out for you, from the connections');
  });

  it('同梱の部品の見出しは、読み手の言葉で出す', () => {
    const parts = partsOf(parseDiagram(DEFAULT_PARTS), () => undefined);
    const offered = at('flow {\n  a |\n}', { parts, locale: 'en' });
    expect(offered.find(one => one.label === 'textbox:')!.detail).toMatch(/^Part \(.+\)$/);
  });
});
