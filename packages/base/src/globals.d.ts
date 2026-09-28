// TextEncoder is part of every runtime this package targets (browsers, Node,
// workers). Declared here rather than pulling in the DOM lib, which would also
// expose `document` and `window` to a package that must stay platform-neutral.
declare const TextEncoder: {
  new (): { encode(input?: string): Uint8Array };
};

declare const TextDecoder: {
  new (): { decode(input?: Uint8Array): string };
};
