// Builds a standalone page that runs the editor against the sample document,
// so the sheet tabs can be used rather than only described. Everything the
// document references is inlined, because a browser has no file system.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { rolldown } from 'rolldown';

const DOC = 'sample/docs/auth-design.md';
const base = dirname(DOC);

// サンプルが参照しうるファイルを丸ごと集める（相対パスで引ける形にする）。
const files = {};
const collect = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { collect(path); continue; }
    if (/\.(dgm|table|ermlx|mmd|md)$/i.test(entry.name)) {
      files[relative(base, path)] = readFileSync(path, 'utf8');
    }
  }
};
collect('sample');

const entry = `
const ASSETS = ${JSON.stringify(resolve(base))};

import { parseDocument, resolveDocument } from '@docpresenter/core';
import { renderDocument } from '@docpresenter/render';
import { COMMIT_KEYS, COMMIT_KEY_LABEL, DEFAULT_SETTINGS, mountSheetView } from '@docpresenter/editor';

const FILES = ${JSON.stringify(files)};
const IMAGES = {};
const clean = path => (path.startsWith('./') ? path.slice(2) : path);
const loader = { read: p => FILES[clean(p)], url: p => 'file://' + ASSETS + '/' + clean(p) };

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

const view = mountSheetView({
  root: document.getElementById('editor'),
  source: ${JSON.stringify(readFileSync(DOC, "utf8"))},
  render,
  settings,
  readResource: p => FILES[clean(p)],
  onChange: (edit, text) => {
    if (edit.path === undefined) document.getElementById('source').textContent = text;
    else FILES[clean(edit.path)] = text;
    say(edit.description + '　' + edit.span.start + '〜' + edit.span.end + ' バイトを書き換え', 'ok');
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
  #source { flex: 1; overflow: auto; margin: 0; padding: 1em; font-size: 11px; line-height: 1.6; white-space: pre-wrap; }
</style>
</head><body>
<div id="editor"></div>
<aside>
  <h2>ソース（書き戻される内容）</h2>
  <label class="setting">確定キー <select id="commit-key"></select></label>
  <div id="status">タブの操作がそのままバイト範囲の書き換えになる</div>
  <pre id="source"></pre>
</aside>
<script src="editor.js"></script>
</body></html>`);
console.log('out/editor.html を生成');
