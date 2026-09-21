# Extracts Noto Sans CJK JP from the collection, since pdf-lib embeds font bytes
# and cannot select a face out of a .ttc itself.
from fontTools.ttLib import TTCollection
c = TTCollection('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
for f in c.fonts:
    ps = {n.toUnicode() for n in f['name'].names if n.nameID == 6}
    if any(n.startswith('NotoSansCJKjp') for n in ps):
        f.save('NotoSansCJKjp-Regular.otf')
        print('抽出:', sorted(ps)[0], '→ NotoSansCJKjp-Regular.otf')
        break
