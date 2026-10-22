// The `docpresenter` command itself. Bundled into media/docpresenter.mjs (tools/build-cli.mjs).

import { runDocpresenter } from './cli.js';

process.exitCode = await runDocpresenter(process.argv.slice(2), import.meta.url);
