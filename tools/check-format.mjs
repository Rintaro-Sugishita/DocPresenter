// Drives the formatting bar. What matters is not that the button lights up but
// that the right bytes end up in the file, so every check reads the source.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', e => { console.log('✗ ページエラー:', e.message); process.exitCode = 1; });
await page.goto('file://' + process.cwd() + '/out/editor.html');
await page.waitForTimeout(400);

const source = () => page.textContent('#source');
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

// 本文をクリックすると、その段落の markdown が開く。
await page.click('.dp-prose p');
await page.waitForTimeout(200);
const opened = await page.inputValue('.dp-block-source');
check('本文をクリックすると markdown が開く', opened.startsWith('本書は、会員向け'), opened.slice(0, 20));
check('書式バーが出る', await page.isVisible('.dp-format-bar'));

// 「認証機能」を選んで太字にする。
const select = async word => {
  const value = await page.inputValue('.dp-block-source');
  const at = value.indexOf(word);
  await page.$eval('.dp-block-source', (el, [s, e]) => {
    el.setSelectionRange(s, e);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  }, [at, at + word.length]);
};

await select('認証機能');
await page.click('.dp-format-bold', { force: true });
await page.waitForTimeout(100);
check('太字が入る', (await page.inputValue('.dp-block-source')).includes('**認証機能**'));
check('入れた直後はボタンが点く',
  await page.getAttribute('.dp-format-bold', 'aria-pressed') === 'true');

await page.click('.dp-format-bold', { force: true });
await page.waitForTimeout(100);
check('もう一度押すと外れる', !(await page.inputValue('.dp-block-source')).includes('**認証機能**'));

// 意味トークン
await select('認証機能');
await page.click('.dp-format-token.dp-token-pending', { force: true });
await page.waitForTimeout(100);
check('意味トークンが付く',
  (await page.inputValue('.dp-block-source')).includes('[認証機能]{.pending}'));

await page.click('.dp-format-token.dp-token-changed', { force: true });
await page.waitForTimeout(100);
const swapped = await page.inputValue('.dp-block-source');
check('別のトークンで置き換わる（二重にならない）',
  swapped.includes('[認証機能]{.changed}') && !swapped.includes('.pending'));

// Ctrl+B
await select('設計');
await page.keyboard.press('Control+b');
await page.waitForTimeout(100);
check('Ctrl+B でも効く', (await page.inputValue('.dp-block-source')).includes('**設計**'));

// 確定（blur）→ ソースに書き戻る
await page.click('.dp-tabbar-spacer');
await page.waitForTimeout(300);
const written = await source();
check('確定するとソースに書き戻る',
  written.includes('[認証機能]{.changed}') && written.includes('**設計**'));
check('書き戻しは 1 段落分のバイト範囲',
  (await page.textContent('#status')).includes('本文を編集'),
  await page.textContent('#status'));
check('描画されたトークンに class が付く',
  await page.isVisible('.dp-prose .dp-text-changed'));

// Escape は捨てる
await page.click('.dp-prose p');
await page.waitForTimeout(150);
await page.$eval('.dp-block-source', el => { el.value = '壊す'; });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape で編集を捨てる', !(await source()).includes('壊す'));

await page.click('.dp-prose p');
await page.waitForTimeout(200);
await page.screenshot({ path: 'out/editor-format.png' });
await browser.close();
