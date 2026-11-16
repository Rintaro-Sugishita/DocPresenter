// Just enough XML for the parts of a workbook: elements, attributes and text.
//
// A workbook's XML is machine-written and plain — no DTDs, no entities beyond
// the five and numeric ones — so a small reader is enough, and it keeps the
// extension free of a parser it would carry for this alone. Prefixes are
// dropped (`x:c` and `c` are the same element), because writers differ in
// whether they use one.

export interface XmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlNode[];
  /** The text directly inside, entities decoded. */
  text: string;
}

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#document', attributes: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  let at = 0;
  for (let found = tag.exec(source); found; found = tag.exec(source)) {
    const top = stack[stack.length - 1]!;
    if (found.index > at) top.text += decode(source.slice(at, found.index));
    at = tag.lastIndex;
    if (found[5] !== undefined) { top.text += found[5]; continue; }
    const [, closing, rawName, rawAttributes = '', selfClosing] = found;
    if (rawName === undefined) continue;
    const name = local(rawName);
    if (closing) {
      while (stack.length > 1 && stack.pop()!.name !== name) { /* 閉じ忘れは無視して戻る */ }
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const pair of rawAttributes.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes[local(pair[1]!)] = decode(pair[2] ?? pair[3] ?? '');
    }
    const node: XmlNode = { name, attributes, children: [], text: '' };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function local(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      return String.fromCodePoint(entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()]!;
  });
}

/** The first child with this name, anywhere below when `deep`. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find(one => one.name === name);
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter(one => one.name === name) ?? [];
}

/** Every descendant with this name, in document order. */
export function descendants(node: XmlNode | undefined, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (at: XmlNode): void => {
    for (const one of at.children) {
      if (one.name === name) out.push(one);
      walk(one);
    }
  };
  if (node) walk(node);
  return out;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Characters XML 1.0 does not allow at all.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
