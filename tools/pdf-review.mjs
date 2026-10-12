// Takes reviewers' PDF annotations into review files.
//
// Usage: node tools/pdf-review.mjs <annotated.pdf>... [--in <workspace>] [--into <reviews/x.review.yml>] [--write]
//
// Any number of PDFs, one per document of a round: each says which document it
// is, so each comment lands on its own. Replies to the comments a PDF was sent
// with go under those comments in their review files; new comments are
// appended to one review file (a new one for the round by default). Without
// --write nothing is touched: what would be written is printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { appendReplies, appendReview, planImport, readReviewPdf, resolveAnnotations } from '../packages/pdf/dist/index.js';

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
const into0 = option('--into', undefined);
const pdfs = argv;
if (pdfs.length === 0) {
  console.error('使い方: node tools/pdf-review.mjs <注釈付き.pdf>... [--in <作業場>] [--into <reviews/x.review.yml>] [--write]');
  process.exit(2);
}
const stem = pdfs.length === 1 ? basename(pdfs[0]).replace(/\.pdf$/i, '') : 'review';
const today = new Date().toISOString().slice(0, 10);
const into = into0 ?? `reviews/${today}-${stem}.review.yml`;
const line = text => text.replace(/\s+/g, ' ').slice(0, 80);

// Read and sort every PDF first: ours are left out, replies go to the
// comments they answer, the rest are new comments.
const reads = [];
for (const pdf of pdfs) {
  const review = await readReviewPdf(new Uint8Array(readFileSync(pdf)));
  const plan = planImport(resolveAnnotations(review), review.map?.written);
  reads.push({ pdf: pdf.split('\\').join('/'), review, plan });
  console.log(`== ${pdf}${review.map ? `（文書 ${review.map.document}、文書番号 ${review.map.number ?? '—'}）` : ''}`);
  if (!review.map) console.log('! この PDF には DocPresenter の対応表が無い。指摘は場所を持たずに orphaned として入る');
  if (plan.ours) console.log(`PDF に載せていた指摘と回答 ${plan.ours} 件は取り込まない`);
  for (const [round, list] of plan.replies) for (const reply of list) console.log(`${round} #${reply.id} への返信: ${line(reply.body)}`);
  for (const one of plan.fresh) {
    const where = one.anchor ? `${one.anchor.file} ${one.anchor.start}–${one.anchor.end}` : '（場所なし）';
    console.log(`p.${one.annotation.page} ${one.annotation.kind}　[${one.precision}] ${where}`);
    if (one.anchor) console.log(`    「${line(one.anchor.quote)}」`);
    if (one.annotation.body) console.log(`    ${line(one.annotation.body)}`);
  }
}

// Replies, by the review file each comment is in.
const replies = new Map();
for (const { plan } of reads) for (const [round, list] of plan.replies) replies.set(round, [...(replies.get(round) ?? []), ...list]);
for (const [round, list] of replies) {
  const path = join(root, round);
  if (!existsSync(path)) { console.log(`! ${round} が無いので、返信 ${list.length} 件を入れられない`); continue; }
  const placed = appendReplies(readFileSync(path, 'utf8'), list);
  console.log(`${round}　返信 ${placed.added} 件を追加${placed.skipped ? `、${placed.skipped} 件は除く（取り込み済みか、指摘が無い）` : ''}`);
  if (placed.added > 0 && write) writeFileSync(path, placed.text);
}

// New comments, each PDF's with its own document, number and commit.
const target = join(root, into);
const before = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
let text = before;
let added = 0;
let skipped = 0;
for (const { pdf, review, plan } of reads) {
  if (plan.fresh.length === 0) continue;
  const appended = appendReview(text, plan.fresh, {
    round: `${stem} へのレビュー`,
    pdf,
    document: review.map?.document ?? pdf,
    number: review.map?.number,
    commit: review.map?.commit ?? review.commit,
    clean: review.map?.clean,
    path: into,
  });
  if (appended.added > 0) text = appended.text;
  added += appended.added;
  skipped += appended.skipped;
}
console.log(`${into}　${added} 件を追加${skipped ? `、前に取り込んだ ${skipped} 件は除く` : ''}`);
if (added === 0) process.exit(0);
if (write) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
} else {
  console.log(text.slice((before ?? '').length));
  console.log('（--write を付けると書き込みます）');
}
