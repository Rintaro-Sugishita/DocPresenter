// Takes a reviewer's PDF annotations into a review file.
//
// Usage: node tools/pdf-review.mjs <annotated.pdf> [--in <workspace>] [--into <reviews/x.review.yml>] [--write]
//
// Without --write nothing is touched: each annotation is listed with where it
// was traced to, and the entries that would be appended are printed. With it,
// they are appended to the review file (a new one for the round by default).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { appendReview, readReviewPdf, resolveAnnotations } from '../packages/pdf/dist/index.js';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  if (at < 0) return fallback;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value ?? fallback;
};
const flag = name => {
  const at = argv.indexOf(name);
  if (at < 0) return false;
  argv.splice(at, 1);
  return true;
};

const root = option('--in', '.');
const write = flag('--write');
const pdfPath = argv[0];
if (!pdfPath) {
  console.error('使い方: node tools/pdf-review.mjs <注釈付き.pdf> [--in <作業場>] [--into <reviews/x.review.yml>] [--write]');
  process.exit(2);
}
const stem = basename(pdfPath).replace(/\.pdf$/i, '');
const today = new Date().toISOString().slice(0, 10);
const into = option('--into', `reviews/${today}-${stem}.review.yml`);

const review = await readReviewPdf(new Uint8Array(readFileSync(pdfPath)));
const resolved = resolveAnnotations(review);
if (!review.map) console.log('! この PDF には DocPresenter の対応表が無い。指摘は場所を持たずに orphaned として入る');
for (const one of resolved) {
  const where = one.anchor ? `${one.anchor.file} ${one.anchor.start}–${one.anchor.end}` : '（場所なし）';
  console.log(`p.${one.annotation.page} ${one.annotation.kind}　[${one.precision}] ${where}`);
  if (one.anchor) console.log(`    「${one.anchor.quote.replace(/\s+/g, ' ').slice(0, 80)}」`);
  if (one.annotation.body) console.log(`    ${one.annotation.body.replace(/\s+/g, ' ').slice(0, 80)}`);
}

const target = join(root, into);
const before = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
const appended = appendReview(before, resolved, {
  round: `${stem} へのレビュー`,
  pdf: pdfPath.split('\\').join('/'),
  document: review.map?.document ?? pdfPath,
  commit: review.map?.commit ?? review.commit,
  clean: review.map?.clean,
  path: into,
});
console.log(`${into}　${appended.added} 件を追加${appended.skipped ? `、前に取り込んだ ${appended.skipped} 件は除く` : ''}`);
if (appended.added === 0) process.exit(0);
if (write) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, appended.text);
} else {
  console.log(appended.text.slice((before ?? '').length));
  console.log('（--write を付けると書き込みます）');
}
