// Builds a single self-contained page so the editor can be opened and used in
// a plain browser. Everything is inlined — the bundle, the theme, the sample
// and its image — because the page is served from somewhere that only allows
// its own files.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { rolldown } from 'rolldown';

const DOC = 'sample/docs/auth-design.md';
const base = dirname(DOC);

const text = {};
const images = {};
const collect = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { collect(path); continue; }
    const key = relative(base, path);
    if (/\.(dgm|table|ermlx|mmd|md)$/i.test(entry.name)) {
      text[key] = readFileSync(path, 'utf8');
    } else if (/\.png$/i.test(entry.name)) {
      images[key] = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
    }
  }
};
collect('sample');

const entry = `
import { parseDocument, resolveDocument } from '@docpresenter/core';
import { renderDocument } from '@docpresenter/render';
import { COMMIT_KEYS, COMMIT_KEY_LABEL, DEFAULT_SETTINGS, mountSheetView } from '@docpresenter/editor';

const FILES = ${JSON.stringify(text)};
const IMAGES = ${JSON.stringify(images)};
const clean = path => (path.startsWith('./') ? path.slice(2) : path);
const loader = { read: p => FILES[clean(p)], url: p => IMAGES[clean(p)] ?? clean(p) };

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
  source: ${JSON.stringify(readFileSync(DOC, 'utf8'))},
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

mkdirSync('out/artifact', { recursive: true });
writeFileSync('out/artifact/entry.js', entry);
const bundle = await rolldown({ input: 'out/artifact/entry.js', platform: 'browser' });
const built = await bundle.generate({ format: 'iife' });

// markdown-it's UTF-8 validator emits U+FFFD literally in its source. A raw
// replacement character in a published file reads as a lost byte, so it is
// written as an escape instead — identical inside a string literal, and the
// file no longer carries the character itself.
const script = built.output[0].code.replaceAll('\uFFFD', '\\uFFFD');
const theme = readFileSync('themes/default/theme.css', 'utf8');

writeFileSync('out/artifact/index.html', page(theme, script));
console.log(`out/artifact/index.html を生成（${(page(theme, script).length / 1024 / 1024).toFixed(2)} MB）`);

function page(theme, script) {
  return `<title>DocPresenter シートエディタ</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&family=Noto+Serif+JP:wght@400;600&display=swap">
<style>
/* 文書のテーマ。製品の themes/default/theme.css をそのまま読み込む。 */
${theme}

/* 同梱フォントの代わりに Google Fonts の Noto を使う。字面は同じ。 */
:root {
  --font-heading: "Noto Sans JP", "Noto Sans CJK JP", sans-serif;
  --font-body:    "Noto Serif JP", "Noto Serif CJK JP", serif;
  --font-mono:    ui-monospace, "Noto Sans Mono CJK JP", monospace;

  --shell:        #eceef1;
  --shell-line:   #c8ccd2;
  --shell-ink:    #3a4048;
  --shell-quiet:  #6b7280;
  --shell-accent: #1f5fa8;
}

html, body { height: 100%; }
body {
  margin: 0; max-width: none; padding: 0;
  background: var(--shell); color: var(--shell-ink);
  font-family: var(--font-heading); font-size: 13px; line-height: 1.6;
}

.app { height: 100%; display: flex; flex-direction: column; min-height: 0; }

.bar {
  flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5em 1.4em;
  padding: 0.7em 16px; background: #fff; border-bottom: 1px solid var(--shell-line);
}
.bar h1 { font-size: 14px; font-weight: 700; margin: 0; letter-spacing: .02em; }
.bar p { margin: 0; color: var(--shell-quiet); font-size: 12px; }
.bar kbd {
  font: inherit; font-size: 11px; background: #eef0f3; border: 1px solid #d3d7dd;
  border-bottom-width: 2px; border-radius: 3px; padding: 0 0.35em;
}

.work { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 21em; }
#editor { min-width: 0; min-height: 0; }

.side {
  display: flex; flex-direction: column; min-height: 0; min-width: 0;
  background: #fbfbfc; border-left: 1px solid var(--shell-line);
}
.side h2 {
  font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
  color: var(--shell-quiet); margin: 0; padding: 0.9em 1.1em 0.6em;
}
.setting {
  display: block; padding: 0 1.1em 0.9em; font-size: 12px; color: var(--shell-quiet);
  border-bottom: 1px solid #e4e6ea;
}
.setting select {
  display: block; width: 100%; margin-top: 0.4em; font: inherit; font-size: 12px;
  padding: 0.3em; border: 1px solid var(--shell-line); border-radius: 3px; background: #fff;
  color: var(--shell-ink);
}
#status {
  padding: 0.9em 1.1em; font-size: 12px; color: var(--shell-quiet);
  border-bottom: 1px solid #e4e6ea;
}
#status[data-kind="ok"] { color: var(--shell-accent); font-variant-numeric: tabular-nums; }
#status[data-kind="refused"] { color: #b3261e; }
#source {
  flex: 1; overflow: auto; margin: 0; padding: 1em 1.1em;
  font-family: var(--font-mono); font-size: 11px; line-height: 1.7;
  white-space: pre-wrap; word-break: break-word; color: #454b54;
}

@media (max-width: 820px) {
  .work { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .side { border-left: none; border-top: 1px solid var(--shell-line); }
  #source { max-height: 11em; }
}
</style>

<div class="app">
  <header class="bar">
    <h1>DocPresenter シートエディタ</h1>
    <p>下端のタブでシートを切り替え・ドラッグで並べ替え・ダブルクリックで改名</p>
    <p>本文と図はソースが、表はグリッドが開く</p>
    <p>色は見本かピッカーから自由に、列幅はヘッダの右端をドラッグ</p>
    <p><kbd>Ctrl</kbd>+<kbd>PageDown</kbd> で次のシート</p>
  </header>
  <main class="work">
    <div id="editor"></div>
    <aside class="side">
      <h2>書き戻されるソース</h2>
      <label class="setting" for="commit-key">編集を確定するキー
        <select id="commit-key"></select>
      </label>
      <div id="status">タブと書式バーの操作が、そのままバイト範囲の書き換えになる</div>
      <pre id="source"></pre>
    </aside>
  </main>
</div>

<script>${script}</script>`;
}
