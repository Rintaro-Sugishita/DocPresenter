// Whether a name can be a file name, on every platform a repository is checked out on.

/** Characters no file name may hold on Windows, where they are the strictest. */
const FORBIDDEN = /[<>:"\\|?*\u0000-\u001f]/;
/** Names Windows keeps for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Why a name cannot be a file name, or undefined when it can. A `/` divides
 * folders, each of which must be a name too. Upper case, spaces and Japanese
 * are all fine; what is refused is what one of the platforms would refuse.
 */
export function nameProblem(name: string): 'empty' | 'characters' | 'reserved' | 'ending' | undefined {
  const parts = name.split('/');
  if (name.trim() === '' || parts.some(part => part.trim() === '')) return 'empty';
  for (const part of parts) {
    if (FORBIDDEN.test(part)) return 'characters';
    if (RESERVED.test(part) || part === '.' || part === '..') return 'reserved';
    if (/[. ]$/.test(part) || /^ /.test(part)) return 'ending';
  }
  return undefined;
}
