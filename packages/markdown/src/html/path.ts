// Path arithmetic on the document's own vocabulary. `node:path` is not
// available in the browser and the paths in a document are always POSIX-style
// regardless of the platform the file is edited on, so the few operations the
// renderer needs are done here on the string.

/** Resolves `path` as written inside the file at `from`. */
export function joinPath(from: string, path: string): string {
  if (path.startsWith('/')) return path;
  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const parts: string[] = [];
  for (const part of `${base}/${path}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join('/');
}
