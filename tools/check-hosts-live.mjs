// The viewer's hosts against the real thing: public repositories on
// gitlab.com, codeberg.org (Forgejo) and dev.azure.com, read with no token.
// Needs the network, so it is run by hand rather than in CI:
//
//   npx tsc --build && node tools/check-hosts-live.mjs
//
// Each line resolves a ref, lists the commit's files, reads one, and reads the
// host's own link back to the same commit and path. The last lines check that
// a repository the reader cannot see asks for a token.
import { addressOf } from '../packages/app-web/dist/index.js';

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const open = address => addressOf(address).open({ fetch: (url, init) => fetch(url, init) });

for (const address of [
  'https://gitlab.com/gitlab-org/cli/-/blob/main/README.md',
  'https://gitlab.com/gitlab-org/cli/-/tree/main/docs',
  'https://codeberg.org/forgejo/docs/src/branch/next/README.md',
  'https://dev.azure.com/dnceng-public/public/_git/dotnet-public-wiki?path=/Artifacts-Feeds.md&version=GBmain',
  'https://dev.azure.com/dnceng-public/public/_git/dotnet-public-wiki',
]) {
  try {
    const host = open(address);
    const at = await host.resolve();
    const { paths } = await host.files(at);
    const file = paths.includes(at.path) ? at.path : paths.find(path => path.endsWith('.md'));
    const text = await host.text(at, file);
    const again = await open(host.webUrl(at)).resolve();
    check(`${host.type} ${at.label} @ ${at.ref}`, text !== undefined && again.sha === at.sha && again.path === at.path,
      `${paths.length} files, ${file}`);
  } catch (error) {
    check(address, false, `${error.id ?? error} ${JSON.stringify(error.params ?? {})}`);
  }
}

for (const address of [
  'https://gitlab.com/gitlab-org/this-does-not-exist-docpresenter/-/blob/main/a.md',
  'https://dev.azure.com/dnceng/internal/_git/dotnet-runtime',
]) {
  const error = await open(address).resolve().then(() => undefined, failure => failure);
  check(`見えないリポジトリはトークンを求める: ${address}`, error?.wantsToken === true, error?.id);
}
