// The web viewer (out/web/, from tools/build-web-viewer.mjs), in a browser,
// against a GitHub that answers from the sample folder.
//
// The page is served over http://localhost, as Pages serves it over https:
// local font access needs a secure context, and file:// is not one. GitHub's
// API and raw host are answered by the test, so the check needs no network
// and spends nobody's rate limit.
import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { chromium } from 'playwright-core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

// --- The page, served -------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' };
const server = createServer((request, response) => {
  const path = join('out/web', decodeURIComponent(new URL(request.url, 'http://x').pathname));
  try {
    const file = statSync(path).isDirectory() ? join(path, 'index.html') : path;
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://localhost:${server.address().port}`;

// --- A GitHub held in the sample folder ----------------------------------------
// The branch has a `/` in it, as this repository's default branch does.
const OWNER = 'example', REPO = 'designs', BRANCH = 'claude/sample-docs', SHA = 'c0ffee'.padEnd(40, '0');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [relative('sample', join(dir, entry.name)).split('\\').join('/')]);
const FILES = walk('sample');
const api = [];
let failRateLimit = false;
const TOKEN = 'github_pat_test';
/** The Authorization header each request to the private repository came with. */
const authorized = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await context.grantPermissions(['local-fonts'], { origin: BASE }).catch(() => undefined);
await context.route('https://api.github.com/**', route => {
  const url = new URL(route.request().url());
  api.push(url.pathname + url.search);
  const json = body => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*' },
  });
  if (failRateLimit) {
    return route.fulfill({
      status: 403, body: '{}', headers: {
        'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset',
        'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800),
      },
    });
  }
  // A private repository: GitHub answers 404 until the reader's token comes with the request.
  const secret = `/repos/${OWNER}/secret`;
  if (url.pathname.startsWith(secret)) {
    const authorization = route.request().headers()['authorization'];
    authorized.push(authorization ?? '');
    if (authorization !== `Bearer ${TOKEN}`) {
      return route.fulfill({ status: 404, body: '{"message":"Not Found"}', headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.pathname === `${secret}/branches`) return json([{ name: 'main', commit: { sha: SHA } }]);
    if (url.pathname === `${secret}/tags`) return json([]);
    if (url.pathname === `${secret}/git/trees/${SHA}`) return json({ tree: FILES.map(path => ({ path, type: 'blob' })) });
    const path = decodeURIComponent(url.pathname.slice(`${secret}/contents/`.length));
    if (url.pathname.startsWith(`${secret}/contents/`) && FILES.includes(path)) {
      return route.fulfill({ status: 200, body: readFileSync(join('sample', path)), headers: { 'access-control-allow-origin': '*' } });
    }
    return route.fulfill({ status: 404, body: '{"message":"Not Found"}', headers: { 'access-control-allow-origin': '*' } });
  }
  const prefix = `/repos/${OWNER}/${REPO}`;
  if (url.pathname === `${prefix}/branches`) return json([{ name: 'main', commit: { sha: 'f'.repeat(40) } }, { name: BRANCH, commit: { sha: SHA } }]);
  if (url.pathname === `${prefix}/tags`) return json([]);
  if (url.pathname === `${prefix}/git/trees/${SHA}`) return json({ tree: FILES.map(path => ({ path, type: 'blob' })), truncated: false });
  return route.fulfill({ status: 404, body: '{"message":"Not Found"}', headers: { 'access-control-allow-origin': '*' } });
});
const raw = [];
await context.route('https://raw.githubusercontent.com/**', route => {
  const url = new URL(route.request().url());
  const prefix = `/${OWNER}/${REPO}/${SHA}/`;
  raw.push(decodeURIComponent(url.pathname));
  const path = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!url.pathname.startsWith(prefix) || !FILES.includes(path)) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, body: readFileSync(join('sample', path)), headers: { 'access-control-allow-origin': '*' } });
});

// A GitLab and an Azure DevOps holding the same sample, as public projects.
const sample = (route, path) => FILES.includes(path)
  ? route.fulfill({ status: 200, body: readFileSync(join('sample', path)), headers: { 'access-control-allow-origin': '*' } })
  : route.fulfill({ status: 404, body: '{}', headers: { 'access-control-allow-origin': '*' } });
