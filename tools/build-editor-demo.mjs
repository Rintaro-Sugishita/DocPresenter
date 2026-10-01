// Builds a standalone page that runs the editor against the sample document,
// so the sheet tabs can be used rather than only described. Everything the
// document references is inlined, because a browser has no file system.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { rolldown } from 'rolldown';
import { createSubsetter } from '../packages/pdf/dist/index.js';

const DOC = 'sample/docs/auth-design.md';
const base = dirname(DOC);

// サンプルが参照しうるファイルを丸ごと集める（相対パスで引ける形にする）。
const files = {};
const images = {};
const collect = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { collect(path); continue; }
    if (/\.(dgm|table|ermlx|mmd|md)$/i.test(entry.name)) {
      files[relative('sample', path)] = readFileSync(path, 'utf8');
    }
    // 画像も抱えて持つ。ブラウザにファイルシステムは無いので、
    // 相対パスのままでは画面にも PDF にも出ない。
    const image = /\.(png|jpe?g|gif)$/i.exec(entry.name);
    if (image) {
      const type = image[1].toLowerCase() === 'jpg' ? 'jpeg' : image[1].toLowerCase();
      images[relative('sample', path)] =
        `data:image/${type};base64,${readFileSync(path).toString('base64')}`;
    }
  }
};
collect('sample');

// --- 同梱するフォント -------------------------------------------------------
//
// 画面から PDF を出すには、フォントを埋め込まなければならない。Noto CJK は
// 1 面 20 MB 前後あり、ブラウザに丸ごと取りに行かせるのは現実的ではないので、
// **この標本に出る字だけ**に削ったものをページに持たせる（案 A）。
// 範囲外の字は書き出しのときに欠字として報告される——黙って消えはしない。
const NOTO = '/usr/share/fonts/opentype/noto';
const FACES = {
  // 本文は見出しと同じゴシック（テーマの --font-body）。同じ面を二度持たせる
  // 必要はないので、下の書き出しでは名前ごとに 1 つだけ削って抱える。
  body:        { file: `${NOTO}/NotoSansCJK-Regular.ttc`,  index: 0, name: 'NotoSansCJKjp-Regular' },
  bodyBold:    { file: `${NOTO}/NotoSansCJK-Bold.ttc`,     index: 0, name: 'NotoSansCJKjp-Bold' },
  heading:     { file: `${NOTO}/NotoSansCJK-Regular.ttc`,  index: 0, name: 'NotoSansCJKjp-Regular' },
  headingBold: { file: `${NOTO}/NotoSansCJK-Bold.ttc`,     index: 0, name: 'NotoSansCJKjp-Bold' },
  mono:        { file: `${NOTO}/NotoSansCJK-Regular.ttc`,  index: 5, name: 'NotoSansMonoCJKjp-Regular' },
};
const FALLBACK = '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf';

/** 標本に出る字と、レンダラが足す字。後者は文書のどこにも書かれていない。 */
const characters = new Set();
for (const text of Object.values(files)) for (const c of text) characters.add(c.codePointAt(0));
for (const c of [
  ...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  ...' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  ...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん',
  ...'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉっゃゅょゎ',
  ...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン',
  ...'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポァィゥェォッャュョヴー',
  ...'。、「」『』（）［］〈〉…‥・々〆〇※§¶←→↑↓±×÷≒≠≦≧　',
  ...'図表版ページ続追加削除変更文書番号状態作成更新改訂履歴目次日時分秒年月',
  ...'①②③④⑤⑥⑦⑧⑨⑩○●△▲□■◇◆☆★', ...'−–—～〜',
]) characters.add(c.codePointAt(0));

