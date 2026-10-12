// The viewer page: an address on a Git host in, the document as DocPresenter
// sets it out (design/web-viewer.md).
//
// The page has four faces: the form when no address is given, a folder's
// documents for a folder address, a document or drawing for a file address,
// and — when a host says the repository is not open to everyone — a field for
// the reader's own access token. Everything is read from one commit, and that
// commit is shown, so a shared link means the same thing tomorrow.

import { describeError, type Locale } from '@docpresenter/base';
import { hasMermaid, takeIn, type BuildDiagnostic, type Workspace } from '@docpresenter/build';
import { addressOf, ViewerError, type Addressed, type Fetch, type Host, type Location } from './hosts/index.js';
import { WEB_MESSAGES, type WebMessage } from './messages.js';
import { Tokens } from './tokens.js';
import { compose, gather, heldWorkspace, isViewable, viewableUnder, type Composed, type FileSource } from './view.js';

/** What the shell around the page hands in: the browser, and how it picks a language. */
export interface ViewerEnvironment {
  readonly window: Window;
  readonly fetch: Fetch;
  /** The theme shipped with the page. */
  readonly shippedTheme: string;
  /** Where the font subsetter is, beside the page. */
  readonly subsetterUrl: string;
  readonly locale: {
    readonly start: { readonly locale: Locale; readonly ask: boolean };
    ask(owner: Document, suggested: Locale): Promise<Locale>;
    select(owner: Document, current: Locale, onChange: (locale: Locale) => void): HTMLSelectElement;
  };
}

