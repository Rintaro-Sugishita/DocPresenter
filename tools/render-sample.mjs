// Renders the planning sample to standalone HTML so the pipeline can be seen
// working end to end.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseDocument, renderDocument, resolveDocument } from '../packages/markdown/dist/index.js';

const path = 'sample/docs/auth-design.md';
const source = readFileSync(path, 'utf8');
const doc = parseDocument(source);
const resolved = resolveDocument(doc);

for (const d of resolved.diagnostics) console.log(`  ${d.severity}: ${d.message}`);
console.log(`要素 ${resolved.elements.length} 件 / 診断 ${resolved.diagnostics.length} 件`);

const body = renderDocument(doc, resolved, {
  loader: {
    read(p) {
      try { return readFileSync(resolve(dirname(path), p), 'utf8'); } catch { return undefined; }
    },
    // 出力先が sample/ の外なので、画像は絶対パスで指す。
    url: p => resolve(dirname(path), p),
  },
});

const title = String(doc.frontmatter.raw.title ?? '');
const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<title>${title}</title>
<link rel="stylesheet" href="../themes/default/theme.css">
</head><body>
${body}
</body></html>`;

mkdirSync('out', { recursive: true });
writeFileSync('out/auth-design.html', html);
console.log('out/auth-design.html を生成');
