// The faces a PDF is written in, from this machine.
//
// A PDF carries its own fonts (design/pdf-engine.md), and the extension ships
// none: a Japanese face is several megabytes, and every desktop already has
// one. So the faces are found where each system keeps them — the same places
// the CLI looks (tools/pdf-writer.mjs) — and code gets a monospaced face of
// its own, because the page was laid out with one.

import { readFile } from 'node:fs/promises';
import type { FontSet, FontSource } from '@docpresenter/pdf';
import { t } from './l10n.js';

interface Face { readonly file: string; readonly index?: number }

/** Body faces, best first. A collection names the face it means by index. */
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

async function first(faces: readonly Face[]): Promise<FontSource | undefined> {
  for (const face of faces) {
    try {
      const bytes = new Uint8Array(await readFile(face.file));
      const name = face.file.slice(Math.max(face.file.lastIndexOf('/'), face.file.lastIndexOf('\\')) + 1);
      return { bytes, name, ...(face.index === undefined ? {} : { faceIndex: face.index }) };
    } catch { /* 次の候補 */ }
  }
  return undefined;
}

/** The faces to embed, and a name for them to report. Throws when there is none. */
export async function systemFonts(): Promise<{ set: FontSet; name: string }> {
  const platform = process.platform in BODY ? process.platform : 'linux';
  const body = await first(BODY[platform]!);
  if (!body) {
    throw new Error(t('vscode.export.noFont'));
  }
  const mono = (await first(MONO[platform] ?? [])) ?? body;
  return {
    set: { body, bodyBold: body, heading: body, headingBold: body, mono },
    name: mono === body ? body.name : `${body.name} ＋ ${mono.name}`,
  };
}