/** Starts the page in `env.window`. */
export function startViewer(env: ViewerEnvironment): void {
  const win = env.window;
  const doc = win.document;
  let locale = env.locale.start.locale;
  let t = WEB_MESSAGES.in(locale);
  const src = new URLSearchParams(win.location.search).get('src');
  const tokens = Tokens.of(win);
  /** Tokens the browser would not keep, used while the page stays open. */
  const unkept = new Map<string, string>();
  const tokenFor = (origin: string): string | undefined =>
    Tokens.allowed(origin) ? tokens.get(origin) ?? unkept.get(origin) : undefined;
  /** Hosts already opened, so a redraw asks them nothing again. Keyed by address and token. */
  const opened = new Map<string, Host>();

  doc.body.classList.add('dpw');
  const bar = element(doc, 'header', 'dpw-bar');
  const status = element(doc, 'div', 'dpw-status');
  status.setAttribute('role', 'status');
  const notes = element(doc, 'div', 'dpw-notes');
  const main = element(doc, 'main', 'dpw-doc');
  const theme = doc.createElement('style');
  theme.dataset['dpTheme'] = '';
  doc.head.prepend(theme);
  doc.body.append(bar, status, notes, main);

  const say = (text: string, kind: 'ok' | 'busy' | 'refused' = 'ok'): void => {
    status.textContent = text;
    status.dataset['kind'] = kind;
    status.hidden = text === '';
  };
  /** A ViewerError in the reader's words; anything else as it came. */
  const explain = (error: unknown, otherwise: (message: string) => string = message => message): string =>
    error instanceof ViewerError ? t(error.id as WebMessage, error.params) : otherwise(describeError(error, locale));
  const fail = (error: unknown): void => { say(explain(error), 'refused'); };

  /** Redraws everything in the chosen language. Set by whichever face is showing. */
  let redraw: () => void = () => undefined;
  const useLocale = (chosen: Locale): void => {
    if (chosen === locale) return;
    locale = chosen;
    t = WEB_MESSAGES.in(locale);
    redraw();
  };
  const language = (): HTMLElement => {
    const label = element(doc, 'label', 'dpw-language');
    label.append(text(doc, t('web.language')), env.locale.select(doc, locale, useLocale));
    return label;
  };

  /**
   * Draws the Mermaid blocks in `root`, if `body` has any. Mermaid is most of
   * the page's weight, so it is fetched only for a document that draws with
   * it; a document without is shown without ever loading it.
   */
  const drawn = async (root: HTMLElement, body: string, flatten = false): Promise<void> => {
    if (!hasMermaid(body)) return;
    let mermaid: typeof import('@docpresenter/editor/mermaid');
    try {
      mermaid = await loadMermaid();
    } catch (error) {
      throw new ViewerError('web.mermaid.unavailable', { message: describeError(error, locale) }, error);
    }
    await mermaid.drawMermaid(root, locale);
    if (flatten) await mermaid.flattenMermaid(root);
  };

  const showForm = (given = ''): void => {
    doc.documentElement.lang = locale;
    doc.title = t('web.title');
    bar.replaceChildren(brand(doc), spacer(doc), language());
    theme.textContent = '';
    notes.replaceChildren();
    const form = element(doc, 'form', 'dpw-form');
    const heading = element(doc, 'h1');
    heading.textContent = t('web.title');
    const intro = element(doc, 'p');
    intro.textContent = t('web.intro');
    const label = element(doc, 'label');
    label.htmlFor = 'dpw-src';
    label.textContent = t('web.input.label');
    const input = doc.createElement('input');
    input.id = 'dpw-src';
    input.name = 'src';
    input.type = 'url';
    input.required = true;
    input.placeholder = t('web.input.placeholder');
    input.value = given;
    const button = doc.createElement('button');
    button.type = 'submit';
    button.textContent = t('web.input.open');
    const row = element(doc, 'div', 'dpw-row');
    row.append(input, button);
    const forms = element(doc, 'p', 'dpw-hint');
    forms.textContent = t('web.input.forms');
    form.append(heading, intro, label, row, forms);
    form.addEventListener('submit', event => {
      if (addressOf(input.value)) return;
      event.preventDefault();
      say(t('web.error.address'), 'refused');
    });
    main.replaceChildren(form);
    redraw = () => showForm(input.value);
  };

  /** A link to this page showing another address. */
  const viewLink = (address: string): string => {
    const query = new URLSearchParams({ src: address });
    const asked = new URLSearchParams(win.location.search).get('lang');
    if (asked) query.set('lang', asked);
    return `?${query.toString()}`;
  };

  const open = async (address: string): Promise<void> => {
    const addressed = addressOf(address);
    if (!addressed) {
      showForm(address);
      say(t('web.error.address'), 'refused');
      return;
    }
    const token = tokenFor(addressed.origin);
    const key = `${address}\n${token ?? ''}`;
    const host = opened.get(key) ?? addressed.open({ fetch: env.fetch, ...(token === undefined ? {} : { token }) });
    opened.set(key, host);
    // The host keeps its answers, so a redraw costs no requests.
    redraw = () => { void open(address); };
    bar.replaceChildren(brand(doc), spacer(doc), language());
    notes.replaceChildren();
    say(t('web.step.resolve', { repo: host.label }), 'busy');
    try {
      const location = await host.resolve();
      const { paths, truncated } = await host.files(location);
      const present = new Set(paths);
      const isFolder = location.path === '' || (!present.has(location.path)
        && paths.some(path => path.startsWith(`${location.path}/`)));
      if (location.kind === 'tree' || isFolder) {
        showFolder(host, location, paths);
      } else if (!present.has(location.path)) {
        throw new ViewerError(truncated ? 'web.truncated' : 'web.error.notInRepo', { path: location.path });
      } else if (!isViewable(location.path)) {
        throw new ViewerError('web.error.notViewable', { path: location.path });
      } else {
        await showDocument(host, location, paths, truncated);
      }
    } catch (error) {
      fail(error);
      if (error instanceof ViewerError && error.wantsToken) showTokenForm(host, addressed, address);
    }
  };

  /** Asks for the reader's token for a host that would not open without one. */
  const showTokenForm = (host: Host, addressed: Addressed, address: string): void => {
    const origin = addressed.origin;
    theme.textContent = '';
    const box = element(doc, 'form', 'dpw-form');
    const heading = element(doc, 'h1');
    heading.textContent = t('web.token.title', { host: host.name });
    const intro = element(doc, 'p');
    box.append(heading, intro);
    if (!Tokens.allowed(origin)) {
      intro.textContent = t('web.token.http', { origin });
      main.replaceChildren(box);
      return;
    }
    intro.textContent = t('web.token.text', { origin });
    const make = doc.createElement('a');
    make.href = host.tokenHelp.url;
    make.target = '_blank';
    make.rel = 'noopener';
    make.textContent = t('web.token.make', { scope: host.tokenHelp.scope });
    const label = element(doc, 'label');
    label.htmlFor = 'dpw-token';
    label.textContent = t('web.token.label');
    const input = doc.createElement('input');
    input.id = 'dpw-token';
    input.type = 'password';
    input.autocomplete = 'off';
    input.required = true;
    const use = doc.createElement('button');
    use.type = 'submit';
    use.textContent = t('web.token.use');
    const row = element(doc, 'div', 'dpw-row');
    row.append(input, use);
    box.append(make, label, row);
    if (tokenFor(origin) !== undefined) box.append(forgetButton(origin, address));
    box.addEventListener('submit', event => {
      event.preventDefault();
      const value = input.value.trim();
      if (value === '') return;
      if (!tokens.set(origin, value)) {
        unkept.set(origin, value);
        say(t('web.token.notKept'));
      }
      void open(address);
    });
    main.replaceChildren(box);
    redraw = () => { void open(address); };
    input.focus();
  };

  const forgetButton = (origin: string, address: string): HTMLButtonElement => button(doc, t('web.token.forget'), () => {
    tokens.forget(origin);
    unkept.delete(origin);
    for (const key of [...opened.keys()]) if (key.startsWith(`${address}\n`)) opened.delete(key);
    void open(address).then(() => { if (status.dataset['kind'] !== 'refused') say(t('web.token.forgotten', { origin })); });
  });

  const header = (host: Host, location: Location, here: string, kind: 'blob' | 'tree'): HTMLElement[] => {
    const crumb = element(doc, 'span', 'dpw-crumb');
    const repo = doc.createElement('a');
    repo.href = viewLink(host.webUrl({ kind: 'tree', path: '', sha: location.sha }));
    repo.textContent = location.label;
    crumb.append(repo);
    let walked = '';
    const parts = here === '' ? [] : here.split('/');
    parts.forEach((part, i) => {
      walked = walked === '' ? part : `${walked}/${part}`;
      crumb.append(text(doc, ' / '));
      if (i === parts.length - 1) {
        const last = element(doc, 'strong');
        last.textContent = part;
        crumb.append(last);
      } else {
        const link = doc.createElement('a');
        link.href = viewLink(host.webUrl({ kind: 'tree', path: walked, sha: location.sha }));
        link.textContent = part;
        crumb.append(link);
      }
    });
    const commit = element(doc, 'code', 'dpw-commit');
    const short = location.sha.slice(0, 7);
    commit.textContent = location.ref === location.sha ? t('web.atSha', { sha: short }) : t('web.at', { ref: location.ref, sha: short });
    commit.title = location.sha;

    const pinned = new URL(win.location.href);
    pinned.search = viewLink(host.webUrl({ kind, path: here, sha: location.sha }));
    const copy = button(doc, t('web.copyLink'), async () => {
      try {
        await win.navigator.clipboard.writeText(pinned.toString());
        say(t('web.copied'));
      } catch {
        say(t('web.copyFailed'), 'refused');
      }
    });
    const out = doc.createElement('a');
    out.href = host.webUrl({ kind, path: here, sha: location.sha }, location.ref);
    out.textContent = t('web.onHost', { host: host.name });
    out.target = '_blank';
    out.rel = 'noopener';
    const another = doc.createElement('a');
    another.href = '?';
    another.textContent = t('web.another');
    const address = new URLSearchParams(win.location.search).get('src') ?? '';
    const forget = tokenFor(host.origin) === undefined ? [] : [forgetButton(host.origin, address)];
    return [brand(doc), crumb, commit, spacer(doc), copy, out, ...forget, another, language()];
  };

  const showFolder = (host: Host, location: Location, paths: readonly string[]): void => {
    const folder = location.path;
    doc.documentElement.lang = locale;
    doc.title = `${folder === '' ? location.name : folder} — ${t('web.title')}`;
    bar.replaceChildren(...header(host, location, folder, 'tree'));
    theme.textContent = '';
    notes.replaceChildren();
    say('');
    const { documents, drawings } = viewableUnder(paths, folder);
    const list = element(doc, 'section', 'dpw-folder');
    const heading = element(doc, 'h1');
    heading.textContent = t('web.folder', { path: folder === '' ? t('web.folder.root') : folder });
    const count = element(doc, 'p', 'dpw-hint');
    count.textContent = t('web.folder.count', { documents: String(documents.length), drawings: String(drawings.length) });
    list.append(heading, count);
    if (folder !== '') {
      const up = doc.createElement('a');
      const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
      up.href = viewLink(host.webUrl({ kind: 'tree', path: parent, sha: location.sha }));
      up.textContent = `↑ ${t('web.folder.up')}`;
      list.append(up);
    }
    if (documents.length + drawings.length === 0) {
      const empty = element(doc, 'p');
      empty.textContent = t('web.folder.empty');
      list.append(empty);
    }
    const prefix = folder === '' ? '' : `${folder}/`;
    for (const [title, group] of [[t('web.folder.documents'), documents], [t('web.folder.drawings'), drawings]] as const) {
      if (group.length === 0) continue;
      const sub = element(doc, 'h2');
      sub.textContent = title;
      const items = element(doc, 'ul');
      for (const path of group) {
        const item = element(doc, 'li');
        const link = doc.createElement('a');
        link.href = viewLink(host.webUrl({ kind: 'blob', path, sha: location.sha }));
        link.textContent = path.slice(prefix.length);
        item.append(link);
        items.append(item);
      }
      list.append(sub, items);
    }
    main.replaceChildren(list);
  };

  const showDocument = async (host: Host, location: Location, paths: readonly string[], truncated: boolean): Promise<void> => {
    const source: FileSource = {
      paths,
      text: path => host.text(location, path),
      image: path => host.image(location, path),
    };
    const options = { locale, shippedTheme: env.shippedTheme };
    const { held, complete } = await gather(
      source, workspace => { compose(workspace, location.path, options); },
      count => say(t('web.step.files', { count: String(count) }), 'busy'));
    const workspace = withInline(heldWorkspace(source, held), env.fetch);

    // Pictures on the web are taken in as the build takes them in.
    const first = compose(workspace, location.path, options);
    const trouble: BuildDiagnostic[] = [];
    const inlined = await takeIn(workspace, first.prepared, trouble);
    const composed = inlined.size === 0 ? first : compose(workspace, location.path, { ...options, inlined });

    doc.documentElement.lang = locale;
    doc.title = `${composed.title} — ${t('web.title')}`;
    const pdf = button(doc, t('web.pdf.make'), () => downloadPdf(pdf, composed, workspace, source, held, location));
    const top = header(host, location, location.path, 'blob');
    top.splice(4, 0, pdf);
    bar.replaceChildren(...top);
    theme.textContent = composed.style;
    main.innerHTML = composed.body;
    void drawn(main, composed.body).catch(fail);

    const failed = [...held.texts, ...held.images].filter(([, value]) => value === undefined).map(([path]) => path);
    const said: string[] = [
      ...(truncated ? [t('web.truncated')] : []),
      ...(complete ? [] : [t('web.error.tooMany', { count: String(held.texts.size + held.images.size) })]),
      ...failed.map(path => t('web.error.fetchFile', { path })),
      ...[...composed.diagnostics, ...trouble].map(d => `${d.path ? `${d.path}: ` : ''}${d.message}`),
    ];
    showNotes(said);
    say('');
  };

  const showNotes = (said: readonly string[]): void => {
    if (said.length === 0) { notes.replaceChildren(); return; }
    const box = doc.createElement('details');
    box.open = true;
    const summary = doc.createElement('summary');
    summary.textContent = t('web.diagnostics', { count: String(said.length) });
    const items = doc.createElement('ul');
    for (const line of said) {
      const item = doc.createElement('li');
      item.textContent = line;
      items.append(item);
    }
    box.append(summary, items);
    notes.replaceChildren(box);
  };

  const downloadPdf = async (
    pressed: HTMLButtonElement, composed: Composed, workspace: Workspace,
    source: FileSource, held: { texts: Map<string, string | undefined> }, location: Location,
  ): Promise<void> => {
    pressed.disabled = true;
    say(t('web.pdf.composing'), 'busy');
    try {
      // The PDF writer is loaded the first time it is asked for.
      const { makePdf } = await import('./pdf.js');
      // The review so far rides in the PDF; its files are fetched now.
      const rounds = source.paths.filter(path => /\.review\.yml$/i.test(path) && !held.texts.has(path));
      await Promise.all(rounds.map(async path => { held.texts.set(path, await source.text(path).catch(() => undefined)); }));
      const made = await makePdf({
        window: win, composed, workspace, commit: location.sha, locale, fetch: env.fetch, subsetterUrl: env.subsetterUrl,
        sources: [composed.root, ...[...held.texts.keys()].filter(path => !/\.(review\.yml|css)$/i.test(path))],
        draw: stage => drawn(stage, composed.body, true),
      });
      const raw = composed.prepared.document.frontmatter.raw;
      const name = `${String(raw['document'] ?? location.path.slice(location.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''))}.pdf`;
      download(doc, name, made.bytes);
      say(t('web.pdf.made', { pages: String(made.pages), font: made.font })
        + (made.missing ? t('web.pdf.missing', { characters: made.missing }) : ''), made.missing ? 'refused' : 'ok');
    } catch (error) {
      say(explain(error, message => t('web.pdf.failed', { message })), 'refused');
    } finally {
      pressed.disabled = false;
    }
  };

  if (src) void open(src);
  else showForm();
  if (env.locale.start.ask) void env.locale.ask(doc, locale).then(useLocale);
}

