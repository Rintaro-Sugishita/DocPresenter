// Checks the published specifications against the implementation.
//
// `spec/` says what a conformant reader must do, and it says it to people we
// will never meet — the formats are free for anyone to implement. A sentence in
// there that the code does not honour is worse than no sentence at all, so every
// normative claim that can be executed is executed here.
//
// Each assertion names the section of the spec it comes from.
import { parseDiagram } from '../packages/diagram/dist/parse.js';
import { layOutDiagram } from '../packages/diagram/dist/layout.js';
import { renderDiagram, diagramDiagnostics } from '../packages/diagram/dist/draw/render.js';
import { withParts } from '../packages/diagram/dist/parts.js';
import { dropInto } from '../packages/diagram/dist/arrange.js';
import { rowBoxes, rowTextAt } from '../packages/diagram/dist/draw/listing.js';
import {
  addNode, putIntoContainer, setItems, setNodePart, setNodeShape,
} from '../packages/diagram/dist/edits.js';
import { formatDiagram } from '../packages/diagram/dist/format.js';
import { applyEdit } from '../packages/base/dist/index.js';
import { parseRuns } from '../packages/diagram/dist/inline.js';
import { parseTable } from '../packages/markdown/dist/table/parse.js';
import { cellAt as coverAt } from '../packages/markdown/dist/table/model.js';
import { rowRules, cellRules } from '../packages/markdown/dist/html/table.js';

let failed = 0;
const check = (where, name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${where}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};
/** Reads a source that the spec says is invalid, and returns the message. */
const refuses = (read, source) => {
  try { read(source); return undefined; } catch (error) { return error.message; }
};
const node = (file, id) => file.nodes.find(n => n.id === id);
const NL = String.fromCharCode(10);

// ───────────────────────────── spec/dgm.md ─────────────────────────────

const dgm = (...lines) => parseDiagram(lines.join(NL));

check('dgm §1', '意味の節が無ければエラー',
  refuses(parseDiagram, 'layout {' + NL + '}') !== undefined);
check('dgm §1', '解釈できない最上位の行はエラー',
  refuses(parseDiagram, 'free {' + NL + '}' + NL + 'nonsense') !== undefined);
check('dgm §1', '閉じられていない節はエラー',
  refuses(parseDiagram, 'free {' + NL + '  a [x]') !== undefined);
check('dgm §1.1', '節の見出しの自由文は意味を持たない',
  dgm('free タイトル {', '  a [x]', '}').nodes.length === 1);
check('dgm §1', '節は順不同',
  dgm('style {', '}', 'free {', '  a [x]', '}').nodes.length === 1);
check('dgm §1', 'layout が複数あれば統合する',
  dgm('free {', '  a [x]', '  b [y]', '}',
      'layout {', '  a @ (0, 0)', '}',
      'layout {', '  b @ (10, 10)', '}').layout.size === 2);

// §3.1 the bracket table, in the order a reader must try it
const shapes = {
  '[x]': 'rect', '(x)': 'round-rect', '([x])': 'stadium', '[(x)]': 'cylinder',
  '((x))': 'ellipse', '{x}': 'diamond', '{{x}}': 'hexagon', '[/x/]': 'parallelogram',
  '[/x\\]': 'loop-start', '[\\x/]': 'loop-end', '>x]': 'note', '"x"': 'text',
};
for (const [written, shape] of Object.entries(shapes)) {
  const found = node(dgm('free {', `  a ${written}`, '}'), 'a');
  check('dgm §3.1', `${written} は ${shape}`, found?.shape === shape, found?.shape);
}
check('dgm §3.1', 'ラベルは空でもよい', node(dgm('free {', '  a []', '}'), 'a')?.text === '');
check('dgm §3.1', ':::class を読む',
  node(dgm('free {', '  a [x]:::pending', '}'), 'a')?.className === 'pending');

// §3.2 the connector table
const edge = text => dgm('free {', '  a [x]', '  b [y]', `  ${text}`, '}').edges[0];
for (const [written, line, arrow] of [
  ['a --> b', 'solid', 'arrow'], ['a -> b', 'solid', 'arrow'],
  ['a -- b', 'solid', 'none'], ['a -.-> b', 'dashed', 'arrow'], ['a ~~~ b', 'invisible', 'none'],
]) {
  const found = edge(written);
  check('dgm §3.2', `${written} は ${line}/${arrow}`,
    found?.line === line && found?.arrow === arrow, `${found?.line}/${found?.arrow}`);
}
check('dgm §3.2', '接続のラベルを読む', edge('a -> b "HTTPS"')?.label === 'HTTPS');
check('dgm §3.2', '末尾の ~ は並び順に効かない線', edge('a -> b "戻る" ~')?.loose === true && edge('a -> b')?.loose === false);

