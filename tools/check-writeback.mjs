// A deck that comes back edited.
//
// PowerPoint is not available here, so the edits it would make are made to the
// package directly: a shape is moved, a label is retyped, and a shape nobody
// knows about is added. What matters is what reaches the `.dgm` — the two
// edits, as two lines, and a warning for the third — because the promise of
// this path is that someone can fix a drawing in PowerPoint without the file
// losing everything else it says.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeBack } from '../packages/build/dist/index.js';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const root = 'sample';
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push(relative(root, path).split('\\').join('/'));
  }
})(root);
const workspace = {
  list: () => files,
  read: path => {
    try {
      return statSync(join(root, path)).isFile() ? readFileSync(join(root, path), 'utf8') : undefined;
    } catch { return undefined; }
  },
};

const original = new Uint8Array(readFileSync('out/build/docs/auth-overview.pptx'));
const untouched = writeBack(original, workspace);
check('触っていないデッキは何も変えない',
  untouched.files.length > 0 && untouched.files.every(file => file.text === file.source),
  untouched.files.map(f => `${f.path}:${f.changes.length}`).join(' '));

// --- PowerPoint でされたであろう編集を、包みに直接加える ---------------------
const parts = unzipSync(original);
const slideName = Object.keys(parts).find(name =>
  /^ppt\/slides\/slide\d+\.xml$/.test(name)
  && strFromU8(parts[name]).includes('system-architecture.dgm'));
check('構成図のスライドが見つかる', slideName !== undefined, slideName ?? '');

let slide = strFromU8(parts[slideName]);
const scale = Number(/scale=([\d.]+)/.exec(slide)[1]);

/** The EMU a shape sits at, and where it would sit after moving `dx` pixels. */
const shapeOf = (xml, id) => {
  const at = xml.indexOf(`name="${id}"`);
  const from = xml.lastIndexOf('<p:sp>', at);
  const to = xml.indexOf('</p:sp>', at) + '</p:sp>'.length;
  return { from, to, body: xml.slice(from, to) };
};

// 1. 「認証 API」を右に 80px ぶん動かす
const api = shapeOf(slide, 'api');
const moved = api.body.replace(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/,
  (_, x, y) => `<a:off x="${Math.round(Number(x) + 80 * scale)}" y="${y}"/>`);
slide = slide.slice(0, api.from) + moved + slide.slice(api.to);

// 2. 「会員 DB」のラベルを打ち直す
const db = shapeOf(slide, 'db');
const retyped = db.body.replace(/<a:t>[^<]*<\/a:t>/, '<a:t>会員データベース</a:t>');
slide = slide.slice(0, db.from) + retyped + slide.slice(db.to);

// 3. PowerPoint で足された図形（こちらは知らない）
slide = slide.replace('</p:spTree>',
  '<p:sp><p:nvSpPr><p:cNvPr id="900" name="ghost"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="500000" cy="300000"/></a:xfrm>'
  + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP"/><a:t>あとから足した</a:t></a:r></a:p></p:txBody>'
  + '</p:sp></p:spTree>');

parts[slideName] = strToU8(slide);
const edited = zipSync(parts);

// --- 読み戻す ---------------------------------------------------------------
const result = writeBack(edited, workspace);
const file = result.files.find(one => one.path === 'shared/system-architecture.dgm');
check('図が特定できる', file !== undefined);

const before = file.source.split('\n');
const after = file.text.split('\n');
const changed = after.filter((line, i) => line !== before[i]);
check('変わった行は 2 つだけ', changed.length === 2, changed.map(l => l.trim()).join(' / '));

/** A line inside the layout block, where the pins are. */
const pinLine = (text, id) => {
  const from = text.indexOf('layout {');
  return text.slice(from, text.indexOf('}', from)).split('\n')
    .find(one => one.trim().startsWith(id + ' ')) ?? '';
};
check('動かした図形の位置が書き戻る', /api\s+@ \(\s*540,\s*120\)/.test(pinLine(file.text, 'api')),
  pinLine(file.text, 'api').trim());
check('打ち直した文字が書き戻る',
  after.some(one => one.trim().startsWith('db') && one.includes('[(会員データベース)]')),
  after.find(one => one.includes('会員データベース')) ?? '');
check('桁揃えは保たれる',
  after.find(one => one.includes('会員データベース')).indexOf('[')
    === before.find(one => one.includes('会員 DB')).indexOf('['),
  after.find(one => one.includes('会員データベース')));
check('動かしていない図形は触らない',
  pinLine(file.text, 'web') === pinLine(file.source, 'web'),
  pinLine(file.text, 'web').trim());
check('何をしたか言える', file.changes.length === 2, file.changes.join(' / '));

check('知らない図形は警告になる',
  result.diagnostics.some(d => d.message.includes('ghost')),
  result.diagnostics.map(d => d.message).join(' / '));
check('知らない図形で書き戻しは止まらない', file.text !== file.source);

// 書き戻した結果がそのまま読める（壊れていない）
const { parseDiagram } = await import('../packages/diagram/dist/index.js');
let reparsed;
try { reparsed = parseDiagram(file.text); } catch (error) { reparsed = undefined; console.log(error.message); }
check('書き戻した図が読める', reparsed !== undefined);
check('図形の数は変わらない',
  reparsed && reparsed.nodes.length === parseDiagram(file.source).nodes.length);
