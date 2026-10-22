// The faces a PDF is written in, from this machine.
//
// A PDF carries its own fonts (design/pdf-engine.md), and the command line
// ships none: a Japanese face is several megabytes, and every desktop already
// has one. The same places the VS Code extension looks
// (packages/app-vscode/src/pdf-fonts.ts); `--font` or DOCPRESENTER_FONT names
// one instead, for everything.

import { readFileSync } from 'node:fs';
import type { FontSet, FontSource } from '@docpresenter/pdf';
import { CliError } from '@docpresenter/dgm';

interface Face { readonly file: string; readonly index?: number }

const BODY: Readonly<Record<string, readonly Face[]>> = {
  win32: [
    { file: 'C:\\Windows\\Fonts\\YuGothR.ttc' },
    { file: 'C:\\Windows\\Fonts\\meiryo.ttc' },
    { file: 'C:\\Windows\\Fonts\\msgothic.ttc' },
  ],
  darwin: [
    { file: '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc' },
    { file: '/System/Library/Fonts/Hiragino Sans GB.ttc' },
    { file: '/Library/Fonts/Arial Unicode.ttf' },
  ],
  linux: [
    { file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', index: 0 },
    { file: '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf' },
    { file: '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf' },
  ],
};

/** Monospaced faces for code. The first face of MS Gothic is the fixed-pitch one. */
const MONO: Readonly<Record<string, readonly Face[]>> = {
  win32: [{ file: 'C:\\Windows\\Fonts\\msgothic.ttc' }],
  darwin: [{ file: '/System/Library/Fonts/Osaka.ttf' }],
  linux: [{ file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', index: 5 }],
};

function read(face: Face): FontSource | undefined {
  try {
    const bytes = new Uint8Array(readFileSync(face.file));
    const name = face.file.slice(Math.max(face.file.lastIndexOf('/'), face.file.lastIndexOf('\\')) + 1);
    return { bytes, name, ...(face.index === undefined ? {} : { faceIndex: face.index }) };
  } catch { return undefined; }
}

/** The faces to embed, and a name for them to report. */
export function pdfFonts(given?: string): { set: FontSet; name: string } {
  const named = given ?? process.env['DOCPRESENTER_FONT'];
  if (named) {
    // A font that was named and cannot be read is a mistake, not a reason to
    // write the PDF in a face nobody chose.
    const one = read({ file: named });
    if (!one) throw new CliError('usage', 'doc.fontMissing', { path: named });
    return { set: { body: one, bodyBold: one, heading: one, headingBold: one, mono: one }, name: one.name };
  }
  const platform = process.platform in BODY ? process.platform : 'linux';
  const body = BODY[platform]!.map(read).find(Boolean);
  if (!body) throw new CliError('content', 'doc.noFont');
  const mono = (MONO[platform] ?? []).map(read).find(Boolean) ?? body;
  return {
    set: { body, bodyBold: body, heading: body, headingBold: body, mono },
    name: mono === body ? body.name : `${body.name} ＋ ${mono.name}`,
  };
}
