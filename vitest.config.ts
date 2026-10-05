import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // The extension host talks to VS Code, which is not here. The tests give
      // it an API that does what VS Code's documents it does, over a workspace
      // held in a map — enough to run the extension rather than only type it.
      vscode: fileURLToPath(new URL('./packages/app-vscode/test/fake-vscode.ts', import.meta.url)),
    },
  },
});
