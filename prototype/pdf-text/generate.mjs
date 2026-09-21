// Generates a PDF containing Japanese text with pdf-lib, to verify that the
// embedded subset font keeps the text selectable, searchable and copyable.
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, writeFileSync } from 'node:fs';

const FONT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf';

// Lines drawn from the sample design document, to exercise the character set
// this product actually has to render.
const LINES = [
  '認証機能 設計書',
  'ログイン時の画面遷移を図 2 に示す。',
  '本書は、会員向け Web サービスにおける認証機能の設計を示す。',
  'アクセストークンの有効期限は 24 時間とする。',
  'パスワードは 8 文字以上、英大文字・小文字・数字・記号を各 1 文字以上。',
  'セッションキャッシュ（Redis）に発行済みトークンを保持する。',
  '表 1 ログイン画面 項目定義',
  '分類｜項目名｜型｜必須｜説明',
  '髙﨑・𠮷野・彅（環境依存文字）',
  'ひらがな カタカナ 漢字 ＡＢＣ １２３ ①②③ ※§¶',
];

async function build({ subset }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(readFileSync(FONT), { subset });

  pdf.setTitle('認証機能 設計書');
  pdf.setSubject('DocPresenter プロトタイプ');
  pdf.setKeywords(['commit:a3f9c21']);   // review-model 3.3: embed the source commit

  const page = pdf.addPage([595, 842]);  // A4
  let y = 780;
  for (const line of LINES) {
    page.drawText(line, { x: 60, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 28;
  }
  const bytes = await pdf.save();
  const name = `out-${subset ? 'subset' : 'full'}.pdf`;
  writeFileSync(name, bytes);
  return { name, size: bytes.length };
}

for (const subset of [true, false]) {
  const r = await build({ subset });
  console.log(`${r.name.padEnd(18)} subset=${String(subset).padEnd(5)} ${(r.size / 1024).toFixed(1)} KB`);
}
