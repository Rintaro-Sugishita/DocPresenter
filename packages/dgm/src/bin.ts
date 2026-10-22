// The `dgm` command itself. Bundled into media/dgm.mjs (tools/build-cli.mjs).

import { runDgm } from './cli.js';

process.exitCode = await runDgm(process.argv.slice(2), import.meta.url);
