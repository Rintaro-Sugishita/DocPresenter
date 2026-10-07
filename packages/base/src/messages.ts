// The words the shared controls use. See i18n.ts for how messages work.

import { defineMessages } from './i18n.js';

export const BASE_MESSAGES = defineMessages({
  'base.atLine': '{message}（{line} 行目）',
  'base.format.bold': '太字（Ctrl+B）',
  'base.format.italic': '斜体（Ctrl+I）',
  'base.format.code': 'コード',
  'base.format.colour': '文字色',
  'base.swatch.named': '{label}: {name}',
  'base.swatch.pick': '{label}を選ぶ',
  'base.swatch.reset': '解除',
  'base.swatch.resetTitle': '{label}を外す',
  'base.colour.red': '赤',
  'base.colour.blue': '青',
  'base.colour.green': '緑',
  'base.colour.purple': '紫',
  'base.colour.yellow': '黄',
  'base.colour.grey': '灰',
  'base.cancel': 'やめる',
}, {
  'base.atLine': '{message} (line {line})',
  'base.format.bold': 'Bold (Ctrl+B)',
  'base.format.italic': 'Italic (Ctrl+I)',
  'base.format.code': 'Code',
  'base.format.colour': 'Text colour',
  'base.swatch.named': '{label}: {name}',
  'base.swatch.pick': '{label}: choose another',
  'base.swatch.reset': 'Clear',
  'base.swatch.resetTitle': '{label}: remove',
  'base.colour.red': 'red',
  'base.colour.blue': 'blue',
  'base.colour.green': 'green',
  'base.colour.purple': 'purple',
  'base.colour.yellow': 'yellow',
  'base.colour.grey': 'grey',
  'base.cancel': 'Cancel',
});
