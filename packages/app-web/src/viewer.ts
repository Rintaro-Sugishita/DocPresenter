// The viewer page: an address on a Git host, or a folder on this computer, in;
// the document as DocPresenter sets it out (design/web-viewer.md).
//
// The page has four faces: the form when nothing is open yet, a folder's
// documents, a document or drawing, and — when a host says the repository is
// not open to everyone — a field for the reader's own access token. What is
// read from a host is read from one commit, and that commit is shown, so a
// shared link means the same thing tomorrow. A folder on this computer cannot
// travel in a link; it is moved about in the page itself.

import { describeError, type Locale } from '@docpresenter/base';
import { hasMermaid, takeIn, type BuildDiagnostic, type Workspace } from '@docpresenter/build';
import { addressOf, ViewerError, type Addressed, type Fetch, type Host, type Location } from './hosts/index.js';
import { WEB_MESSAGES, type WebMessage } from './messages.js';
import {
  droppedFolder, folderPicker, mayRead, nodeOfHandle, readFolder, recallFolder, rememberFolder,
  type FolderNode, type LocalFolder,
} from './local.js';
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

/**
 * Where the files shown come from: a repository at a commit, or a folder on
 * this computer. The folder list and the document are drawn the same way for
 * both; only the header and the links differ.
 */
interface Place {
  readonly source: FileSource;
  /** The root of the breadcrumb: `owner/repo`, or the folder's name. */
  readonly label: string;
  /** For the page title at the root. */
  readonly name: string;
  /** The commit (or working folder) line, in the language of the moment. */
  badge(): { readonly text: string; readonly title: string };
  /** True for a folder on this computer: links move within the page. */
  readonly local: boolean;
  readonly truncated: boolean;
  /** Where to view another path here. */
  href(kind: 'blob' | 'tree', path: string): string;
  /** What the header carries beyond the breadcrumb, for the path shown. */
  extras(kind: 'blob' | 'tree', path: string): HTMLElement[];
  /** The commit the PDF's review map names, and whether the files are that commit. */
  readonly commit?: string;
  readonly clean: boolean;
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
  /** The folder on this computer open now, if any. */
  let here: Place | undefined;

