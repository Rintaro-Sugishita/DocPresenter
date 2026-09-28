// Escaping for the markup both renderers write. HTML and SVG are the same
// family, so the rule is the same one, and one copy of it is enough.

export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
