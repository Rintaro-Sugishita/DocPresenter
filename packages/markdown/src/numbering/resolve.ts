// Assigns numbers and resolves references within one document. Numbering is
// per document, so a shared element takes its number from whichever document
// includes it.

import type { Block, DocumentFile, Import, Reference } from '../document/model.js';
import { DEFAULT_LOCALE, type Locale } from '@docpresenter/base';
import {
  KIND_BY_PREFIX,
  type Diagnostic, type ElementKind, type NumberedElement, type ResolvedDocument,
} from './model.js';
import { MARKDOWN_MESSAGES } from '../messages.js';

/** Attributes an import may carry. Anything else is a mistake worth reporting. */
const KNOWN_ATTRIBUTES = new Set([
  '#', 'alt', 'caption', 'page', 'rows', 'keep-together', 'slide', 'width', 'height', 'align',
  // A Mermaid file: its drawing, its code, or both.
  'view',
]);

/** Extensions that decide the kind of an unlabelled import. */
const FIGURE_EXTENSIONS = ['.dgm', '.mmd', '.ermlx', '.svg', '.png', '.jpg', '.jpeg', '.gif'];
const TABLE_EXTENSIONS = ['.table', '.csv'];

/**
 * `locale` is the language the numbers read in — 図 2 or Figure 2 — and the
 * diagnostics are written in. It is the locale of whoever builds.
 */
export function resolveDocument(document: DocumentFile, locale: Locale = DEFAULT_LOCALE): ResolvedDocument {
  const t = MARKDOWN_MESSAGES.in(locale);
  const elements: NumberedElement[] = [];
  const byLabel = new Map<string, NumberedElement>();
  const diagnostics: Diagnostic[] = [];

  // Figures and tables run sequentially; sections nest.
  let figures = 0;
  let tables = 0;
  const sectionCounters: number[] = [];

  const titleBlock = document.blocks[0]?.kind === 'heading' && document.blocks[0].level === 1
    ? document.blocks[0]
    : undefined;

  for (const block of document.blocks) {
    const element = numberBlock(block);
    if (!element) continue;
    elements.push(element);

    if (element.label === undefined) continue;
    const existing = byLabel.get(element.label);
    if (existing) {
      diagnostics.push({
        severity: 'error',
        message: t('markdown.duplicateLabel', { label: element.label }),
        span: block.span,
      });
      continue;
    }
    byLabel.set(element.label, element);
  }

  const referenceText = new Map<number, string>();
  for (const block of document.blocks) {
    const references: readonly Reference[] =
      block.kind === 'prose' || block.kind === 'heading' ? block.references : [];
    for (const reference of references) {
      if (reference.document !== undefined) continue;   // resolved across documents later
      const target = byLabel.get(reference.label);
      if (!target) {
        diagnostics.push({
          severity: 'error',
          message: t('markdown.missing', { target: `@${reference.label}` }),
          span: reference.span,
        });
        continue;
      }
      referenceText.set(reference.span.start, describe(target, locale));
    }
  }

  return { elements, byLabel, referenceText, diagnostics, locale };

  function numberBlock(block: Block): NumberedElement | undefined {
    if (block.kind === 'heading') {
      if (block === titleBlock) {
        // The document's own title is not a numbered section.
        return { kind: 'section', label: block.label, number: undefined, caption: block.text, block };
      }
      const depth = titleBlock ? block.level - 1 : block.level;
      return {
        kind: kindOfLabel(block.label) ?? 'section',
        label: block.label,
        number: nextSectionNumber(Math.max(1, depth)),
        caption: block.text,
        block,
      };
    }

    if (block.kind !== 'import') return undefined;
    for (const name of block.attributes.keys()) {
      if (!KNOWN_ATTRIBUTES.has(name)) {
        diagnostics.push({
          severity: 'warning',
          message: t('markdown.unknownAttribute', { name }),
          span: block.span,
        });
      }
    }
    const kind = kindOfImport(block, diagnostics, locale);
    const caption = block.attributes.get('caption') ?? block.attributes.get('alt');
    if (kind === 'figure') return { kind, label: block.label, number: String(++figures), caption, block };
    if (kind === 'table') return { kind, label: block.label, number: String(++tables), caption, block };
    return { kind, label: block.label, number: undefined, caption, block };
  }

  function nextSectionNumber(depth: number): string {
    sectionCounters.length = Math.max(sectionCounters.length, depth);
    sectionCounters[depth - 1] = (sectionCounters[depth - 1] ?? 0) + 1;
    for (let i = depth; i < sectionCounters.length; i++) sectionCounters[i] = 0;
    return sectionCounters.slice(0, depth).join('.');
  }
}

function kindOfLabel(label: string | undefined): ElementKind | undefined {
  if (!label) return undefined;
  const prefix = label.slice(0, label.indexOf('-'));
  return KIND_BY_PREFIX.get(prefix);
}

/** The label's prefix wins; the extension decides when there is no label. */
function kindOfImport(block: Import, diagnostics: Diagnostic[], locale: Locale): ElementKind {
  const byExtension = kindOfPath(block.path);
  const byLabel = kindOfLabel(block.label);
  if (byLabel && byExtension && byLabel !== byExtension) {
    diagnostics.push({
      severity: 'warning',
      message: MARKDOWN_MESSAGES.in(locale)('markdown.kindMismatch', { label: block.label ?? '', path: block.path }),
      span: block.span,
    });
  }
  return byLabel ?? byExtension ?? 'other';
}

function kindOfPath(path: string): ElementKind | undefined {
  const lower = path.toLowerCase();
  if (FIGURE_EXTENSIONS.some(e => lower.endsWith(e))) return 'figure';
  if (TABLE_EXTENSIONS.some(e => lower.endsWith(e))) return 'table';
  return undefined;
}

/** Renders a reference as it reads in running text, e.g. `図 2` or `3.2 節`. */
export function describe(element: NumberedElement, locale: Locale = DEFAULT_LOCALE): string {
  const { number } = element;
  if (number === undefined) return element.caption ?? '';
  const t = MARKDOWN_MESSAGES.in(locale);
  if (element.kind === 'figure') return t('markdown.noun.figure', { number });
  if (element.kind === 'table') return t('markdown.noun.table', { number });
  if (element.kind === 'section') return t('markdown.noun.section', { number });
  return number;
}
