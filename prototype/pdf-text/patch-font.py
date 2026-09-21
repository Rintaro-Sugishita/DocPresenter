# Maps U+20BB7 onto an existing glyph so that a supplementary-plane codepoint
# can be tested independently of whether any installed font carries the glyph.
# Only format 12 subtables can hold codepoints above the BMP.
from fontTools.ttLib import TTFont

f = TTFont('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf')
glyph = f.getBestCmap()[0x5409]           # 吉 — stands in for 𠮷
n = 0
for t in f['cmap'].tables:
    if t.format == 12:
        t.cmap[0x20BB7] = glyph
        n += 1
f.save('ipag-ext.ttf')
print(f'format 12 サブテーブル {n} 個に U+20BB7 → {glyph} を追加')
