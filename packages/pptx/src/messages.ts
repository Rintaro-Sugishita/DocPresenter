// The PPTX writer's words. See packages/base/src/i18n.ts for how messages work.

import { defineMessages } from '@docpresenter/base';

export const PPTX_MESSAGES = defineMessages({
  'pptx.part': '部品の絵は PPTX にまだ出せない: {id}',
  'pptx.tabs': 'タブの見出しは PPTX にまだ出せない: {id}',
  'pptx.scroll': 'スクロールの印は PPTX にまだ出せない: {id}',
  'pptx.unnamed': 'スライド {index}: どの図から作られたか分からない（名前が失われている）',
}, {
  'pptx.part': 'Part pictures cannot go into PPTX yet: {id}',
  'pptx.tabs': 'Tab headings cannot go into PPTX yet: {id}',
  'pptx.scroll': 'Scroll marks cannot go into PPTX yet: {id}',
  'pptx.unnamed': 'Slide {index}: cannot tell which diagram it was made from (its name was lost)',
});
