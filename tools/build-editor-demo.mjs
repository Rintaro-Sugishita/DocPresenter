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
      files[relative(base, path)] = readFileSync(path, 'utf8');
    }
    // 画像も抱えて持つ。ブラウザにファイルシステムは無いので、
    // 相対パスのままでは画面にも PDF にも出ない。
    const image = /\.(png|jpe?g|gif)$/i.exec(entry.name);
    if (image) {
      const type = image[1].toLowerCase() === 'jpg' ? 'jpeg' : image[1].toLowerCase();
      images[relative(base, path)] =
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
  body:        { file: `${NOTO}/NotoSerifCJK-Regular.ttc`, index: 0, name: 'NotoSerifCJKjp-Regular' },
  bodyBold:    { file: `${NOTO}/NotoSerifCJK-Bold.ttc`,    index: 0, name: 'NotoSerifCJKjp-Bold' },
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
const fonts = {};
let fontBytes = 0;
for (const [style, face] of Object.entries(FACES)) {
  const source = read(face.file) ?? read(FALLBACK);
  if (!source) throw new Error('埋め込むフォントが見つからない');
  const cut = subsetter(source, characters, read(face.file) ? face.index : 0);
  fontBytes += cut.length;
  fonts[style] = { name: face.name, base64: Buffer.from(cut).toString('base64') };
}
console.log(`フォント ${characters.size} 字 → ${(fontBytes / 1024).toFixed(0)} KB（5 面）`);

const entry = `
const ASSETS = ${JSON.stringify(resolve(base))};
const FONTS = ${JSON.stringify(fonts)};

import { parseDocument, resolveDocument } from '@docpresenter/markdown';
import { renderDocument } from '@docpresenter/markdown';
import { renderPage } from '@docpresenter/build';
import { measure, writePdf } from '@docpresenter/pdf';
import { COMMIT_KEYS, COMMIT_KEY_LABEL, DEFAULT_SETTINGS, mountSheetView } from '@docpresenter/editor';

const FILES = ${JSON.stringify(files)};
const IMAGES = ${JSON.stringify(images)};
const clean = path => (path.startsWith('./') ? path.slice(2) : path);
const loader = {
  read: p => FILES[clean(p)],
  url: p => IMAGES[clean(p)] ?? 'file://' + ASSETS + '/' + clean(p),
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
  readResource: p => FILES[clean(p)],
  createResource,
  // すでにあるものの一覧。どのファイルが在るかは器が知っている。
  listResources: () => Object.keys(FILES)
    .filter(path => /\.(dgm|table|mmd|ermlx)$/i.test(path))
    .sort((a, b) => Number(a.includes('shared')) - Number(b.includes('shared')) || a.localeCompare(b))
    .map(path => ({ path, label: path })),
  onChange: (edit, text) => {
    if (edit.path === undefined) document.getElementById('source').textContent = text;
    else FILES[clean(edit.path)] = text;
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
const FONT_SET = Object.fromEntries(Object.entries(FONTS).map(([style, font]) => [
  style, { bytes: decode(font.base64), name: font.name },
]));
// すでに削ってある。pdf-lib 内蔵のサブセッタは CFF を壊すので、通さない。
const alreadyCut = bytes => bytes;

const workspace = {
  list: () => Object.keys(FILES),
  read: p => FILES[clean(p)],
  dataUrl: p => IMAGES[clean(p)],
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
    const doc = parseDocument(source);
    const page = renderPage({
      workspace,
      document: doc,
      resolved: resolveDocument(doc),
      style: '',                       // テーマはページに読み込まれているものを使う
      root: 'docs/auth-design.md',
    });
    // 器（このページ）には既にテーマが読み込まれているので、本文だけを取り出す。
    const open = page.indexOf('<body>') + '<body>'.length;
    stage.innerHTML = page.slice(open, page.lastIndexOf('</body>'));
    document.body.append(stage);

    const raw = doc.frontmatter.raw;
    const foot = [raw.document, raw.version && ('版 ' + raw.version)].filter(Boolean).join('　');
    const measured = measure(stage, { foot, title: String(raw.title ?? '') });
    const { bytes, missing } = await writePdf(measured.plan, { fonts: FONT_SET, subset: alreadyCut });

    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = (raw.document ?? 'document') + '.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    // P6: 出せなかった字は黙って消さない。同梱したのは標本のぶんだけである。
    const lost = [...new Set(missing.map(one => one.character))].join('');
    say(measured.plan.pages.length + ' ページの PDF を作りました'
      + (lost ? '　同梱フォントに無い字: ' + lost : ''), lost ? 'refused' : 'ok');
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