// §3「L2 は『ピン』だけではない」— 入れ物
const laidOut = (...lines) => layOutDiagram(dgm(...lines));
const held = laidOut(
  'free {', '  frame [ ]', '  a [あ]', '  b [い]', '  c [う]', '}',
  'layout {',
  '  frame @ (0, 0) 300x400',
  '  stack frame (down; gap: 10; pad: 20) { a ; b ; c }',
  '}');
check('dgm §3 L2', 'stack は間隔を 1 回書けば座標は計算される',
  held.boxes.get('b').y - (held.boxes.get('a').y + held.boxes.get('a').height) === 10);
check('dgm §3 L2', '縦に積むと幅が揃う（交差軸は伸びる）',
  held.boxes.get('a').width === 260 && held.boxes.get('c').width === 260,
  `${held.boxes.get('a').width} / ${held.boxes.get('c').width}`);

const spanned = laidOut(
  'free {', '  form [ ]', '  wide [見出し]', '  one [左]', '}',
  'layout {',
  '  form @ (0, 0) 400x200',
  '  grid form (gap: 0 0; pad: 0) {', '    wide ; wide', '    one  ; .', '  }',
  '}');
check('dgm §3 L2', '同じ名前を並べるとセルをまたぐ', spanned.boxes.get('wide').width === 400);
check('dgm §3 L2', '. は空のセル', spanned.boxes.get('one').width === 200);

const escaped = laidOut(
  'free {', '  frame [ ]', '  a [あ]', '}',
  'layout {', '  frame @ (0, 0) 300x400', '  a @ (500, 500) 80x20',
  '  stack frame (down) { a }', '}');
check('dgm §3 L2', '入れ物の中でもピンが勝つ',
  escaped.boxes.get('a').width === 80 && escaped.boxes.get('a').x > 300);
check('dgm §3 L2', '入りきらない中身は描いたうえで言う',
  laidOut('free {', '  frame [ ]', '  a [あ]', '  b [い]', '}',
    'layout {', '  frame @ (0, 0) 300x40',
    '  stack frame (down; gap: 10; pad: 10) { a ; b }', '}')
    .diagnostics.join(' ').includes('入りきらない'));
check('dgm §3 L2', '入れ物は 1 つのバイト範囲',
  dgm('free {', '  f [ ]', '  a [A]', '}', 'layout {', '  stack f (down) {', '    a', '  }', '}')
    .containers.get('f').span.end > 0);

const tabbed = laidOut(
  'free {', '  main [ ]', '  one [い]', '  two [に]', '  a [あ]', '}',
  'layout {', '  main @ (0, 0) 300x200', '  tabs main (show: two) { one ; two }',
  '  stack one (down; pad: 0) { a }', '}');
check('dgm §3 L2', 'tabs は選んだ頁だけを描く',
  tabbed.boxes.has('two') && !tabbed.boxes.has('one'));
check('dgm §3 L2', '描かれない頁は下に並べられたりしない',
  !tabbed.boxes.has('a') && tabbed.diagnostics.length === 0,
  tabbed.diagnostics.join(' / '));

const cut = laidOut(
  'free {', '  list [ ]', '  a [あ]', '  b [い]', '  c [う]', '}',
  'layout {', '  list @ (0, 0) 200x60',
  '  stack list (down; gap: 0; pad: 0; scroll) { a ; b ; c }', '}');
check('dgm §3 L2', 'scroll は入りきらない行を描かない',
  cut.boxes.has('a') && !cut.boxes.has('c'));
check('dgm §3 L2', '切れているのは間違いではないので注記しない',
  cut.diagnostics.length === 0, cut.diagnostics.join(' / '));

// §3 L2 入れ物に外から入れる
//
// 入れ物から出す口（ピン）はあっても、入れる口が無ければ、足した部品は一生
// 入れ物の外にいることになる。だから同じ手つきで入る。
const OUTSIDE = ['use "default"', '', 'free {', '  frame [ ]', '  a [あ]', '  b [い]',
  '  loose [はぐれ]', '}', 'layout {', '  frame @ (0, 0) 300x400',
  '  loose @ (500, 500) 80x20', '  stack frame (down; gap: 10; pad: 10) { a ; b }',
  '}'].join(NL);
const outside = parseDiagram(OUTSIDE);
const outsideLaid = layOutDiagram(outside);
const onB = outsideLaid.boxes.get('b');
const came = dropInto(outside.containers.get('frame'), outsideLaid.boxes.get('frame'),
  id => outsideLaid.boxes.get(id), 'loose', { x: onB.x + 5, y: onB.y + 2 }, outsideLaid.holes);
check('dgm §3 L2', '外の図形も入れ物に落とせる',
  JSON.stringify(came?.cells) === JSON.stringify([['a'], ['loose'], ['b']]),
  JSON.stringify(came?.cells));
