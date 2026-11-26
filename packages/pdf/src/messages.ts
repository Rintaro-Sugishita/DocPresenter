// The PDF engine's words. See packages/base/src/i18n.ts for how messages work.

import { defineMessages } from '@docpresenter/base';

export const PDF_MESSAGES = defineMessages({
  'pdf.image': 'PDF に入れられない画像があります: {src}',
  'pdf.tooTall': '1 ページに収まらない要素があります（高さ {height}px）',
  'pdf.subset.memory': 'フォントを読み込む領域を確保できません',
  'pdf.subset.input': 'サブセットの指定を作れません',
  'pdf.subset.failed': 'フォントを削れません（壊れているか、フォントの番号が違います）',
  'pdf.font.cff': '{name} は CFF フォントのため、pdf-lib のサブセット化では文字が描かれません。subset を渡してください（design/pdf-engine.md §6.4）',
  'pdf.font.empty': '{name} を削った結果に字形が入っていません（{count} 字は多すぎる可能性があります）',
  'pdf.review.notLast': '{path} は comments: が最後の項目ではないため、追記できません',
  'pdf.review.reviewer': '指摘',
  'pdf.review.answer': '回答',
  'pdf.review.status.open': '未対応',
  'pdf.review.status.resolved': '対応済み',
  'pdf.review.status.wontfix': '対応しない',
  'pdf.review.status.question': '質問',
  'pdf.review.label.status': '【状態】',
  'pdf.review.label.answer': '【回答】',
  'pdf.review.label.reply': '【返信（{author}）】',
}, {
  'pdf.image': 'An image cannot go into the PDF: {src}',
  'pdf.tooTall': 'Something does not fit on one page ({height}px tall)',
  'pdf.subset.memory': 'No room to load the font',
  'pdf.subset.input': 'Cannot set up the subset',
  'pdf.subset.failed': 'Cannot cut the font down (it is broken, or the face number is wrong)',
  'pdf.font.cff': '{name} is a CFF font, and pdf-lib\'s subsetting draws no glyphs from it. Pass subset (design/pdf-engine.md §6.4)',
  'pdf.font.empty': 'Cutting {name} down left no glyphs in it ({count} characters may be too many)',
  'pdf.review.notLast': '{path} does not end with comments:, so nothing can be appended to it',
  'pdf.review.reviewer': 'Comment',
  'pdf.review.answer': 'Answer',
  'pdf.review.status.open': 'Open',
  'pdf.review.status.resolved': 'Resolved',
  'pdf.review.status.wontfix': "Won't fix",
  'pdf.review.status.question': 'Question',
  'pdf.review.label.status': '[Status] ',
  'pdf.review.label.answer': '[Answer] ',
  'pdf.review.label.reply': '[Reply ({author})] ',
});

export const pdf = PDF_MESSAGES.phrase;
