// The one inline Markdown implementation.
//
// Prose and table cells used to have their own: prose went through
// markdown-it, and a cell went through a short chain of regular expressions.
// They agreed on the simple cases and parted company on the rest — a coloured
// run inside another one parsed in the prose and came out as its own notation
// in a cell. Two implementations of the same notation will always drift; there
// is one now, and a cell is simply the inline half of it.

import MarkdownIt from 'markdown-it';
import { bracketedSpan } from './span.js';

// `breaks: true`: a line break in the source is a line break in the output.
// A design document is written in short lines on purpose, and silently joining
// them would make the rendered text disagree with the file a reviewer reads.
export const markdown = new MarkdownIt({
  html: true, linkify: false, typographer: false, breaks: true,
}).use(bracketedSpan);