const answer = (route, body) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' },
});
await context.route('https://gitlab.example.test/api/v4/**', route => {
  const url = new URL(route.request().url());
  const api = '/api/v4/projects/team%2Fdesigns/repository';
  const pathname = url.pathname.replace('/api/v4/projects/team/designs/', '/api/v4/projects/team%2Fdesigns/');
  if (pathname === `${api}/branches` || pathname === `${api}/tags`) {
    return answer(route, pathname.endsWith('branches') ? [{ name: BRANCH, commit: { id: SHA } }] : []);
  }
  if (pathname === `${api}/tree`) {
    const page = Number(url.searchParams.get('page'));
    return answer(route, FILES.slice((page - 1) * 100, page * 100).map(path => ({ path, type: 'blob' })));
  }
  const file = /\/repository\/files\/(.+)\/raw$/.exec(url.pathname);
  if (file) return sample(route, decodeURIComponent(file[1]));
  return route.fulfill({ status: 404, body: '{}', headers: { 'access-control-allow-origin': '*' } });
});
await context.route('https://dev.azure.com/org/**', route => {
  const url = new URL(route.request().url());
  const repo = '/org/proj/_apis/git/repositories/designs';
  if (url.pathname === `${repo}/refs`) return answer(route, { value: [{ name: `refs/heads/${BRANCH}`, objectId: SHA }] });
  if (url.pathname === `${repo}/items` && url.searchParams.get('recursionLevel') === 'Full') {
    return answer(route, { value: FILES.map(path => ({ path: `/${path}`, gitObjectType: 'blob' })) });
  }
  if (url.pathname === `${repo}/items`) return sample(route, url.searchParams.get('path').slice(1));
  return route.fulfill({ status: 404, body: '{}', headers: { 'access-control-allow-origin': '*' } });
});

// What viewer.js imports itself, and so comes with every page: shared code, not Mermaid.
const UP_FRONT = new Set([...readFileSync('out/web/viewer.js', 'utf8').matchAll(/from\s*"\.\/chunks\/([^"]+)"/g)].map(m => m[1]));

const page = await context.newPage();
// The split-off scripts the page loaded: Mermaid is among them, and only a
// document that draws with it should load any.
const chunks = [];
page.on('request', request => { if (request.url().includes('/chunks/')) chunks.push(request.url()); });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
const view = src => `${BASE}/view.html?lang=ja&src=${encodeURIComponent(src)}`;
const idle = () => page.waitForFunction(() => document.querySelector('.dpw-status')?.dataset.kind !== 'busy', null, { timeout: 30000 });

// --- 入口 ----------------------------------------------------------------------
await page.goto(`${BASE}/view.html?lang=ja`);
check('src が無ければ URL の入力欄を出す', await page.isVisible('#dpw-src'));
await page.fill('#dpw-src', 'https://example.com/not/github');
await page.click('.dpw-form button[type=submit]');
check('GitHub の URL でなければ形を示して断る', (await page.textContent('.dpw-status'))?.includes('GitHub の文書・図・フォルダの URL ではありません'));
await page.fill('#dpw-src', `https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/docs/auth-design.md`);
await Promise.all([page.waitForURL(/src=/), page.click('.dpw-form button[type=submit]')]);
check('入力すると ?src= で同じページが開く（そのまま共有できる形）', page.url().includes('src=https%3A%2F%2Fgithub.com'));
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000, state: 'attached' });
await idle();

// --- 文書 ----------------------------------------------------------------------
api.length = 0;
raw.length = 0;
await page.goto(view(`https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/docs/auth-design.md`));
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000 });
await idle();
check('/ 入りのブランチを切り分けて文書を出す', (await page.textContent('.dpw-doc'))?.includes('認証機能 設計書'));
check('コミットを短い SHA で出す', (await page.textContent('.dpw-commit'))?.includes(`${BRANCH} @ ${SHA.slice(0, 7)}`));
const figures = await page.$$eval('.dpw-doc .dp-figure svg', nodes => nodes.length);
check('../shared の図も含めて図が描かれる', figures >= 3, `${figures} 枚`);
const images = await page.$$eval('.dpw-doc img', nodes => nodes.filter(n => n.src.startsWith('data:image/')).length);
check('画像は data: URL で出る', images >= 1, `${images} 枚`);
await page.waitForFunction(() => document.querySelectorAll('.dpw-doc .dp-mermaid-diagram svg').length > 0, null, { timeout: 30000 }).catch(() => undefined);
check('Mermaid が描かれる', await page.$$eval('.dpw-doc .dp-mermaid-diagram svg', n => n.length) > 0);
check('Mermaid のある文書では描く部品を後から読む', chunks.length > 0, `${chunks.length} 本`);
check('テーマが効いている（本文の段組み幅）', await page.$eval('.dpw-doc', n => getComputedStyle(n).maxWidth) !== 'none');
check('API は数回で済む（中身は raw から）', api.length <= 3, api.join(', '));
check('中身はコミット固定で取る', raw.every(path => path.startsWith(`/${OWNER}/${REPO}/${SHA}/`)));
check('他の文書は取りに行かない', !raw.some(path => path.endsWith('order-slides.md')));

