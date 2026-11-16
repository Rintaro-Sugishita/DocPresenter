// The four marks added to the inline notation, as PowerPoint's own run
// properties: a slide is edited in PowerPoint, so a struck word stays struck.

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { parseRuns } from '@docpresenter/diagram';
import { writePptx } from '../src/index.js';

describe('取り消し線・上付き・下付き・下線（PPTX）', () => {
  it('run の属性として書く', () => {
    const runs = parseRuns('H~2~O と x^2^ と ~~消す~~ と [下線]{.underline}');
    const files = unzipSync(writePptx({
      title: '書式', slides: [{ title: '書式', blocks: [{ kind: 'text', paragraphs: [runs] }] }], diagnostics: [],
    }));
    const slide = strFromU8(files['ppt/slides/slide1.xml']!);
    expect(slide).toMatch(/<a:rPr[^>]*baseline="-25000"[^>]*>.*?<a:t>2<\/a:t>/);
    expect(slide).toMatch(/<a:rPr[^>]*baseline="30000"[^>]*>.*?<a:t>2<\/a:t>/);
    expect(slide).toMatch(/<a:rPr[^>]*strike="sngStrike"[^>]*>.*?<a:t>消す<\/a:t>/);
    expect(slide).toMatch(/<a:rPr[^>]*u="sng"[^>]*>.*?<a:t>下線<\/a:t>/);
  });
});
