// The build, seen as the reader sees it. A build artifact is the thing that
// gets sent to people, so what matters is that one file opens on its own: no
// stylesheet beside it, no image folder, no broken reference. That cannot be
// checked by reading the HTML — it has to be opened.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

// Nothing may be fetched from outside the file: a delivered page that needs the
// network is a page that arrives broken.
const outside = [];
page.on('request', request => {
  const url = request.url();
  if (!url.startsWith('file://') && !url.startsWith('data:')) outside.push(url);
});

await page.goto('file://' + process.cwd() + '/out/build/auth-design.html');
await page.waitForTimeout(300);

check('表紙の事実が出る', (await page.textContent('.dp-cover')).includes('SD-AUTH-001'),
  (await page.textContent('.dp-cover')).replace(/\s+/g, ' ').trim());
check('テーマが効いている',
  await page.$eval('body', b => getComputedStyle(b).maxWidth !== 'none'),
  await page.$eval('body', b => getComputedStyle(b).maxWidth));
check('図が描かれている', (await page.$$('.dp-diagram')).length >= 4,
  String((await page.$$('.dp-diagram')).length) + ' 枚');
check('表が描かれている', (await page.$$('.dp-table')).length >= 2,
  String((await page.$$('.dp-table')).length) + ' 枚');
check('画像が埋め込まれている',
  await page.$eval('.dp-figure img', img => img.src.startsWith('data:') && img.naturalWidth > 0),
  await page.$eval('.dp-figure img', img => `${img.naturalWidth}x${img.naturalHeight}`));
check('外から取りに行っていない', outside.length === 0, outside.join(' '));
check('参照が番号に置き換わっている',
  (await page.textContent('.dp-ref')).match(/^(図|表|\d)/) !== null,
  await page.textContent('.dp-ref'));
check('参照先が見つからない図が無い', (await page.$$('.dp-missing')).length === 0,
  (await page.$$eval('.dp-missing', ns => ns.map(n => n.textContent))).join(' / '));
check('読めなかった図表が無い', (await page.$$('.dp-broken')).length === 0,
  (await page.$$eval('.dp-broken', ns => ns.map(n => n.textContent))).join(' / '));
check('シートが分かれている', (await page.$$('.dp-sheet')).length >= 5,
  String((await page.$$('.dp-sheet')).length) + ' 枚');

// 別の文書から取り込んだ節は、どのファイルの何バイト目かまで言える
const included = await page.$('[data-doc="shared/revision.md"]');
check('取り込んだ文書はどのファイルか言える', included !== null);
check('取り込んだ節も採番される',
  (await page.textContent('#sec-revision')).trim().startsWith('6'),
  await page.textContent('#sec-revision'));

// 同じファイルが、置かれた文書ごとに別の番号を得る
await page.goto('file://' + process.cwd() + '/out/build/auth-overview.html');
await page.waitForTimeout(200);
check('同じ節が別の文書では別の番号になる',
  (await page.textContent('#sec-revision')).trim().startsWith('3'),
  await page.textContent('#sec-revision'));
check('概要にも図が出る', (await page.$$('.dp-diagram')).length === 2);
check('生成元のコミットが埋まっている',
  (await page.getAttribute('meta[name="dp-commit"]', 'content') ?? '').length === 40);

await page.screenshot({ path: 'out/build-page.png', fullPage: false });
await browser.close();