// 言語を切り替えても GitHub にはもう尋ねない。
const before = api.length + raw.length;
await page.selectOption('.dpw-language select', 'en');
await page.waitForFunction(() => document.querySelector('.dpw-bar')?.textContent?.includes('View on GitHub'));
await idle();
check('言語の切り替えで取り直さない', api.length + raw.length === before, `${api.length + raw.length - before} 回`);
await page.selectOption('.dpw-language select', 'ja');
await page.waitForFunction(() => document.querySelector('.dpw-bar')?.textContent?.includes('GitHub で見る'));
await idle();

// --- PDF -----------------------------------------------------------------------
const hasFonts = await page.evaluate(() => typeof window.queryLocalFonts === 'function');
if (!hasFonts) {
  check('PDF: このブラウザにローカルフォントの API が無い（確認を飛ばす）', true);
} else {
  check('PDF の書き手は押すまで読まない', !chunks.some(url => url.includes('/chunks/pdf-')));
  const pdfButton = page.locator('.dpw-bar button', { hasText: 'PDF をダウンロード' });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }).catch(() => undefined),
    pdfButton.click(),
  ]);
  if (!download) {
    check('PDF: ダウンロードされる', false, await page.textContent('.dpw-status'));
  } else {
    check('PDF: 文書番号が名前になる', download.suggestedFilename() === 'SD-AUTH-001.pdf', download.suggestedFilename());
    const path = 'out/web-viewer.pdf';
    await download.saveAs(path);
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: false }).promise;
    const first = await (await pdf.getPage(1)).getTextContent();
    const words = first.items.map(item => item.str).join('');
    check('PDF: 複数ページに組まれる', pdf.numPages >= 3, `${pdf.numPages} ページ`);
    check('PDF: 日本語が文字として入っている', words.includes('認証機能'), words.slice(0, 40));
    check('PDF: 押したら PDF の書き手を読む', chunks.some(url => url.includes('/chunks/pdf-')));
    check('PDF: 状態欄に結果を出す', (await page.textContent('.dpw-status'))?.includes('ページの PDF をダウンロードしました'));
  }
}

// --- .dgm 単体 ------------------------------------------------------------------
chunks.length = 0;
await page.goto(view(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/docs/auth-design/login-screen.dgm`));
await page.waitForSelector('.dpw-doc svg', { timeout: 30000 });
await idle();
check('.dgm の raw URL は図だけを出す', await page.$$eval('.dpw-doc .dp-figure', n => n.length) === 1);
check('部品ライブラリを使う図もエラーにならない', !(await page.isVisible('.dpw-notes details')) ||
  !(await page.textContent('.dpw-notes'))?.includes('読めない'));
check('タイトルはファイル名', (await page.title()).startsWith('login-screen.dgm'));
const loadedLater = chunks.map(url => url.slice(url.lastIndexOf('/') + 1)).filter(name => !UP_FRONT.has(name));
check('Mermaid の無い文書では Mermaid を読み込まない', loadedLater.length === 0, loadedLater.join(', '));

// --- フォルダ -------------------------------------------------------------------
await page.goto(view(`https://github.com/${OWNER}/${REPO}/tree/${BRANCH}/docs`));
await page.waitForSelector('.dpw-folder', { timeout: 30000 });
const links = await page.$$eval('.dpw-folder li a', nodes => nodes.map(n => n.textContent));
check('tree の URL はフォルダの文書と図を並べる', links.includes('auth-design.md') && links.includes('auth-design/login-flow.dgm'), `${links.length} 件`);
check('上のフォルダへ戻れる', await page.isVisible('.dpw-folder a:has-text("上のフォルダへ")'));
const href = await page.$eval('.dpw-folder li a', node => node.getAttribute('href'));
check('一覧のリンクはコミット固定', decodeURIComponent(href ?? '').includes(`/blob/${SHA}/`), href);
await Promise.all([page.waitForURL(/src=/), page.click('.dpw-folder li a >> nth=0')]);
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000, state: 'attached' });
await idle();
check('一覧から文書を開ける', (await page.textContent('.dpw-commit'))?.includes(`コミット ${SHA.slice(0, 7)}`));

// --- 失敗の出し方 ------------------------------------------------------------------
await page.goto(view(`https://github.com/${OWNER}/private-repo/blob/main/a.md`));
await idle();
check('見つからないリポジトリは理由を言う', (await page.textContent('.dpw-status'))?.includes('公開されていないか、見つかりません'));
await page.goto(view(`https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/shared/glossary.table`));
await idle();
check('文書でも図でもないファイルはそう言う', (await page.textContent('.dpw-status'))?.includes('表示できる文書（.md）でも図（.dgm）でもありません'),
  await page.textContent('.dpw-status'));
