// The web shell's language: asked once, remembered on this device.
//
// The packages take the locale as a value (design/settings-model.md). Deciding
// it is the shell's business, and in a browser there is nothing like VS Code's
// display language to follow — so the first visit asks, with the browser's
// language offered first, and the answer is kept in localStorage like the
// other per-device preferences. The settings panel can change it afterwards.
//
// `?lang=ja` or `?lang=en` in the address decides for that visit and asks
// nothing. It is what the browser checks under tools/ open the pages with, so
// a fresh browser with nothing stored does not stop at the question.
//
// Everything that touches localStorage is wrapped: a private window, blocked
// site data or a sandboxed frame can make the accessor itself throw, and the
// page has to work regardless — it simply asks again next time.

import { defineMessages, isLocale, LOCALE_NAMES, LOCALES, pickLocale } from '@docpresenter/base';

export const LOCALE_KEY = 'docpresenter.locale';

/** The shells' own chrome: the side panel, the status line, the titles. */
export const SHELL_MESSAGES = defineMessages({
  'shell.ask.title': '表示言語',
  'shell.ask.text': 'DocPresenter の表示言語を選んでください。あとから設定で変えられます。',
  'shell.language': '表示言語',
  'shell.edited': '{where}{description}　{start}〜{end} バイトを書き換え',
  'shell.editedIn': '{path} の ',
  'shell.source.show': 'ソースを見る',
  'shell.source.hide': 'ソースを閉じる',
  'shell.source.heading': 'ソース（書き戻される内容）',
  'shell.source.shown': 'ソースは右側に出ています',
  'shell.commitKey': '確定キー',
  'shell.status.start': 'タブの操作がそのままバイト範囲の書き換えになる',
  'shell.pdf.make': 'PDF を出す',
  'shell.pdf.note': '組版はこのブラウザで行います',
  'shell.pdf.composing': 'PDF を組んでいます…',
  'shell.pdf.made': '{pages} ページの PDF を作って{handed}',
  'shell.pdf.missing': '　同梱フォントに無い字: {characters}',
  'shell.pdf.failed': 'PDF を作れませんでした: {message}',
  'shell.save.saved': '保存しました',
  'shell.save.declined': '保存はしていません',
  'shell.save.failed': '保存できませんでした（{code}）',
  'shell.save.downloaded': 'ダウンロードしました',
  'shell.editor.title': 'DocPresenter — シート編集',
  'shell.canvas.title': '作図（単独）',
  'shell.canvas.heading': '書き戻される .dgm',
  'shell.artifact.title': 'DocPresenter シートエディタ',
  'shell.artifact.tabs': '下端のタブでシートを切り替え・ドラッグで並べ替え・ダブルクリックで改名',
  'shell.artifact.open': '本文と図はソースが、表はグリッドが開く',
  'shell.artifact.colour': '色は見本かピッカーから自由に、列幅はヘッダの右端をドラッグ',
  'shell.artifact.next': '{key} で次のシート',
  'shell.artifact.heading': '書き戻されるソース',
  'shell.artifact.commitKey': '編集を確定するキー',
  'shell.artifact.status': 'タブと書式バーの操作が、そのままバイト範囲の書き換えになる',
}, {
  'shell.ask.title': 'Language',
  'shell.ask.text': 'Choose the language DocPresenter speaks. You can change it later in the settings.',
  'shell.language': 'Language',
  'shell.edited': '{where}{description} — rewrote bytes {start}–{end}',
  'shell.editedIn': 'In {path}: ',
  'shell.source.show': 'Show source',
  'shell.source.hide': 'Hide source',
  'shell.source.heading': 'Source (what is written back)',
  'shell.source.shown': 'The source is shown on the right',
  'shell.commitKey': 'Commit key',
  'shell.status.start': 'Every tab operation is a rewrite of a byte range',
  'shell.pdf.make': 'Make PDF',
  'shell.pdf.note': 'Pages are laid out in this browser',
  'shell.pdf.composing': 'Laying out the PDF…',
  'shell.pdf.made': p => `Made a PDF of ${p['pages']} ${p['pages'] === '1' ? 'page' : 'pages'}. ${p['handed']}`,
  'shell.pdf.missing': ' Not in the bundled font: {characters}',
  'shell.pdf.failed': 'Could not make the PDF: {message}',
  'shell.save.saved': 'Saved',
  'shell.save.declined': 'Not saved',
  'shell.save.failed': 'Could not save ({code})',
  'shell.save.downloaded': 'Downloaded',
  'shell.editor.title': 'DocPresenter — Sheet editor',
  'shell.canvas.title': 'Drawing (on its own)',
  'shell.canvas.heading': 'The .dgm written back',
  'shell.artifact.title': 'DocPresenter Sheet Editor',
  'shell.artifact.tabs': 'Switch sheets with the tabs at the bottom, drag to reorder, double-click to rename',
  'shell.artifact.open': 'Text and diagrams open as source, tables as a grid',
  'shell.artifact.colour': 'Pick any colour from the swatches or the picker; drag the right edge of a header for the column width',
  'shell.artifact.next': '{key} for the next sheet',
  'shell.artifact.heading': 'The source written back',
  'shell.artifact.commitKey': 'Key that commits an edit',
  'shell.artifact.status': 'Every tab and formatting operation is a rewrite of a byte range',
});

