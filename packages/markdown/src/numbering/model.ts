// Numbering and reference resolution. Numbers are computed on every build and
// never stored, so a number written into the source would go stale; references
// are therefore written as labels and resolved here.

import type { Locale } from '@docpresenter/base';
import type { Block, ByteSpan } from '../document/model.js';

export type ElementKind =
  | 'figure' | 'table' | 'section'
  | 'requirement' | 'design' | 'test'
  | 'other';

/** Label prefixes decide the kind of the element they mark. */
export const KIND_BY_PREFIX: ReadonlyMap<string, ElementKind> = new Map([
  ['fig', 'figure'], ['tbl', 'table'], ['sec', 'section'],
  ['req', 'requirement'], ['des', 'design'], ['tst', 'test'],
]);


export interface NumberedElement {
  readonly kind: ElementKind;
  readonly label: string | undefined;
  /** `2` for figures and tables, `3.2` for sections, undefined when unnumbered. */
  readonly number: string | undefined;
  readonly caption: string | undefined;
  readonly block: Block;
}

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly span: ByteSpan;
}

export interface ResolvedDocument {
  readonly elements: readonly NumberedElement[];
  readonly byLabel: ReadonlyMap<string, NumberedElement>;
  /** Text to substitute for each reference, keyed by its byte start. */
  readonly referenceText: ReadonlyMap<number, string>;
  readonly diagnostics: readonly Diagnostic[];
  /** The language the reference text and the diagnostics were written in. */
  readonly locale: Locale;
}

export function hasError(resolved: ResolvedDocument): boolean {
  return resolved.diagnostics.some(d => d.severity === 'error');
}