const subsetter = await createSubsetter(
  readFileSync(createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
const read = path => { try { return new Uint8Array(readFileSync(path)); } catch { return undefined; } };
// 面は「名前」で数える。本文と見出しが同じ家族なら、削るのもページが抱えるのも
// 1 つで済む——styles が面を指し、faces がその中身を持つ。
const fonts = { faces: {}, styles: {} };
let fontBytes = 0;
for (const [style, face] of Object.entries(FACES)) {
  fonts.styles[style] = face.name;
  if (fonts.faces[face.name] !== undefined) continue;
  const source = read(face.file) ?? read(FALLBACK);
  if (!source) throw new Error('埋め込むフォントが見つからない');
  const cut = subsetter(source, characters, read(face.file) ? face.index : 0);
  fontBytes += cut.length;
  fonts.faces[face.name] = Buffer.from(cut).toString('base64');
}
const faceCount = Object.keys(fonts.faces).length;
console.log(`フォント ${characters.size} 字 → ${(fontBytes / 1024).toFixed(0)} KB（${faceCount} 面）`);

const entry = `
const ASSETS = ${JSON.stringify(resolve(base))};
const FONTS = ${JSON.stringify(fonts)};

import { joinPath, parseDocument, resolveDocument } from '@docpresenter/markdown';
import { prepare, takeIn } from '@docpresenter/build';
import { renderDocument } from '@docpresenter/markdown';
import { renderPage } from '@docpresenter/build';
import { measure, writePdf } from '@docpresenter/pdf';
import { COMMIT_KEYS, COMMIT_KEY_LABEL, DEFAULT_SETTINGS, mountSheetView } from '@docpresenter/editor';

const FILES = ${JSON.stringify(files)};
const IMAGES = ${JSON.stringify(images)};
const ROOT = 'docs/auth-design.md';

// 器はファイルを**作業場からの相対**で持つ——ビルドが見ているのと同じ形である。
// 文書の中に書かれるパスは文書からの相対なので、境目で言い換える。この 2 つが
// 同じものを指しているあいだ、画面の図も、書き出した PDF の目次も揃う。
const clean = path => (path.startsWith('./') ? path.slice(2) : path);
const inWorkspace = path => joinPath(ROOT, clean(path));
const inDocument = path =>
  path.startsWith('docs/') ? path.slice('docs/'.length) : '../' + path;

const loader = {
  read: p => FILES[inWorkspace(p)],
  // 画面では web 上の画像をそのまま指してよい。配る成果物とは立場が違う——
  // ここは編集中の画面であって、誰かに渡したファイルではない。
  url: p => (p.startsWith('http://') || p.startsWith('https://')
    ? p
    : IMAGES[inWorkspace(p)]),
};

const render = source => {
  const doc = parseDocument(source);
  return renderDocument(doc, resolveDocument(doc), { loader });
};

const status = document.getElementById('status');
const say = (text, kind) => { status.textContent = text; status.dataset.kind = kind; };

// 設定は「値」であって画面ではない。器（ここでは Web シェル）が持ち、
// エディタは受け取るだけにする。VS Code では settings.json がこの役をする。
const KEY = 'docpresenter.commitKey';
const stored = (() => {
  try { return localStorage.getItem(KEY); } catch { return null; }
})();
let settings = {
  ...DEFAULT_SETTINGS,
  commitKey: COMMIT_KEYS.includes(stored) ? stored : DEFAULT_SETTINGS.commitKey,
};

// 新しい図表のファイルは、文書と同じ名前のフォルダに置く（docs/<文書名>/ の約束）。
const NL = String.fromCharCode(10);
let made = 0;
const STARTER = {
  table: ['| 見出し 1 | 見出し 2 |', '| -------- | -------- |', '|          |          |', ''].join(NL),
  diagram: ['free {', '  a [ここに図形]', '}', '', 'layout {', '  a @ (40, 40) 160x60', '}', ''].join(NL),
};
const createResource = kind => {
  made += 1;
  const path = 'auth-design/' + (kind === 'table' ? 'table-' : 'diagram-')
    + made + (kind === 'table' ? '.table' : '.dgm');
  return { path, text: STARTER[kind] };
};

const view = mountSheetView({
  root: document.getElementById('editor'),
  source: ${JSON.stringify(readFileSync(DOC, "utf8"))},
  render,
  settings,
  readResource: p => FILES[inWorkspace(p)],
  createImage,
  createResource,
  // すでにあるものの一覧。どのファイルが在るかは器が知っている。
  // 差し込まれるのは文書に書かれる形、つまり文書からの相対パスである。
  listResources: () => Object.keys(FILES)
    .filter(path => /\.(dgm|table|mmd|ermlx)$/i.test(path))
    .sort((a, b) => Number(a.includes('shared')) - Number(b.includes('shared')) || a.localeCompare(b))
    .map(path => ({ path: inDocument(path), label: inDocument(path) })),
  onChange: (edit, text) => {
    if (edit.path === undefined) document.getElementById('source').textContent = text;
    else FILES[inWorkspace(edit.path)] = text;
    const where = edit.path === undefined ? '' : edit.path + ' の ';
    say(where + edit.description + '　' + edit.span.start + '〜' + edit.span.end + ' バイトを書き換え', 'ok');
  },
  onError: message => say(message, 'refused'),
});
document.getElementById('source').textContent = view.source;

const side = document.getElementById('side');
const toggle = document.getElementById('toggle-source');
const narrow = window.matchMedia('(max-width: 820px)');
const applyWidth = () => { side.hidden = narrow.matches && toggle.getAttribute('aria-expanded') !== 'true'; };
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!open));
  toggle.textContent = open ? 'ソースを見る' : 'ソースを閉じる';
  applyWidth();
});
narrow.addEventListener('change', applyWidth);
applyWidth();

// --- 画面のフォント ---------------------------------------------------------
//
// テーマは Noto を名指しするが、それは**入っている環境の話**である。入って
// いなければブラウザは総称に落ち、10.5pt の本文が別の字面になる。PDF のために
// 削ったものが手元にあるのだから、画面にもそれを使う。外へ取りに行かないまま、
// 紙とまったく同じ字面になる。
const FAMILY = {
  body: 'DocPresenter Sans', bodyBold: 'DocPresenter Sans',
  heading: 'DocPresenter Sans', headingBold: 'DocPresenter Sans',
  mono: 'DocPresenter Mono',
};
// @font-face は「家族と太さ」で 1 つ。本文と見出しが同じ家族なら同じ 1 枚を指す。
const blocks = new Map();
for (const style of Object.keys(FONTS.styles)) {
  const family = FAMILY[style];
  const weight = style.endsWith('Bold') ? 700 : 400;
  blocks.set(family + '/' + weight, { family, weight, face: FONTS.styles[style] });
}
const faces = document.createElement('style');
faces.textContent = [...blocks.values()].map(block => [
  '@font-face {',
  '  font-family: "' + block.family + '";',
  '  font-weight: ' + block.weight + ';',
  '  src: url(data:font/otf;base64,' + FONTS.faces[block.face] + ') format("opentype");',
  '  font-display: block;',
  '}',
].join(NL)).join(NL)
  // 同梱したのは標本に出る字だけ。範囲外の字は手元のフォントに落ちる。
  + NL + ':root {' + NL
  + '  --font-body: "DocPresenter Sans", "Noto Sans CJK JP", sans-serif;' + NL
  + '  --font-heading: "DocPresenter Sans", "Noto Sans CJK JP", sans-serif;' + NL
  + '  --font-mono: "DocPresenter Mono", "Noto Sans Mono CJK JP", monospace;' + NL
  + '}';
document.head.append(faces);

// --- PDF -------------------------------------------------------------------
//
// 組版はブラウザがやり、PDF はこちらが書く——という [PDF エンジン] の筋道は、
// CLI と同じものがそのままここで動く。器が違うのはフォントの出どころだけで、
// このページは削ったものを最初から抱えている。
const decode = base64 => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const decoded = new Map();
const faceBytes = name => {
  if (!decoded.has(name)) decoded.set(name, decode(FONTS.faces[name]));
  return decoded.get(name);
};
const FONT_SET = Object.fromEntries(Object.entries(FONTS.styles).map(([style, name]) => [
  style, { bytes: faceBytes(name), name },
]));
// すでに削ってある。pdf-lib 内蔵のサブセッタは CFF を壊すので、通さない。
const alreadyCut = bytes => bytes;

const workspace = {
  list: () => Object.keys({ ...FILES, ...IMAGES }),
  read: p => FILES[clean(p)],
  dataUrl: p => IMAGES[clean(p)],
  // 文書が web 上の画像を指しているときだけ、押された瞬間に取りに行く。ページが
  // 自分の持ち物を外から取ってくるわけではない——取りに行くのは**著者が住所で
  // 書いたものだけ**で、取れるかどうかは相手のサーバ（CORS）が決める。
  async inline(address) {
    try {
      const response = await fetch(address, { mode: 'cors' });
      if (!response.ok) return undefined;
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) return undefined;
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(undefined);
        reader.readAsDataURL(blob);
      });
    } catch { return undefined; }
  },
};

// --- 持ち込まれた画像 -------------------------------------------------------
//
// 作業フォルダに**すでにあるものなら、それを指す**。同じ絵を 2 枚持っても、
// 文書が重くなるだけで誰も得をしない。無ければ新しく置く——置き場は
// 「その文書専用のフォルダ」で、これはパスが共有物かどうかを表すという決定の
// とおりである。ここはデモなので、置き場はこのページの中の IMAGES である。
const KIND = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const base64Of = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
let pasted = 0;
// 宣言で書く——エディタを組み立てるのはこれより前で、const では間に合わない。
function createImage(picture) {
  const extension = KIND[picture.type];
  if (!extension) return undefined;
  const data = 'data:' + picture.type + ';base64,' + base64Of(picture.bytes);
  // 同じ中身のものが在れば、それを指す。
  for (const [path, held] of Object.entries(IMAGES)) {
    if (held === data) return { path: inDocument(path) };
  }
  pasted += 1;
  // 生成コードはテンプレートリテラルの中にある。\\w と書かないと w になる。
  const name = (picture.name || 'image-' + pasted).replace(/[^\\w.-]/g, '-');
  const path = 'docs/auth-design/' + (name.endsWith('.' + extension) ? name : name + '.' + extension);
  IMAGES[path] = data;
  return { path: inDocument(path) };
}


// 出来上がったものを渡す。渡し方は器による——アーティファクトの枠は、中の
// コードが勝手に保存するのを止める。そこでは器に「保存してよいか」を聞いて
// もらう（downloads）。単体の HTML として開いたときは、これまでどおり自分で
// 保存する。どちらでも押したぶんは届く。
const deliver = async (name, bytes) => {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const shell = window.claude && window.claude.use
    ? await window.claude.use('downloads').catch(() => null)
    : null;
  if (shell) {
    try {
      await shell.save({ filename: name, data: blob });
      return '保存しました';
    } catch (error) {
      const code = error && error.code;
      if (code === 'declined') return '保存はしていません';
      // 器が保存を扱えないなら、こちらで保存しても同じように止められる。
      // 黙って何も起きないより、なぜ渡せないかを言う（P6）。
      return '保存できませんでした（' + (code || 'unknown') + '）';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'ダウンロードしました';
};

const pdfButton = document.getElementById('make-pdf');
pdfButton.addEventListener('click', async () => {
  pdfButton.disabled = true;
  say('PDF を組んでいます…', 'ok');
  // 画面の外に、印刷される姿のまま組ませる。編集画面には触らない。
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute; left:-20000px; top:0; width:800px;';
  try {
    const source = view.source;
    // 書き出しは CLI と同じ支度をする。取り込んだ文書を畳んでおかないと、採番も
    // 目次もしおりも、取り込んだ節をただ知らないまま出来上がる。
    const ready = prepare(workspace, { path: ROOT, document: parseDocument(source), formats: ['pdf'] });
    const doc = ready.document;
    // web 上の画像は、ここで一度だけ取り込む。CLI のビルドと同じ段取りである。
    const trouble = [];
    const inlined = await takeIn(workspace, ready, trouble);
    const page = renderPage({
      workspace,
      document: doc,
      resolved: ready.resolved,
      inlined,
      style: '',                       // テーマはページに読み込まれているものを使う
      root: ROOT,
    });
    // 器（このページ）には既にテーマが読み込まれているので、本文だけを取り出す。
    const open = page.indexOf('<body>') + '<body>'.length;
    stage.innerHTML = page.slice(open, page.lastIndexOf('</body>'));
    document.body.append(stage);

    const raw = doc.frontmatter.raw;
    const foot = [raw.document, raw.version && ('版 ' + raw.version)].filter(Boolean).join('　');
    const measured = measure(stage, { foot, title: String(raw.title ?? '') });
    const { bytes, missing } = await writePdf(measured.plan, { fonts: FONT_SET, subset: alreadyCut });

    const handed = await deliver((raw.document ?? 'document') + '.pdf', bytes);

    // P6: 出せなかった字は黙って消さない。同梱したのは標本のぶんだけである。
    const lost = [...new Set(missing.map(one => one.character))].join('');
    const unfetched = trouble.map(one => one.message).join('　');
    say(measured.plan.pages.length + ' ページの PDF を作って' + handed
      + (lost ? '　同梱フォントに無い字: ' + lost : '')
      + (unfetched ? '　' + unfetched : ''), lost || unfetched ? 'refused' : 'ok');
  } catch (error) {
    say('PDF を作れませんでした: ' + error.message, 'refused');
  } finally {
    stage.remove();
    pdfButton.disabled = false;
  }
});

const select = document.getElementById('commit-key');
for (const key of COMMIT_KEYS) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = COMMIT_KEY_LABEL[key];
  select.append(option);
}
select.value = settings.commitKey;
select.addEventListener('change', () => {
  settings = { ...settings, commitKey: select.value };
  view.configure(settings);
  try { localStorage.setItem(KEY, select.value); } catch { /* 使えなくても動く */ }
});
`;

mkdirSync('out', { recursive: true });
writeFileSync('out/editor-entry.js', entry);

const bundle = await rolldown({ input: 'out/editor-entry.js', platform: 'browser' });
await bundle.write({ file: 'out/editor.js', format: 'iife' });

writeFileSync('out/editor.html', `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<title>DocPresenter — シート編集</title>
<link rel="stylesheet" href="../themes/default/theme.css">
<style>
  html, body { height: 100%; margin: 0; }
  body { max-width: none; display: grid; grid-template-columns: 1fr 22em; font-size: 10.5pt; }
  #editor { min-height: 0; }
  aside {
    border-left: 1px solid #c8ccd2; background: #fbfbfc;
    display: flex; flex-direction: column; min-height: 0;
    font-family: system-ui, sans-serif; font-size: 12px;
  }
  aside h2 { font-size: 12px; margin: 0; padding: 0.8em 1em; border-bottom: 1px solid #e2e4e8; }
  #status { padding: 0.8em 1em; color: #1f5fa8; border-bottom: 1px solid #e2e4e8; min-height: 1.4em; }
  #status[data-kind="refused"] { color: #b3261e; }
  .setting { display: block; padding: 0.8em 1em; border-bottom: 1px solid #e2e4e8; color: #5a6270; }
  .setting select { font: inherit; margin-top: 0.3em; width: 100%; }
  .setting button {
    font: inherit; padding: 0.35em 0.9em; cursor: pointer;
    border: 1px solid #c8ccd2; border-radius: 4px; background: #fff;
  }
  .setting button:disabled { color: #9aa0a8; cursor: progress; }
  .setting .note { display: block; margin-top: 0.4em; font-size: 11px; color: #767c85; }
  #source { flex: 1; overflow: auto; margin: 0; padding: 1em; font-size: 11px; line-height: 1.6; white-space: pre-wrap; }
  /* 狭い画面では、ソースは呼ばれたときだけ出す。 */
  #toggle-source { display: none; }
  @media (max-width: 820px) {
    body { grid-template-columns: 1fr; }
    #toggle-source {
      display: block; position: fixed; right: 8px; top: 8px; z-index: 40;
      border: 1px solid #c8ccd2; background: #fff; border-radius: 4px;
      padding: 0.3em 0.7em; font: inherit; font-size: 12px; cursor: pointer;
    }
    aside {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; height: 60%;
      border-left: none; border-top: 1px solid #c8ccd2;
      box-shadow: 0 -4px 16px rgba(0,0,0,.18);
    }
    aside[hidden] { display: none; }
  }
</style>
</head><body>
<div id="editor"></div>
<button type="button" id="toggle-source" aria-expanded="false">ソースを見る</button>
<aside id="side">
  <h2>ソース（書き戻される内容）</h2>
  <label class="setting">確定キー <select id="commit-key"></select></label>
  <div class="setting"><button type="button" id="make-pdf">PDF を出す</button>
    <span class="note">組版はこのブラウザで行います</span></div>
  <div id="status">タブの操作がそのままバイト範囲の書き換えになる</div>
  <pre id="source"></pre>
</aside>
<script src="editor.js"></script>
</body></html>`);
console.log('out/editor.html を生成');

// 公開用に、テーマを隣に置いた形でもう 1 枚。束は `<script>` の中に入れない——
// この束は文字列として `<!--` を含んでおり、埋め込むと HTML の解析がそこで狂う。
mkdirSync('out/editor', { recursive: true });
writeFileSync('out/editor/index.html',
  readFileSync('out/editor.html', 'utf8')
    .replace('href="../themes/default/theme.css"', 'href="theme.css"'));
writeFileSync('out/editor/theme.css', readFileSync('themes/default/theme.css', 'utf8'));
// 依存の中に置換文字（U+FFFD）を文字として持つ表がある。中身はどれも文字列
// リテラルなので、公開する版では同じ意味のエスケープに直す——生のまま置くと、
// 配信の途中で「壊れた文字」と見なされて弾かれる。
writeFileSync('out/editor/editor.js',
  readFileSync('out/editor.js', 'utf8').split('\uFFFD').join('\\uFFFD'));
console.log('out/editor/ を生成（index.html ＋ editor.js ＋ theme.css）');