failRateLimit = true;
await page.goto(view(`https://github.com/${OWNER}/other/blob/main/a.md`));
await idle();
check('回数制限は解除の時刻を言う', (await page.textContent('.dpw-status'))?.includes('回数制限'));
failRateLimit = false;

// --- 非公開リポジトリ（トークン） ----------------------------------------------------------
const secretDoc = `https://github.com/${OWNER}/secret/blob/main/docs/auth-design.md`;
await page.goto(view(secretDoc));
await idle();
check('非公開リポジトリはトークンを求める', await page.isVisible('#dpw-token'), await page.textContent('.dpw-status'));
await page.screenshot({ path: 'out/web-viewer-token.png' });
check('トークンを作る場所と権限を示す', (await page.getAttribute('.dpw-form a[target=_blank]', 'href'))?.includes('github.com/settings/personal-access-tokens')
  && (await page.textContent('.dpw-form'))?.includes('Contents — Read-only'));
await page.fill('#dpw-token', 'wrong');
await page.click('.dpw-form button[type=submit]');
await idle();
check('効かないトークンはそう言って、もう一度求める', (await page.textContent('.dpw-status'))?.includes('入れたトークンには読む権限がありません')
  && await page.isVisible('#dpw-token'));
raw.length = 0;
await page.fill('#dpw-token', TOKEN);
await page.click('.dpw-form button[type=submit]');
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000, state: 'attached' });
await idle();
check('トークンを入れると非公開の文書が出る', (await page.textContent('.dpw-doc'))?.includes('認証機能 設計書'));
check('トークンは API にだけ付いて、raw ホストには行かない', authorized.at(-1) === `Bearer ${TOKEN}` && !raw.some(path => path.includes('/secret/')));
check('トークンはこのタブ（sessionStorage）にだけ置く', await page.evaluate(() =>
  sessionStorage.getItem('docpresenter.token:https://github.com') !== null && localStorage.getItem('docpresenter.token:https://github.com') === null));
await page.reload();
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000, state: 'attached' });
await idle();
check('開き直してもこのタブでは聞き直さない', !(await page.isVisible('#dpw-token')));
await page.click('.dpw-bar button:has-text("トークンを消す")');
await page.waitForSelector('#dpw-token', { timeout: 30000 });
check('トークンを消すと、また求める', await page.evaluate(() => sessionStorage.getItem('docpresenter.token:https://github.com') === null));
const urlWithToken = page.url();
check('URL にトークンは載らない', !urlWithToken.includes(TOKEN));

// --- GitLab と Azure DevOps ---------------------------------------------------------
await page.goto(view(`https://gitlab.example.test/team/designs/-/blob/${BRANCH}/docs/auth-design.md`));
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000, state: 'attached' });
await idle();
check('GitLab の文書を出す（/ 入りのブランチ）', (await page.textContent('.dpw-commit'))?.includes(`${BRANCH} @ ${SHA.slice(0, 7)}`)
  && (await page.textContent('.dpw-doc'))?.includes('認証機能 設計書'));
check('GitLab へのリンクは GitLab の形', (await page.getAttribute('.dpw-bar a[target=_blank]', 'href'))
  === `https://gitlab.example.test/team/designs/-/blob/${BRANCH}/docs/auth-design.md`);
await page.goto(view(`https://dev.azure.com/org/proj/_git/designs?path=/docs/auth-design.md&version=GB${BRANCH}`));
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000, state: 'attached' });
await idle();
check('Azure DevOps の文書を出す', (await page.textContent('.dpw-doc'))?.includes('認証機能 設計書'));
await page.goto(view(`https://dev.azure.com/org/proj/_git/designs?path=/docs&version=GB${BRANCH}`));
await page.waitForSelector('.dpw-folder', { timeout: 30000 });
check('Azure DevOps のフォルダも並べる', (await page.$$eval('.dpw-folder li a', n => n.length)) > 5);

// --- 狭い画面 ----------------------------------------------------------------------
await page.setViewportSize({ width: 375, height: 800 });
await page.goto(view(`https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/docs/auth-design.md`));
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000 });
await idle();
const overflow = await page.evaluate(() => document.querySelector('.dpw-bar').scrollWidth - document.documentElement.clientWidth);
check('電話の幅でもバーがはみ出さない', overflow <= 0, `${overflow}px`);
await page.screenshot({ path: 'out/web-viewer-phone.png' });
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(view(`https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/docs/auth-design.md`));
await page.waitForSelector('.dpw-doc .dp-figure', { timeout: 30000 });
await idle();
await page.screenshot({ path: 'out/web-viewer.png' });

await browser.close();
server.close();
