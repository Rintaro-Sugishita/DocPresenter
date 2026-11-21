// 右クリックメニューの並び順。
//
// VS Code は `group@order` の order で並べ、同じなら表題で並べる。表題は言語で
// 変わるので、order を書かないかぎり**メニューの並びは UI の言語で変わる**。
// 意図した順に出すには、同時に出うる項目どうしに別の order を与えるしかない。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface MenuItem { command: string; when?: string; group?: string }

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { contributes: { menus: Record<string, MenuItem[]> } };

/** その項目が出るのはどんな相手のときか。重なれば同時に並ぶことがある。 */
function targets(when: string | undefined): Set<string> {
  if (when === undefined) return new Set(['*']);
  const out = new Set<string>();
  for (const found of when.matchAll(/resourceExtname\s*==\s*(\.\w+)/g)) out.add(found[1]!);
  if (/explorerResourceIsFolder/.test(when)) out.add('folder');
  return out.size === 0 ? new Set(['*']) : out;
}

const overlap = (a: Set<string>, b: Set<string>): boolean =>
  a.has('*') || b.has('*') || [...a].some(one => b.has(one));

const place = (item: MenuItem): { group: string; order: string } => {
  const at = (item.group ?? '').indexOf('@');
  return at < 0
    ? { group: item.group ?? '', order: '' }
    : { group: item.group!.slice(0, at), order: item.group!.slice(at + 1) };
};

describe('右クリックメニューの並び', () => {
  it('同時に出る項目は、同じ順位を取り合わない', () => {
    const clashes: string[] = [];
    for (const [menu, items] of Object.entries(manifest.contributes.menus)) {
      if (menu === 'commandPalette') continue;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const one = place(items[i]!);
          const other = place(items[j]!);
          if (one.group !== other.group || one.order !== other.order) continue;
          if (!overlap(targets(items[i]!.when), targets(items[j]!.when))) continue;
          clashes.push(`${menu}: ${items[i]!.command} と ${items[j]!.command} が ${items[i]!.group}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('ファイルを右クリックしたら、まず開く', () => {
    // 開くのが目当てで、書き出しと整形はそのあと。整形はファイルを書き換える
    // ので最後に置く——いちばん押しやすい場所に置くものではない。
    const explorer = manifest.contributes.menus['explorer/context']!;
    const dgm = explorer
      .filter(item => item.when?.includes('.dgm'))
      .sort((p, q) => Number(place(p).order) - Number(place(q).order))
      .map(item => item.command);
    expect(dgm).toEqual([
      'docpresenterDiagram.open',
      'docpresenterDiagram.exportSvg',
      'docpresenterDiagram.format',
    ]);
  });
});
