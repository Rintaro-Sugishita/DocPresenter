// Cross-checks extraction with pdf.js, the engine Firefox uses to display PDFs.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';

const EXPECTED = [
  '認証機能 設計書',
  'パスワードは 8 文字以上、英大文字・小文字・数字・記号を各 1 文字以上。',
  'セッションキャッシュ（Redis）に発行済みトークンを保持する。',
  'ひらがな カタカナ 漢字 ＡＢＣ １２３ ①②③ ※§¶',
];
const flat = s => s.replace(/\s+/g, '');

for (const file of process.argv.slice(2)) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map(i => i.str).join('');
  console.log(`\n===== ${file} =====`);
  console.log(`  抽出: ${text.slice(0, 60)}…`);
  for (const e of EXPECTED) {
    const ok = flat(text).includes(flat(e));
    if (file.includes('ext') && !e.includes('認証機能')) continue;
    console.log(`  ${ok ? 'OK  ' : 'NG  '}${e}`);
  }
}
