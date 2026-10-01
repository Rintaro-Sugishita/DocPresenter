// Rewriting one attribute of an `@import` line.
//
// Dragging a figure wider and pressing "centre" are both, in the end, a change
// to the attributes on one line of the document — and the author may be looking
// at that line in another window. So the rewrite keeps everything it was not
// asked to change: the path as written, the other attributes, their order, and
// the spelling of their quotes.

const LINE = /^(@import\s+"[^"]+"|!\[[^\]]*\]\([^)]+\))\s*(?:\{(.*)\})?\s*$/;

/**
 * Sets an attribute on an `@import` line, or removes it when `value` is
 * undefined. Returns the line unchanged when it is not an import line.
 */
export function setImportAttribute(
  line: string, name: string, value: string | undefined,
): string {
  const found = LINE.exec(line.trim());
  if (!found) return line;
  const head = found[1]!;
  const rest = parts(found[2] ?? '').filter(part => keyOf(part) !== name);
  if (value !== undefined) rest.push(`${name}="${value.replace(/"/g, '')}"`);
  return rest.length === 0 ? head : `${head} {${rest.join(' ')}}`;
}

/** What an import line says for one attribute, or undefined. */
export function importAttribute(line: string, name: string): string | undefined {
  const found = LINE.exec(line.trim());
  if (!found) return undefined;
  for (const part of parts(found[2] ?? '')) {
    if (keyOf(part) !== name) continue;
    const at = part.indexOf('=');
    return at < 0 ? 'true' : part.slice(at + 1).replace(/^"|"$/g, '');
  }
  return undefined;
}

/**
 * Splits an attribute block into its parts, keeping each one spelled as it was
 * written. A quoted value may hold spaces, so this cannot be a split on space.
 */
function parts(source: string): string[] {
  const found: string[] = [];
  const token = /#[A-Za-z0-9_-]+|[\w-]+\s*=\s*"[^"]*"|[\w-]+\s*=\s*\S+|[\w-]+/g;
  for (let m = token.exec(source); m; m = token.exec(source)) found.push(m[0]);
  return found;
}

/** The name a part sets, or undefined for a bare label such as `#fig-a`. */
function keyOf(part: string): string | undefined {
  if (part.startsWith('#')) return undefined;
  const at = part.indexOf('=');
  return (at < 0 ? part : part.slice(0, at)).trim();
}
