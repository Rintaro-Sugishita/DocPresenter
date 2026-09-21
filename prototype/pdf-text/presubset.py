# pdf-lib's own subsetting breaks CFF/CID-keyed fonts such as Noto Sans CJK:
# the text extracts correctly but no glyph is drawn. Subsetting the font
# ourselves beforehand, then embedding it whole, avoids pdf-lib's subsetter.
from fontTools import subset
import sys

TEXT = ''.join([
  '認証機能 設計書',
  '𠮷野・𠮟責・𩸽（CJK 拡張 B）',
  '髙﨑・彅・俱・剝（環境依存文字・JIS 第 3 水準）',
  '㋿ 元年 ①②③ ＡＢＣ １２３ ※§¶',
  'パスワードは 8 文字以上、英大文字・小文字・数字・記号を各 1 文字以上。',
])
opts = subset.Options()
opts.layout_features = ['*']      # keep vertical/proportional features
opts.notdef_outline = True
font = subset.load_font('NotoSansCJKjp-Regular.otf', opts)
subsetter = subset.Subsetter(options=opts)
subsetter.populate(text=TEXT)
subsetter.subset(font)
subset.save_font(font, 'noto-sub.otf', opts)
print(f'事前サブセット: {len(set(TEXT))} 字 → noto-sub.otf')
