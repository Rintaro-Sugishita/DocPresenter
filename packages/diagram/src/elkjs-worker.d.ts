// elkjs ships no usable types for its worker build: `elk-worker.d.ts` says
// only `export type Worker = Worker`, which refers to itself. What this module
// actually provides is the class the engine in `elk.ts` drives by hand, so it
// is described here, as narrowly as that engine uses it.

declare module 'elkjs/lib/elk-worker.min.js' {
  interface ElkDispatcher {
    dispatch(message: { data: unknown }): void;
  }
  class ElkFakeWorker {
    dispatcher?: ElkDispatcher;
    onmessage?: (event: { data: unknown }) => void;
    postMessage(message: unknown): void;
  }
  const module: { Worker: typeof ElkFakeWorker };
  export default module;
  export { ElkFakeWorker as Worker };
}