  doc.body.classList.add('dpw');
  const bar = element(doc, 'header', 'dpw-bar');
  const status = element(doc, 'div', 'dpw-status');
  status.setAttribute('role', 'status');
  status.hidden = true;
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
    main.replaceChildren(form, localSection());
    redraw = () => showForm(input.value);
  };

  /** The way in for a folder on this computer: the dialog, a drop, or the folder kept from last time. */
  const localSection = (): HTMLElement => {
    const section = element(doc, 'section', 'dpw-form dpw-local');
    const heading = element(doc, 'h2');
    heading.textContent = t('web.local.heading');
    const intro = element(doc, 'p');
    intro.textContent = t('web.local.text');
    const row = element(doc, 'div', 'dpw-row');
    const pick = folderPicker(win);
    if (pick) {
      row.append(button(doc, t('web.local.pick'), async () => {
        let handle;
        try {
          handle = await pick();
        } catch {
          return; // The reader closed the dialog.
        }
        void rememberFolder(win, handle);
        await openFolder(nodeOfHandle(handle), '');
      }));
    }
    const drop = element(doc, 'div', 'dpw-drop');
    drop.textContent = t('web.local.drop');
    row.append(drop);
    section.append(heading, intro, row);
    if (!pick) {
      const note = element(doc, 'p', 'dpw-hint');
      note.textContent = t('web.local.noPicker');
      section.append(note);
    }
    void recallFolder(win).then(kept => {
      if (!kept || !section.isConnected) return;
      section.append(button(doc, t('web.local.reopen', { name: kept.name }), () => reopen(kept, '')));
    });
    return section;
  };

  /** Opens a folder kept from last time. Runs in a click: the browser asks the reader first. */
  const reopen = async (kept: Parameters<typeof nodeOfHandle>[0] & Parameters<typeof mayRead>[0], path: string): Promise<void> => {
    try {
      if (!await mayRead(kept)) { say(t('web.local.denied'), 'refused'); return; }
    } catch {
      say(t('web.local.denied'), 'refused');
      return;
    }
    await openFolder(nodeOfHandle(kept), path);
  };

  /** Reads a folder in, and shows `path` in it. */
  const openFolder = async (node: FolderNode, path: string): Promise<void> => {
    say(t('web.local.reading', { count: '0' }), 'busy');
    let folder: LocalFolder;
    try {
      folder = await readFolder(node, count => say(t('web.local.reading', { count: String(count) }), 'busy'));
    } catch (error) {
      say(t('web.local.failed', { message: describeError(error, locale) }), 'refused');
      return;
    }
    here = localPlace(folder);
    move(path, path === '' ? 'tree' : 'blob', true);
  };

  /** Moves within the open folder, as a link would, and keeps the browser's back button working. */
  const move = (path: string, kind: 'blob' | 'tree', replace = false): void => {
    if (!here) return;
    const state = { local: path, kind };
    const url = here.href(kind, path);
    if (replace) win.history.replaceState(state, '', url);
    else win.history.pushState(state, '', url);
    void showPlace(here, path, kind);
  };

  const localPlace = (folder: LocalFolder): Place => {
    const { branch, sha } = folder.git;
    const short = sha?.slice(0, 7) ?? '';
    return {
      source: folder,
      label: folder.name,
      name: folder.name,
      badge: () => ({
        text: sha === undefined ? t('web.local.noGit')
          : branch === undefined ? t('web.local.atSha', { sha: short }) : t('web.local.at', { branch, sha: short }),
        title: [t('web.local.note'), sha].filter(Boolean).join('\n'),
      }),
      local: true,
      truncated: folder.truncated,
      href: (_kind, path) => `?${new URLSearchParams({ local: path, ...langParam() }).toString()}`,
      extras: () => [],
      ...(sha === undefined ? {} : { commit: sha }),
      clean: false,
    };
  };

  /** `lang=` carried over, when the page was opened with one. */
  const langParam = (): Record<string, string> => {
    const asked = new URLSearchParams(win.location.search).get('lang');
    return asked ? { lang: asked } : {};
  };

  // A folder can be dropped anywhere on the page, whatever it shows.
  doc.addEventListener('dragover', event => {
    if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
    event.preventDefault();
    doc.body.classList.add('dpw-dragging');
  });
  doc.addEventListener('dragleave', event => {
    if (event.relatedTarget === null) doc.body.classList.remove('dpw-dragging');
  });
  doc.addEventListener('drop', event => {
    doc.body.classList.remove('dpw-dragging');
    const dropped = droppedFolder(event);
    if (!dropped) return;
    event.preventDefault();
    void (async () => {
      const node = await dropped.node;
      if (!node) { say(t('web.local.notFolder'), 'refused'); return; }
      const handle = await dropped.handle;
      if (handle) void rememberFolder(win, handle);
      await openFolder(node, '');
    })();
  });
  win.addEventListener('popstate', event => {
    const state = event.state as { local?: string; kind?: 'blob' | 'tree' } | null;
    if (state?.local !== undefined && here) void showPlace(here, state.local, state.kind ?? 'tree');
  });

  /** A link to a path in a place. Within a folder on this computer it moves in the page. */
  const linkTo = (place: Place, kind: 'blob' | 'tree', path: string, label: string): HTMLAnchorElement => {
    const link = doc.createElement('a');
    link.href = place.href(kind, path);
    link.textContent = label;
    if (place.local) {
      link.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        move(path, kind);
      });
    }
    return link;
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
      await showPlace(hostPlace(host, location, paths, truncated), location.path, location.kind);
    } catch (error) {
      fail(error);
      if (error instanceof ViewerError && error.wantsToken) showTokenForm(host, addressed, address);
    }
  };

  /** A repository at a commit, as a place. */
  const hostPlace = (host: Host, location: Location, paths: readonly string[], truncated: boolean): Place => {
    const short = location.sha.slice(0, 7);
    return {
      source: { paths, text: path => host.text(location, path), image: path => host.image(location, path) },
      label: location.label,
      name: location.name,
      badge: () => ({
        text: location.ref === location.sha ? t('web.atSha', { sha: short }) : t('web.at', { ref: location.ref, sha: short }),
        title: location.sha,
      }),
      local: false,
      truncated,
      href: (kind, path) => viewLink(host.webUrl({ kind, path, sha: location.sha })),
      extras: (kind, path) => {
        const pinned = new URL(win.location.href);
        pinned.search = viewLink(host.webUrl({ kind, path, sha: location.sha }));
        const copy = button(doc, t('web.copyLink'), async () => {
          try {
            await win.navigator.clipboard.writeText(pinned.toString());
            say(t('web.copied'));
          } catch {
            say(t('web.copyFailed'), 'refused');
          }
        });
        const out = doc.createElement('a');
        out.href = host.webUrl({ kind, path, sha: location.sha }, location.ref);
        out.textContent = t('web.onHost', { host: host.name });
        out.target = '_blank';
        out.rel = 'noopener';
        const address = new URLSearchParams(win.location.search).get('src') ?? '';
        const forget = tokenFor(host.origin) === undefined ? [] : [forgetButton(host.origin, address)];
        return [copy, out, ...forget];
      },
      commit: location.sha,
      clean: true,
    };
  };

  /** Shows a path in a place: a folder's documents, a document, or why neither. */
  const showPlace = async (place: Place, path: string, kind: 'blob' | 'tree'): Promise<void> => {
    redraw = () => { void showPlace(place, path, kind); };
    try {
      const { paths } = place.source;
      const present = new Set(paths);
      const isFolder = path === '' || (!present.has(path) && paths.some(one => one.startsWith(`${path}/`)));
      if (kind === 'tree' || isFolder) {
        showFolder(place, path);
      } else if (!present.has(path)) {
        throw new ViewerError(place.truncated ? 'web.truncated' : 'web.error.notInRepo', { path });
      } else if (!isViewable(path)) {
        throw new ViewerError('web.error.notViewable', { path });
      } else {
        await showDocument(place, path);
      }
    } catch (error) {
      fail(error);
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

  /**
   * A reload, or a link, that names a path in a folder on this computer: the
   * folder itself did not come with it. The one kept from last time is offered
   * when the browser kept one; otherwise the reader picks it again.
   */
  const showLost = async (path: string): Promise<void> => {
    showForm();
    const kept = await recallFolder(win);
    if (!kept) { say(t('web.local.lost'), 'refused'); return; }
    const again = button(doc, t('web.local.reopen', { name: kept.name }), () => reopen(kept, path));
    again.classList.add('dpw-primary');
    main.prepend(again);
    again.focus();
  };

  const forgetButton = (origin: string, address: string): HTMLButtonElement => button(doc, t('web.token.forget'), () => {
    tokens.forget(origin);
    unkept.delete(origin);
    for (const key of [...opened.keys()]) if (key.startsWith(`${address}\n`)) opened.delete(key);
    void open(address).then(() => { if (status.dataset['kind'] !== 'refused') say(t('web.token.forgotten', { origin })); });
  });

  const header = (place: Place, at: string, kind: 'blob' | 'tree'): HTMLElement[] => {
    const crumb = element(doc, 'span', 'dpw-crumb');
    crumb.append(linkTo(place, 'tree', '', place.label));
    let walked = '';
    const parts = at === '' ? [] : at.split('/');
    parts.forEach((part, i) => {
      walked = walked === '' ? part : `${walked}/${part}`;
      crumb.append(text(doc, ' / '));
      if (i === parts.length - 1) {
        const last = element(doc, 'strong');
        last.textContent = part;
        crumb.append(last);
      } else {
        crumb.append(linkTo(place, 'tree', walked, part));
      }
    });
    const commit = element(doc, 'code', 'dpw-commit');
    const badge = place.badge();
    commit.textContent = badge.text;
    commit.title = badge.title;
    const another = doc.createElement('a');
    another.href = '?';
    another.textContent = t('web.another');
    return [brand(doc), crumb, commit, spacer(doc), ...place.extras(kind, at), another, language()];
  };

  const showFolder = (place: Place, folder: string): void => {
    const { paths } = place.source;
    doc.documentElement.lang = locale;
    doc.title = `${folder === '' ? place.name : folder} — ${t('web.title')}`;
    bar.replaceChildren(...header(place, folder, 'tree'));
    theme.textContent = '';
    notes.replaceChildren();
    say(place.truncated ? t(place.local ? 'web.local.truncated' : 'web.truncated', { count: String(paths.length) }) : '');
    const { documents, drawings } = viewableUnder(paths, folder);
    const list = element(doc, 'section', 'dpw-folder');
    const heading = element(doc, 'h1');
    heading.textContent = t('web.folder', { path: folder === '' ? t('web.folder.root') : folder });
    const count = element(doc, 'p', 'dpw-hint');
    count.textContent = t('web.folder.count', { documents: String(documents.length), drawings: String(drawings.length) });
    list.append(heading, count);
    if (folder !== '') {
      const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
      list.append(linkTo(place, 'tree', parent, `↑ ${t('web.folder.up')}`));
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
        item.append(linkTo(place, 'blob', path, path.slice(prefix.length)));
        items.append(item);
      }
      list.append(sub, items);
    }
    main.replaceChildren(list);
  };

  const showDocument = async (place: Place, path: string): Promise<void> => {
    const { source, truncated } = place;
    const options = { locale, shippedTheme: env.shippedTheme };
    const { held, complete } = await gather(
      source, workspace => { compose(workspace, path, options); },
      count => say(t('web.step.files', { count: String(count) }), 'busy'));
    const workspace = withInline(heldWorkspace(source, held), env.fetch);

    // Pictures on the web are taken in as the build takes them in.
    const first = compose(workspace, path, options);
    const trouble: BuildDiagnostic[] = [];
    const inlined = await takeIn(workspace, first.prepared, trouble);
    const composed = inlined.size === 0 ? first : compose(workspace, path, { ...options, inlined });

    doc.documentElement.lang = locale;
    doc.title = `${composed.title} — ${t('web.title')}`;
    const pdf = button(doc, t('web.pdf.make'), () => downloadPdf(pdf, composed, workspace, place, held, path));
    const top = header(place, path, 'blob');
    top.splice(4, 0, pdf);
    bar.replaceChildren(...top);
    theme.textContent = composed.style;
    main.innerHTML = composed.body;
    void drawn(main, composed.body).catch(fail);

    const failed = [...held.texts, ...held.images].filter(([, value]) => value === undefined).map(([path]) => path);
    const said: string[] = [
      ...(truncated ? [t(place.local ? 'web.local.truncated' : 'web.truncated', { count: String(source.paths.length) })] : []),
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
    place: Place, held: { texts: Map<string, string | undefined> }, path: string,
  ): Promise<void> => {
    const { source } = place;
    pressed.disabled = true;
    say(t('web.pdf.composing'), 'busy');
    try {
      // The PDF writer is loaded the first time it is asked for.
      const { makePdf } = await import('./pdf.js');
      // The review so far rides in the PDF; its files are fetched now.
      const rounds = source.paths.filter(path => /\.review\.yml$/i.test(path) && !held.texts.has(path));
      await Promise.all(rounds.map(async path => { held.texts.set(path, await source.text(path).catch(() => undefined)); }));
      const made = await makePdf({
        window: win, composed, workspace, locale, fetch: env.fetch, subsetterUrl: env.subsetterUrl,
        ...(place.commit === undefined ? {} : { commit: place.commit }), clean: place.clean,
        sources: [composed.root, ...[...held.texts.keys()].filter(path => !/\.(review\.yml|css)$/i.test(path))],
        draw: stage => drawn(stage, composed.body, true),
      });
      const raw = composed.prepared.document.frontmatter.raw;
      const name = `${String(raw['document'] ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''))}.pdf`;
      download(doc, name, made.bytes);
      say(t('web.pdf.made', { pages: String(made.pages), font: made.font })
        + (made.missing ? t('web.pdf.missing', { characters: made.missing }) : ''), made.missing ? 'refused' : 'ok');
    } catch (error) {
      say(explain(error, message => t('web.pdf.failed', { message })), 'refused');
    } finally {
      pressed.disabled = false;
    }
  };

  const local = new URLSearchParams(win.location.search).get('local');
  if (src) void open(src);
  else if (local !== null) void showLost(local);
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
