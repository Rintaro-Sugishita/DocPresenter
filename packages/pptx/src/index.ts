// The PPTX writer. A deck of slides in, a .pptx out. It knows nothing about
// documents: what becomes a slide is decided in the build.

export * from './model.js';
export * from './diagram.js';
export * from './read.js';
export * from './write.js';
export { escapeXml, hex } from './xml.js';