let mermaidModule: Promise<typeof import('@docpresenter/editor/mermaid')> | undefined;

/** Mermaid's drawing code, fetched once on first use. A failed fetch may be retried. */
function loadMermaid(): Promise<typeof import('@docpresenter/editor/mermaid')> {
  mermaidModule ??= import('@docpresenter/editor/mermaid').catch(error => {
    mermaidModule = undefined;
    throw error;
  });
  return mermaidModule;
}

/** The workspace, able to fetch a picture the document names by its web address. */
function withInline(workspace: Workspace, fetch: Fetch): Workspace {
  return {
    ...workspace,
    async inline(address) {
      try {
        const response = await fetch(address);
        if (!response.ok) return undefined;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) return undefined;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:${blob.type};base64,${btoa(binary)}`;
      } catch {
        return undefined;
      }
    },
  };
}

function download(doc: Document, name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const made = doc.createElement(tag);
  if (className) made.className = className;
  return made;
}

function text(doc: Document, value: string): Text {
  return doc.createTextNode(value);
}

function brand(doc: Document): HTMLElement {
  const link = doc.createElement('a');
  link.className = 'dpw-brand';
  link.href = '?';
  link.textContent = 'DocPresenter';
  return link;
}

function spacer(doc: Document): HTMLElement {
  return element(doc, 'span', 'dpw-spacer');
}

function button(doc: Document, label: string, onClick: () => unknown): HTMLButtonElement {
  const made = doc.createElement('button');
  made.type = 'button';
  made.textContent = label;
  made.addEventListener('click', () => { void onClick(); });
  return made;
}