/** localStorage, or nothing when the browser will not give it. */
function storage(win) {
  try { return win.localStorage ?? undefined; } catch { return undefined; }
}

/** The choice remembered on this device, if there is one. */
export function storedLocale(win = window) {
  try {
    const value = storage(win)?.getItem(LOCALE_KEY);
    return isLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function rememberLocale(locale, win = window) {
  try { storage(win)?.setItem(LOCALE_KEY, locale); } catch { /* 覚えられなくても動く。次に開いたときまた聞く */ }
}

/**
 * The language to start in, and whether to ask.
 *
 * `?lang=` decides for this visit; then the choice remembered on this device;
 * then the browser's languages — Japanese for `ja*`, English otherwise — and
 * then the question is still asked, because a browser set to English is not
 * the same as a person who chose English.
 */
export function startingLocale(win = window) {
  const asked = new URLSearchParams(win.location?.search ?? '').get('lang');
  if (isLocale(asked)) return { locale: asked, ask: false };
  const stored = storedLocale(win);
  if (stored) return { locale: stored, ask: false };
  return { locale: pickLocale(win.navigator?.languages ?? [win.navigator?.language]), ask: true };
}

/**
 * Asks once which language to use. Both languages are on the question, since
 * the answer is not known yet; the one the browser suggests is offered first
 * and has the focus, so Enter takes it. Closing without choosing takes it too.
 * The answer is remembered either way: asked once means once.
 */
export function askLocale(owner, suggested) {
  return new Promise(resolve => {
    const ja = SHELL_MESSAGES.in('ja');
    const en = SHELL_MESSAGES.in('en');
    const veil = owner.createElement('div');
    veil.className = 'dp-locale-ask';
    veil.setAttribute('role', 'dialog');
    veil.setAttribute('aria-modal', 'true');
    veil.setAttribute('aria-labelledby', 'dp-locale-ask-title');
    veil.style.cssText = 'position:fixed; inset:0; z-index:100; display:flex; align-items:center;'
      + ' justify-content:center; padding:16px; background:rgba(28,31,36,.35);'
      + ' font:13px system-ui, sans-serif; color:#1c1f24;';
    const box = owner.createElement('div');
    box.style.cssText = 'max-width:26em; width:100%; background:#fff; border-radius:8px;'
      + ' padding:20px 22px; box-shadow:0 8px 32px rgba(0,0,0,.25); line-height:1.6;';
    const title = owner.createElement('h2');
    title.id = 'dp-locale-ask-title';
    title.style.cssText = 'font-size:15px; margin:0 0 .5em;';
    title.textContent = `${ja('shell.ask.title')} / ${en('shell.ask.title')}`;
    const say = (text, lang) => {
      const line = owner.createElement('p');
      line.lang = lang;
      line.style.cssText = 'margin:0 0 .4em; color:#5a6270;';
      line.textContent = text;
      return line;
    };
    const row = owner.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; margin-top:1em; flex-wrap:wrap;';
    const done = locale => {
      owner.removeEventListener('keydown', onKey, true);
      veil.remove();
      rememberLocale(locale, owner.defaultView ?? window);
      resolve(locale);
    };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); done(suggested); }
    };
    const order = [suggested, ...LOCALES.filter(locale => locale !== suggested)];
    for (const locale of order) {
      const button = owner.createElement('button');
      button.type = 'button';
      button.lang = locale;
      button.textContent = LOCALE_NAMES[locale];
      button.dataset.locale = locale;
      const first = locale === suggested;
      button.style.cssText = 'font:inherit; padding:.45em 1.2em; border-radius:4px; cursor:pointer;'
        + (first ? ' background:#1f5fa8; color:#fff; border:1px solid #1f5fa8;'
          : ' background:#fff; color:#1c1f24; border:1px solid #c8ccd2;');
      button.addEventListener('click', () => done(locale));
      row.append(button);
    }
    box.append(title, say(ja('shell.ask.text'), 'ja'), say(en('shell.ask.text'), 'en'), row);
    veil.append(box);
    owner.body.append(veil);
    owner.addEventListener('keydown', onKey, true);
    row.querySelector('button')?.focus();
  });
}

/** The switch for the settings panel. Each language is named in itself. */
export function languageSelect(owner, current, onChange) {
  const select = owner.createElement('select');
  for (const locale of LOCALES) {
    const option = owner.createElement('option');
    option.value = locale;
    option.lang = locale;
    option.textContent = LOCALE_NAMES[locale];
    select.append(option);
  }
  select.value = current;
  select.addEventListener('change', () => {
    const chosen = select.value;
    if (!isLocale(chosen)) return;
    rememberLocale(chosen, owner.defaultView ?? window);
    onChange(chosen);
  });
  return select;
}