const cameIn = applyEdit(OUTSIDE,
  putIntoContainer(outside, OUTSIDE, 'frame', came.cells, 'loose'));
check('dgm §3 L2', '入れたらピンは消える（並びが置くので）',
  cameIn.includes('{ a ; loose ; b }') && !/loose\s+@/.test(cameIn));
check('dgm §3 L2', '入れるのは 1 つのバイト範囲',
  putIntoContainer(outside, OUTSIDE, 'frame', came.cells, 'loose').span.end > 0);

const GRID = OUTSIDE.replace('stack frame (down; gap: 10; pad: 10) { a ; b }',
  'grid frame (cols: 1fr, 1fr) { a ; . }');
const gridded = parseDiagram(GRID);
const gridLaid = layOutDiagram(gridded);
check('dgm §3 L2', '格子の空セルは置き場所として分かる',
  gridLaid.holes.length === 1 && gridLaid.holes[0].col === 1,
  JSON.stringify(gridLaid.holes.map(one => [one.row, one.col])));
const intoHole = (at) => dropInto(gridded.containers.get('frame'),
  gridLaid.boxes.get('frame'), id => gridLaid.boxes.get(id), 'loose', at, gridLaid.holes);
const hole = gridLaid.holes[0].box;
check('dgm §3 L2', '格子は空セルに入れる',
  JSON.stringify(intoHole({ x: hole.x + 4, y: hole.y + 4 })?.cells)
  === JSON.stringify([['a', 'loose']]));
check('dgm §3 L2', '格子は埋まったセルには入れない（押し出すことになる）',
  intoHole({ x: gridLaid.boxes.get('a').x + 4, y: gridLaid.boxes.get('a').y + 4 }) === undefined);

// 足すものは選んだものの次に入る。入れ物が置くので座標は書かれない。
const grown = applyEdit(OUTSIDE, addNode(outside, OUTSIDE,
  { shape: 'rect', text: '', part: 'textbox', into: { container: 'frame', after: 'a' } }));
check('dgm §3 L2', '足した部品は選んだものの次に入る', grown.includes('{ a ; part1 ; b }'),
  (/\{ a[^}]*\}/.exec(grown) ?? [''])[0]);
