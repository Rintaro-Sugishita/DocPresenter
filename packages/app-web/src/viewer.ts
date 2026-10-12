// The viewer page: an address on GitHub in, the document as DocPresenter sets
// it out (design/web-viewer.md).
//
// The page has three faces: the form when no address is given, a folder's
// documents for a `tree/` address, and a document or drawing for a `blob/` or
// raw one. Everything is read from one commit, and that commit is shown, so a
// shared link means the same thing tomorrow.

import { describeError, type Locale } from '@docpresenter/base';
import { BUILD_MESSAGES, hasMermaid, reviewSourceOf, takeIn, type BuildDiagnostic, type Workspace } from '@docpresenter/build';
import { createSubsetter, measure, writePdf, type Subsetter } from '@docpresenter/pdf';
import { githubUrl, GitHub, parseAddress, ViewerError, type Fetch, type Location } from './github.js';
import { localFonts } from './fonts.js';
import { WEB_MESSAGES, type WebMessage } from './messages.js';
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
  const github = new GitHub(env.fetch);
  const src = new URLSearchParams(win.location.search).get('src');

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
      if (parseAddress(input.value)) return;
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
    const parsed = parseAddress(address);
    if (!parsed) {
      showForm(address);
      say(t('web.error.address'), 'refused');
      return;
    }
    // GitHub's answers are kept (see GitHub), so a redraw costs no requests.
    redraw = () => { void open(address); };
    bar.replaceChildren(brand(doc), spacer(doc), language());
    say(t('web.step.resolve', { repo: `${parsed.owner}/${parsed.repo}` }), 'busy');
    try {
      const location = await github.resolve(parsed);
      const { paths, truncated } = await github.files(location);
      const present = new Set(paths);
      const isFolder = location.path === '' || (!present.has(location.path)
        && paths.some(path => path.startsWith(`${location.path}/`)));
      if (location.kind === 'tree' || isFolder) {
        showFolder(location, paths);
      } else if (!present.has(location.path)) {
        throw new ViewerError(truncated ? 'web.truncated' : 'web.error.notInRepo', { path: location.path });
      } else if (!isViewable(location.path)) {
        throw new ViewerError('web.error.notViewable', { path: location.path });
      } else {
        await showDocument(location, paths, truncated);
      }
    } catch (error) {
      fail(error);
    }
  };

  const header = (location: Location, here: string, kind: 'blob' | 'tree'): HTMLElement[] => {
    const crumb = element(doc, 'span', 'dpw-crumb');
    const repo = doc.createElement('a');
    repo.href = viewLink(githubUrl({ ...location, kind: 'tree', path: '' }, location.sha));
    repo.textContent = `${location.owner}/${location.repo}`;
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
        link.href = viewLink(githubUrl({ ...location, kind: 'tree', path: walked }, location.sha));
        link.textContent = part;
        crumb.append(link);
      }
    });
    const commit = element(doc, 'code', 'dpw-commit');
    const short = location.sha.slice(0, 7);
    commit.textContent = location.ref === location.sha ? t('web.atSha', { sha: short }) : t('web.at', { ref: location.ref, sha: short });
    commit.title = location.sha;

    const pinned = new URL(win.location.href);
    pinned.search = viewLink(githubUrl({ ...location, kind, path: here }, location.sha));
    const copy = button(doc, t('web.copyLink'), async () => {
      try {
        await win.navigator.clipboard.writeText(pinned.toString());
        say(t('web.copied'));
      } catch {
        say(t('web.copyFailed'), 'refused');
      }
    });
    const out = doc.createElement('a');
    out.href = githubUrl({ ...location, kind, path: here }, location.ref);
    out.textContent = t('web.onGitHub');
    out.target = '_blank';
    out.rel = 'noopener';
    const another = doc.createElement('a');
    another.href = '?';
    another.textContent = t('web.another');
    return [brand(doc), crumb, commit, spacer(doc), copy, out, another, language()];
  };

  const showFolder = (location: Location, paths: readonly string[]): void => {
    const folder = location.path;
    doc.documentElement.lang = locale;
    doc.title = `${folder === '' ? location.repo : folder} — ${t('web.title')}`;
    bar.replaceChildren(...header(location, folder, 'tree'));
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
      up.href = viewLink(githubUrl({ ...location, kind: 'tree', path: parent }, location.sha));
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
        link.href = viewLink(githubUrl({ ...location, kind: 'blob', path }, location.sha));
        link.textContent = path.slice(prefix.length);
        item.append(link);
        items.append(item);
      }
      list.append(sub, items);
    }
    main.replaceChildren(list);
  };

  const showDocument = async (location: Location, paths: readonly string[], truncated: boolean): Promise<void> => {
    const source: FileSource = {
      paths,
      text: path => github.text(location, path),
      image: path => github.image(location, path),
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
    const pdf = button(doc, t('web.pdf.make'), () => makePdf(pdf, composed, workspace, source, held, location));
    const top = header(location, location.path, 'blob');
    top.splice(top.length - 3, 0, pdf);
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

  let subsetter: Promise<Subsetter> | undefined;
  const makePdf = async (
    pressed: HTMLButtonElement, composed: Composed, workspace: Workspace,
    source: FileSource, held: { texts: Map<string, string | undefined> }, location: Location,
  ): Promise<void> => {
    pressed.disabled = true;
    say(t('web.pdf.composing'), 'busy');
    const stage = doc.createElement('div');
    stage.style.cssText = 'position:absolute; left:-20000px; top:0; width:800px;';
    try {
      const fonts = await localFonts(win);
      subsetter ??= env.fetch(env.subsetterUrl)
        .then(response => { if (!response.ok) throw new ViewerError('web.pdf.noSubsetter'); return response.arrayBuffer(); })
        .then(wasm => createSubsetter(new Uint8Array(wasm)))
        .catch(error => { subsetter = undefined; throw error instanceof ViewerError ? error : new ViewerError('web.pdf.noSubsetter', {}, error); });
      const subset = await subsetter;

      // The review so far rides in the PDF, as it does from the extension.
      const rounds = source.paths.filter(path => /\.review\.yml$/i.test(path) && !held.texts.has(path));
      await Promise.all(rounds.map(async path => { held.texts.set(path, await source.text(path).catch(() => undefined)); }));

      // Laid out in the faces that will be embedded, so the lines break where they will on paper.
      stage.style.setProperty('--font-body', `"${fonts.families.body}"`);
      stage.style.setProperty('--font-heading', `"${fonts.families.body}"`);
      stage.style.setProperty('--font-mono', `"${fonts.families.mono}"`);
      stage.style.fontFamily = 'var(--font-body)';
      stage.innerHTML = composed.body;
      doc.body.append(stage);
      await drawn(stage, composed.body, true);
      await Promise.all([...stage.querySelectorAll('img')].map(image => image.decode().catch(() => undefined)));

      const raw = composed.prepared.document.frontmatter.raw;
      const version = raw['version']
        ? BUILD_MESSAGES.in(locale)('build.foot.version', { version: String(raw['version']) }) : '';
      const foot = [raw['document'], version].filter(value => value !== undefined && value !== '').map(String).join('　');
      const measured = measure(stage, { foot, title: String(raw['title'] ?? ''), locale });
      const sources = [composed.root, ...[...held.texts.keys()].filter(path => !/\.(review\.yml|css)$/i.test(path))];
      const review = reviewSourceOf({
        workspace, prepared: composed.prepared, style: composed.style, out: '', diagnostics: [], sources,
        root: { path: composed.root, document: composed.prepared.document, formats: ['pdf'] },
        options: { commit: location.sha, clean: true },
      });
      const { bytes, missing } = await writePdf(measured.plan, { fonts: fonts.set, subset, review });

      const name = `${String(raw['document'] ?? location.path.slice(location.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''))}.pdf`;
      download(doc, name, bytes);
      const lost = [...new Set(missing.map(one => one.character))].join('');
      say(t('web.pdf.made', { pages: String(measured.plan.pages.length), font: fonts.name })
        + (lost ? t('web.pdf.missing', { characters: lost }) : ''), lost ? 'refused' : 'ok');
    } catch (error) {
      say(explain(error, message => t('web.pdf.failed', { message })), 'refused');
    } finally {
      stage.remove();
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
