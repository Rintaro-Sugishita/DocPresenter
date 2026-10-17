// A drawing as an SVG file of its own.
//
// `renderDiagram` emits class names rather than colours, and the theme the
// page carries styles them. An SVG saved on its own has no page around it, so
// the part of the theme that styles drawings goes inside it: the theme's
// variables, and every rule written for `.dp-diagram`. Opened in a browser, an
// image viewer or an office program, it looks the way it does in a document.

/** The SVG with the drawing rules of `themeCss` inside it, as a file to save. */
export function standaloneSvg(svg: string, themeCss: string): string {
  const css = drawingRules(themeCss);
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return svg;
  const at = open.index + open[0].length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.slice(0, at)}\n<style>\n${css}\n</style>${svg.slice(at)}\n`;
}

/**
 * The theme's variables and its rules for drawings. A drawing's own rule for
 * `.dp-diagram` sizes it inside a page (`max-width`, `margin`); a file is its
 * own page, so of that rule only the typeface is kept.
 */
export function drawingRules(themeCss: string): string {
  const css = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth > 0) continue;
      const rule = css.slice(start, i + 1).trim();
      start = i + 1;
      const selector = rule.slice(0, rule.indexOf('{')).trim();
      if (selector.startsWith('@')) continue;
      if (selector === ':root') out.push(rule);
      else if (selector === '.dp-diagram') {
        const face = /font-family\s*:\s*([^;}]+)/.exec(rule)?.[1]?.trim();
        if (face) out.push(`.dp-diagram { font-family: ${face}; }`);
      } else if (selectors(selector).every(one => one.startsWith('.dp-diagram '))) out.push(rule);
    }
  }
  return out.join('\n');
}

/** A selector list split at its own commas, not the ones inside `:is(…)`. */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth += 1;
    else if (list[i] === ')') depth -= 1;
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}