check('dgm §3 L2', '入れ物に足しても座標は増えない',
  (grown.match(/@ \(/g) ?? []).length === (OUTSIDE.match(/@ \(/g) ?? []).length);

// §3.5 部品を変える
const WRITTEN = ['use "default"', '', 'free {', '  dept select:"情報システム部"', '}',
  'layout {', '  dept @ (0, 0)', '}'].join(NL);
const written = parseDiagram(WRITTEN);
check('dgm §3.5', '部品を変えるのは名前 1 つの書き換え',
  applyEdit(WRITTEN, setNodePart(written, WRITTEN, 'dept', 'checkbox'))
    .includes('  dept checkbox:"情報システム部"'));
check('dgm §3.5', '部品でない図形は部品になる',
  applyEdit(WRITTEN.replace('dept select:"情報システム部"', 'dept [情報システム部]'),
    setNodePart(parseDiagram(WRITTEN.replace('dept select:"情報システム部"', 'dept [情報システム部]')),
      WRITTEN.replace('dept select:"情報システム部"', 'dept [情報システム部]'), 'dept', 'textbox'))
    .includes('dept textbox:"情報システム部"'));
check('dgm §3.5', '図形の種類を変えると部品ではなくなる、と言う',
  setNodeShape(written, 'dept', 'ellipse').description === '部品をやめて図形にする',
  setNodeShape(written, 'dept', 'ellipse').description);
const reachable = withParts(written, () => undefined);
check('dgm §3.5', '選べる部品は使っているライブラリが決める',
  reachable.library.size > 20 && reachable.library.has('textbox'),
  `${reachable.library.size} 個`);
check('dgm §3.5', 'ライブラリの見出しがそのまま区分になる',
  reachable.library.get('textbox')?.group === '入力'
  && reachable.library.get('primary')?.group === 'ボタン',
  `${reachable.library.get('textbox')?.group} / ${reachable.library.get('primary')?.group}`);

// §3 L2 入れ物の中での並べ替え
const heldDrop = dgm('free {', '  frame [ ]', '  a [あ]', '  b [い]', '  c [う]', '}',
  'layout {', '  frame @ (0, 0) 300x400',
  '  stack frame (down; gap: 10; pad: 10) { a ; b ; c }', '}');
const heldLaid = layOutDiagram(heldDrop);
const onA = heldLaid.boxes.get('a');
const landed = dropInto(heldDrop.containers.get('frame'), heldLaid.boxes.get('frame'),
  id => heldLaid.boxes.get(id), 'c', { x: onA.x + 5, y: onA.y + 2 });
check('dgm §3 L2', '入れ物の中で落とすと並びが変わる',
  JSON.stringify(landed?.cells) === JSON.stringify([['c'], ['a'], ['b']]),
  JSON.stringify(landed?.cells));
check('dgm §3 L2', '落とす先は引いている間に見える（印が出る）',
  landed?.mark !== undefined && landed.mark.height > 0);

// §10.2 行を持つ部品（ツリー・リスト・メニュー）
const listed = dgm('use "default"', '', 'free {', '  nav tree: {',
  '    - マスタ管理', '      - 社員', '      - 部署 *', '    + 伝票', '  }', '}',
  'layout {', '  nav @ (0, 0) 200x240', '}');
check('dgm §10.2', '行は字下げで深さ、* で選択、+ で閉じた枝',
  JSON.stringify(node(listed, 'nav').items.map(one => [one.depth, one.picked, one.closed]))
  === JSON.stringify([[0, false, false], [1, false, false], [1, true, false], [0, false, true]]));
check('dgm §10.2', '行は図形ではない（id を持たない）', listed.nodes.length === 1);
check('dgm §10.2', '図形の範囲は一覧ごと覆う',
  node(listed, 'nav').span.end > node(listed, 'nav').span.start + 20);
const drawnTree = renderDiagram(withParts(listed, () => undefined));
check('dgm §10.2', '行の数だけ描かれる',
  ['マスタ管理', '社員', '部署', '伝票'].every(one => drawnTree.includes(one)));

// 閉じた枝の中身は描かれない。印が「この下にまだある」と言っているので、
// 中身まで見えていたら印が嘘になる。ファイルからは消えない。
const FOLDED = ['use "default"', '', 'free {', '  nav tree: {',
  '    + マスタ管理', '      - 社員', '    - 伝票', '  }', '}',
  'layout {', '  nav @ (0, 0) 200x240', '}'].join(NL);
const folded = parseDiagram(FOLDED);
const drawnFold = renderDiagram(withParts(folded, () => undefined));
check('dgm §10.2', '閉じた枝の中身は描かれない',
  drawnFold.includes('マスタ管理') && !drawnFold.includes('社員')
  && drawnFold.includes('伝票'));
check('dgm §10.2', '描かれなくても行は消えない',
  node(folded, 'nav').items.length === 3);

// 行の場所は 1 か所が決める。絵と GUI が別に計算したら、押せない行が生まれる。
const navBox = layOutDiagram(folded).boxes.get('nav');
const slots = rowBoxes('ui/tree', navBox, node(folded, 'nav').items);
check('dgm §10.2', '行の場所は行番号で引ける（描かれない行は無い）',
  slots.length === 3 && slots[0] !== undefined && slots[1] === undefined
  && slots[2] !== undefined);
check('dgm §10.2', '閉じた枝の次の行は、その真下に来る',
  slots[2].y - slots[0].y === 22, `${slots[2].y - slots[0].y}`);
check('dgm §10.2', '文字の口は行の中、深さのぶん右から始まる',
  rowTextAt('ui/tree', navBox, node(folded, 'nav').items, 2).x > slots[2].x);

// GUI の 1 操作 ＝ 1 つのバイト範囲。行に id は無いので、範囲は一覧ごとである。
const rowEdit = setItems(folded, FOLDED, 'nav', [
  ...node(folded, 'nav').items.slice(0, 1),
  { text: '社員名簿', depth: 1, closed: false, picked: false },
  ...node(folded, 'nav').items.slice(2),
]);
check('dgm §10.2', '行を変えるのは一覧ごとの 1 つのバイト範囲',
  rowEdit.description === '一覧を変える'
  && rowEdit.span.start >= node(folded, 'nav').span.start
  && rowEdit.span.end <= node(folded, 'nav').span.end,
  `${rowEdit.span.start}〜${rowEdit.span.end}`);
check('dgm §10.2', '書き換わるのはその一覧だけ',
  applyEdit(FOLDED, rowEdit).includes('      - 社員名簿' + NL + '    - 伝票')
  && applyEdit(FOLDED, rowEdit).includes('  nav @ (0, 0) 200x240'),
  applyEdit(FOLDED, rowEdit).split(NL).slice(3, 8).join(' / '));

// §10.1 単独の線
const lone = (written, style = '') => {
  const file = dgm('free {', `  rule1 ${written}`, '}',
    'layout {', '  rule1 @ (0, 0) 100x40', '}',
    ...(style === '' ? [] : ['style {', `  rule1 { ${style} }`, '}']));
  return { file, node: node(file, 'rule1') };
};
check('dgm §10.1', '`--` は単独の線', lone('--').node?.shape === 'line');
check('dgm §10.1', 'ハイフンは 3 つ以上でもよい', lone('---').node?.shape === 'line');
check('dgm §10.1', '単独の線は接続ではない', lone('--').file.edges.length === 0);
check('dgm §10.1', '線は文字を持たない', lone('--').node?.text === '');
check('dgm §10.1', '箱の対角線として引かれる',
  renderDiagram(lone('--').file).includes('L 116 56'),
  (/<path d="[^"]*"/.exec(renderDiagram(lone('--').file)) ?? [''])[0]);
check('dgm §10.1', 'slope で対角線を選べる',
  renderDiagram(lone('--', 'slope: up').file).includes('M 16 56 L 116 16'));
check('dgm §10.1', 'arrow は端に矢じりを出す',
  (renderDiagram(lone('--', 'arrow: both').file).match(/dp-arrow/g) ?? []).length === 2);
check('dgm §10.1', 'weight は class ではなく変数で渡す',
  renderDiagram(lone('--', 'weight: 2').file).includes('--dp-weight:2'));
check('dgm §10.1', '線だけが arrow を持つ',
  diagramDiagnostics(dgm('free {', '  a [x]', '}', 'layout {', '  a @ (0,0)', '}',
    'style {', '  a { arrow: end }', '}')).join(' ').includes('線だけが'));

// §2 identifiers
check('dgm §2', '仮名・漢字は識別子に使える',
  node(dgm('free {', '   会員DB [x]', '}'), '会員DB') !== undefined);
check('dgm §2', '全角英数は識別子ではない',
  refuses(parseDiagram, 'free {' + NL + '  ＡＢ [x]' + NL + '}') !== undefined);

// §3.3 groups
const grouped = dgm('free {', '  a [x]', '  b [y]', '  group g "G" { a; b }', '}');
check('dgm §3.3', 'グループの成員は ; 区切り',
  node(grouped, 'g')?.children.join(',') === 'a,b', node(grouped, 'g')?.children.join(','));

// §4.1 pins
const pinned = dgm('free {', '  a [x]', '  b [y]', '}',
  'layout {', '  a @ (-40, 120) 140x60 z:-1', '  b @ (10, 20)', '}');
const pinA = pinned.layout.get('a');
check('dgm §4.1', '座標・寸法・z を読む（負の値も）',
  pinA?.x === -40 && pinA?.y === 120 && pinA?.width === 140 && pinA?.height === 60 && pinA?.z === -1,
  JSON.stringify(pinA && { x: pinA.x, y: pinA.y, w: pinA.width, h: pinA.height, z: pinA.z }));
check('dgm §4.1', '寸法と z は省略できる',
  pinned.layout.get('b')?.width === undefined && pinned.layout.get('b')?.z === undefined);
check('dgm §4.1', '読めない配置行はエラー',
  refuses(parseDiagram, ['free {', '  a [x]', '}', 'layout {', '  a @ 40,120', '}'].join(NL)) !== undefined);

// §4.1 stacking: equal z falls back to declaration order
const stacked = layOutDiagram(dgm('free {', '  first [x]', '  second [y]', '}',
  'layout {', '  first @ (0, 0)', '  second @ (0, 0)', '}'));
check('dgm §4.1', '同じ z なら宣言順に前後が決まる',
  stacked.order.join(',') === 'first,second', stacked.order.join(','));

// §4.3 bends
const bent = dgm('free {', '  a [x]', '  b [y]', '  a -> b', '}',
  'layout {', '  a --> b @ (600, 120); (600, 240)', '}');
check('dgm §4.3', '折れ点は端点の組で引ける（コネクタは問わない）',
  bent.bends.get('a->b')?.points.length === 2);
check('dgm §4.3', '折れ点が無い折れ線行はエラー',
  refuses(parseDiagram, ['free {', '  a [x]', '  b [y]', '  a -> b', '}',
    'layout {', '  a -> b @ ', '}'].join(NL)) !== undefined);

// §3.2 / §4.3 / §4.4 — diagnostics, not errors
const dangling = layOutDiagram(dgm('free {', '  a [x]', '  a -> missing', '}',
  'layout {', '  a @ (0, 0)', '}'));
check('dgm §3.2', '行き先の無い接続は診断（エラーにしない）',
  dangling.diagnostics.some(d => d.includes('missing')), dangling.diagnostics.join(' / '));
const orphan = layOutDiagram(dgm('free {', '  a [x]', '  b [y]', '}',
  'layout {', '  a @ (0, 0)', '  b @ (0, 80)', '  a -> b @ (40, 40)', '}'));
check('dgm §4.3', '存在しない接続の折れ点は診断',
  orphan.diagnostics.some(d => d.includes('a->b')), orphan.diagnostics.join(' / '));
const unpinned = layOutDiagram(dgm('free {', '  a [x]', '  b [y]', '}', 'layout {', '  a @ (0, 0)', '}'));
check('dgm §4.4', 'free でピンの無い図形は診断され、なお見える位置に置かれる',
  unpinned.diagnostics.length > 0 && unpinned.boxes.has('b'),
  unpinned.diagnostics.join(' / '));
const computed = layOutDiagram(dgm('flow {', '  a [x]', '  b [y]', '  a --> b', '}'));
check('dgm §4.4', 'flow はピンの無い図形の位置を計算する',
  computed.boxes.size === 2 && computed.diagnostics.length === 0);
// The renderer shifts the whole drawing to fit the canvas, so a pin is checked
// by the distance it puts between the two shapes, not by an absolute value.
const overridden = layOutDiagram(dgm('flow {', '  a [x]', '  b [y]', '  a --> b', '}',
  'layout {', '  b @ (500, 900)', '}'));
const apart = overridden.boxes.get('b').y - overridden.boxes.get('a').y;
check('dgm §4.1', 'flow でもピンは計算に勝つ', apart > 400, `縦に ${apart} 離れている`);

// §7 style
const styled = dgm('free {', '  a [x]', '}',
  'style {', '  theme: grid', '  a { fill: #e3f2fd; line: dashed }', '  ??? nonsense', '}');
check('dgm §7.1', 'theme を読む', styled.theme === 'grid');
check('dgm §7.3', '色とトークンを同じ規則で持つ',
  styled.style.get('a')?.get('fill') === '#e3f2fd' && styled.style.get('a')?.get('line') === 'dashed');
check('dgm §7.2', '読めないスタイル行は無視する（エラーにしない）', styled.style.size === 1);

// §5 overlay
const overlay = dgm('overlay "../assets/login.png" {', '  ① @ (168, 126) -> (188, 132) "ログイン ID"', '}');
check('dgm §5', 'overlay は画像のパスと注釈を持つ',
  overlay.image === '../assets/login.png' && overlay.callouts[0]?.text === 'ログイン ID');
check('dgm §5', 'overlay に画像のパスが無ければエラー',
  refuses(parseDiagram, 'overlay {' + NL + '}') !== undefined);

// §6.1 every entity carries the byte range of its own line
const source = ['free {', '  a [x]', '}'].join(NL);
const buffer = Buffer.from(source, 'utf8');
const span = parseDiagram(source).nodes[0].span;
check('dgm §6.1', '図形は自分の行のバイト範囲を持つ',
  buffer.slice(span.start, span.end).toString('utf8') === 'a [x]',
  JSON.stringify(buffer.slice(span.start, span.end).toString('utf8')));
const wide = ['free {', '  会員 [データベース]', '}'].join(NL);
const wideSpan = parseDiagram(wide).nodes[0].span;
check('README §6', 'バイト範囲は UTF-8 のバイトで数える',
  Buffer.from(wide, 'utf8').slice(wideSpan.start, wideSpan.end).toString('utf8') === '会員 [データベース]');

// §2 identifiers: no hyphen
const unspaced = parseDiagram(['flow {', '  a [A]', '  b [B]', '  a-->b', '}'].join(NL));
check('dgm §2', '空白なしの a-->b は a から b への接続', unspaced.edges[0]?.from === 'a' && unspaced.edges[0]?.to === 'b',
  JSON.stringify(unspaced.edges.map(e => [e.from, e.to])));
for (const [what, text] of [
  ['図形', ['free {', '  db-primary [DB]', '}']],
  ['接続の終点', ['flow {', '  a --> b-c', '}']],
  ['グループのメンバー', ['free {', '  group g { a; b-c }', '}']],
  ['ピン', ['free {', '  a [A]', '}', 'layout {', '  a-b @ (0, 0)', '}']],
  ['スタイルの規則', ['free {', '  a [A]', '}', 'style {', '  a-b { fill: #fff }', '}']],
]) {
  check('dgm §2', `${what}の id にハイフンがあればエラー`, /hyphen|ハイフン/.test(refuses(parseDiagram, text.join(NL)) ?? ''));
}
check('dgm §2', '部品の名前にはハイフンを使える',
  parseDiagram(['use "icons"', 'free {', '  r net-router:', '}'].join(NL)).partOf.get('r') === 'net-router');

// §6.3 canonical form
const formatted = text => formatDiagram(text).text;
const typedOne = ['flow {', '  b [B]', '  a [A]', '  a -> b', '}', 'style {', '  b {line:dashed}', '}'].join(NL);
const typedTwo = ['style {', '  b { line: dashed }', '}', 'flow {', '  a[A]', '  a --> b', '  b[B]', '}'].join(NL);
check('dgm §6.3', '同じ図を別の順で書いても、整形すれば同じ文になる', formatted(typedOne) === formatted(typedTwo));
check('dgm §6.3', '整形し直しても変わらない', formatted(formatted(typedOne)) === formatted(typedOne));
check('dgm §6.3', '節は本体・layout・style の順、接続記号は --> に揃う',
  formatted(typedOne) === ['flow {', '  a [A]', '  b [B]', '', '  a --> b', '}', '', 'style {', '  b { line: dashed }', '}', ''].join(NL),
  JSON.stringify(formatted(typedOne)));
const twice = ['free {', '  a [A]', '}', 'layout {', '  a @ (0, 0)', '  a @ (10, 0)', '}'].join(NL);
check('dgm §6.3', '同じ名前が 2 度書かれたファイルは整形しない', formatted(twice) === twice);
const behind = ['free {', '  big [Big]', '  small [Small]', '}', 'layout {', '  big @ (0, 40) 200x200', '  small @ (10, 10) 50x50', '}'].join(NL);
const front = layOutDiagram(parseDiagram(formatted(behind))).order;
check('dgm §6.3', '重なった図形は、整形しても手前のものが手前に残る', front.indexOf('big') < front.indexOf('small'));

// ───────────────────────── spec/inline-text.md ─────────────────────────

const runs = text => parseRuns(text);
const only = text => { const r = runs(text); return r.length === 1 ? r[0] : undefined; };

check('inline §2.1', '** は強調', only('**太字**')?.bold === true);
check('inline §2.1', '* は斜体', only('*斜体*')?.italic === true);
check('inline §2.2', '` はコード', only('`code`')?.code === true);
check('inline §2.1', '_ は記号のまま（識別子を壊さない）',
  only('user_id_1')?.italic === false && only('user_id_1')?.text === 'user_id_1');
check('inline §2.3', '相手のいない印は文字そのもの',
  runs('3 * 4').map(r => r.text).join('') === '3 * 4' && runs('3 * 4').every(r => !r.italic));
check('inline §2.5', '\\ は次の 1 文字をそのまま通す',
  runs('\\*not em\\*').map(r => r.text).join('') === '*not em*');
check('inline §2.4', '{color=#rrggbb} は色', only('[x]{color=#c62828}')?.colour === '#c62828');
check('inline §2.4', '3 桁の短縮形も色', only('[x]{color=#c22}')?.colour === '#c22');
check('inline §2.4', '色でない値は文字のまま',
  runs('[x]{color=red}').every(r => r.colour === undefined));
check('inline §3', '入れ子は 1 つの run の性質になる',
  only('**`両方`**')?.bold === true && only('**`両方`**')?.code === true);
check('inline §3', '見える文字だけを数える（折り返しの基準）',
  runs('**Web フロント**').map(r => r.text).join('').length === 'Web フロント'.length);

// ──────────────────────────── spec/table.md ────────────────────────────

const table = (...lines) => parseTable(lines.join(NL));

check('table §1', 'グリッドが 2 行に満たなければエラー',
  refuses(parseTable, '| a |') !== undefined);
check('table §2', '区切り行が正しくなければエラー',
  refuses(parseTable, ['| a |', '| x |'].join(NL)) !== undefined);
check('table §1', 'グリッドのあとの解釈できない行はエラー',
  refuses(parseTable, ['| a |', '|---|', '| 1 |', 'nonsense'].join(NL)) !== undefined);

const t = table('| 分類 | 値 |', '|:-----|---:|', '| 入力 | 1 |', '| ^    | 2 |');
check('table §2.2', '寄せは区切り行のコロンから決まる',
  t.columns[0].align === 'left' && t.columns[1].align === 'right',
  `${t.columns[0].align}/${t.columns[1].align}`);
check('table §2.3', '^ は上のセルの行数を伸ばす', t.rows[0].cells[0].rowspan === 2);
check('table §2.3', '結合された位置にセルは作られない', t.rows[1].cells.length === 1);
check('table §2.3', '位置から覆っているセルを引ける',
  coverAt(t, 1, 0)?.text === '入力', coverAt(t, 1, 0)?.text);
check('table §2.3', '上に何も無い ^ はエラー',
  refuses(parseTable, ['| a |', '|---|', '| ^ |'].join(NL)) !== undefined);
check('table §2.3', '先頭列の < はエラー',
  refuses(parseTable, ['| a | b |', '|---|---|', '| < | 1 |'].join(NL)) !== undefined);

const across = table('| a | b | c |', '|---|---|---|', '| 期間 | < | 備考 |', '| ^ | ^ | x |');
check('table §2.3', '< は列方向に伸ばす', across.rows[0].cells[0].colspan === 2);
check('table §2.3', '複数列にまたがるセルの下の ^ は行数を 1 度だけ伸ばす',
  across.rows[0].cells[0].rowspan === 2, String(across.rows[0].cells[0].rowspan));

check('table §2.1', '\\| は文字としてのパイプ',
  table('| a | b |', '|---|---|', '| x \\| y | 2 |').rows[0].cells[0].text === 'x | y',
  table('| a | b |', '|---|---|', '| x \\| y | 2 |').rows[0].cells[0].text);
check('table §2.1', '末尾のパイプは有っても無くてもよい',
  table('| a | b |', '|---|---|', '| 1 | 2').rows[0].cells.length === 2);
check('table §2.1', '足りないセルは空で埋め、余りは無視する',
  table('| a | b |', '|---|---|', '| 1 |').rows[0].cells[1].text === '' &&
  table('| a | b |', '|---|---|', '| 1 | 2 | 3 |').rows[0].cells.length === 2);

const blocks = table('| a |', '|---|', '| @1 |', '', '[@1]:', '- 一つ目', '- 二つ目', '', 'style {', '}');
check('table §4', 'ブロックは空行まで続き、改行で連結される',
  blocks.blocks.get('1') === ['- 一つ目', '- 二つ目'].join(NL), JSON.stringify(blocks.blocks.get('1')));

const ranged = table('| 用語 | 説明 |', '|------|------|', '| あ | 1 |', '| い | 2 |', '| う | 3 |',
  'range {', '  前半: あ..い', '}',
  'style {', '  theme: grid', '  col:用語 { width: 30% }', '  row:odd { fill: #eee }',
  '  cell:う/説明 { fill: #fdf0d5 }', '  range:前半 { fill: changed }', '  ??? nonsense', '}');
check('table §5', '名前付き範囲は先頭セルの文字で書く',
  ranged.ranges.get('前半')?.from === 'あ' && ranged.ranges.get('前半')?.to === 'い');
check('table §6', 'theme を読む', ranged.theme === 'grid');
check('table §6.2', '読めないスタイル行は無視する（エラーにしない）', ranged.style.length === 4,
  `規則 ${ranged.style.length} 件`);
check('table §6.2', 'col: は見出しの文字で列を選ぶ',
  ranged.style.some(r => r.selector.kind === 'column' && r.selector.name === '用語'));
check('table §6.2', 'row:odd は 1 行目から数える',
  rowRules(ranged, 0).some(r => r.declarations.get('fill') === '#eee') &&
  !rowRules(ranged, 1).some(r => r.declarations.get('fill') === '#eee'));
check('table §6.2', 'range: は名前で行を選ぶ',
  rowRules(ranged, 0).some(r => r.declarations.get('fill') === 'changed') &&
  !rowRules(ranged, 2).some(r => r.declarations.get('fill') === 'changed'));
check('table §3', 'cell: は先頭セルと見出しの文字で 1 つのセルを選ぶ',
  cellRules(ranged, ranged.rows[2].cells[1], 2).some(r => r.declarations.get('fill') === '#fdf0d5'));

const lineSpan = (() => {
  const src = ['| 用語 | 説明 |', '|------|------|', '| 会員 | 登録済みの利用者 |'].join(NL);
  const file = parseTable(src);
  const { start, end } = file.rows[0].line.span;
  return Buffer.from(src, 'utf8').slice(start, end).toString('utf8');
})();
check('table §7.1', '行は自分のバイト範囲を持つ（セルではなく行）',
  lineSpan === '| 会員 | 登録済みの利用者 |', JSON.stringify(lineSpan));

const counted = parseTable(['| 項目 | No |', '|------|---:|', '| ID | # |', '| 補足 | — |', '| 名前 | # |'].join(NL));
check('table §2.4', '# だけのセルは、その列の # の中で何番目かを表す',
  counted.rows.map(row => row.cells[1].number ?? row.cells[1].text).join(',') === '1,—,2');
check('table §2.4', '# のセルの文字は # のまま（番号はファイルに書かれない）',
  counted.rows[2].cells[1].text === '#');

// ───────────────────────── the samples still read ─────────────────────────
import { readFileSync } from 'node:fs';
for (const path of [
  'sample/shared/system-architecture.dgm',
  'sample/docs/auth-design/login-flow.dgm',
  'sample/docs/auth-design/token-lifecycle.dgm',
  'sample/docs/auth-design/login-screen-overlay.dgm',
]) {
  const laid = layOutDiagram(parseDiagram(readFileSync(path, 'utf8')));
  check('spec 全体', `${path} は仕様どおり読める`, laid.diagnostics.length === 0,
    laid.diagnostics.join(' / '));
}
for (const path of ['sample/shared/glossary.table', 'sample/docs/auth-design/screen-items.table']) {
  const read = parseTable(readFileSync(path, 'utf8'));
  check('spec 全体', `${path} は仕様どおり読める`, read.rows.length > 0);
}

console.log(failed === 0 ? '仕様と実装は一致している' : `${failed} 件の食い違い`);
if (failed > 0) process.exitCode = 1;
