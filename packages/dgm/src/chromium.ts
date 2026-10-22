// The browser PNGs and PDFs are drawn with.
//
// Not ours to ship — playwright-core carries no binary — so it is whatever this
// machine already has: `--chromium`, else DOCPRESENTER_CHROMIUM, else the
// usual places, the first that exists. When none is found the refusal names
// the option, because "could not draw" with no path in it helps nobody.

import { existsSync } from 'node:fs';
import { CliError } from './errors.js';

const CHROMIUM_PATHS: Readonly<Record<string, readonly string[]>> = {
  linux: [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/snap/bin/chromium',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

export function findChromium(given?: string): string {
  if (given !== undefined) {
    if (!existsSync(given)) throw new CliError('usage', 'cli.chromiumMissing', { path: given });
    return given;
  }
  const named = process.env['DOCPRESENTER_CHROMIUM'];
  if (named) {
    if (!existsSync(named)) throw new CliError('usage', 'cli.chromiumMissing', { path: named });
    return named;
  }
  const found = (CHROMIUM_PATHS[process.platform] ?? CHROMIUM_PATHS['linux']!).find(path => existsSync(path));
  if (found === undefined) throw new CliError('content', 'cli.noChromium');
  return found;
}
