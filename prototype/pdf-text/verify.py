# Verifies that the generated PDFs expose their Japanese text to extraction.
# PDFium is the engine Chrome uses to display PDFs, so what it can extract is
# what a reviewer can select and highlight.
import sys, unicodedata
import pypdfium2 as pdfium

EXPECTED = [
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
]

def norm(s):
    return ''.join(s.split())

def check(path):
    print(f'\n===== {path} =====')
    doc = pdfium.PdfDocument(path)
    page = doc[0]
    pdfium_text = page.get_textpage().get_text_range()

    for engine, text in (('PDFium (Chrome)', pdfium_text),):
        flat = norm(text)
        ok = sum(1 for line in EXPECTED if norm(line) in flat)
        mark = 'OK  ' if ok == len(EXPECTED) else 'NG  '
        print(f'  {mark}{engine:<18} {ok}/{len(EXPECTED)} 行が一致')
        if ok != len(EXPECTED):
            for line in EXPECTED:
                if norm(line) not in flat:
                    print(f'        欠落: {line}')

    # search: what a reviewer would actually do
    needle = 'アクセストークン'
    sp = page.get_textpage().search(needle)
    hit = sp.get_next()
    print(f'  {"OK  " if hit else "NG  "}検索 "{needle}" → {"見つかった " + str(hit) if hit else "見つからない"}')

    # first extracted line, to eyeball encoding
    first = pdfium_text.strip().splitlines()[0] if pdfium_text.strip() else '(空)'
    print(f'  抽出の先頭行: {first!r}')

    # render to PNG so the glyphs can be inspected visually (tofu check)
    img = page.render(scale=2).to_pil()
    out = path.replace('.pdf', '.png')
    img.save(out)
    print(f'  画像化: {out}')

for p in sys.argv[1:]:
    check(p)
