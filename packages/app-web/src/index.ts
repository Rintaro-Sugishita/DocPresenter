// The web viewer: a document on a Git host, set as DocPresenter sets it, with
// no server in between (design/web-viewer.md).
//
// The page itself starts from `./viewer` (tools/build-web-viewer.mjs): this
// index also brings in the font reader, which the page loads only for a PDF.

export * from './messages.js';
export * from './hosts/index.js';
export * from './tokens.js';
export * from './view.js';
export * from './fonts.js';
export * from './viewer.js';
