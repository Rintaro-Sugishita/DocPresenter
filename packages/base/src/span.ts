// A byte range in the source, and nothing else.
//
// Every edit in this project is the replacement of one byte range, so the type
// that says what a range is belongs under everything else rather than inside
// the document model that happened to need it first.

/** A half-open byte range in the UTF-8 encoding of the source. */
export interface ByteSpan {
  readonly start: number;
  readonly end: number;
}
