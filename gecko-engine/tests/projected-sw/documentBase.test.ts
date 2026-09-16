/** Base da página projetada: URL relativa resolve no site, não no lab. Sem Gecko. */
import {
  constructedStyleSheetInit,
  ensureProjectedDocumentBase,
} from '../../../packages/page-projection/src/projected/projectedBlankIframe.ts';

function fail(msg: string): never {
  console.error('FALHOU:', msg);
  process.exit(1);
}

type AttrNode = {
  href: string;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
};

function makeDoc(): { doc: Document; baseHref: () => string | null } {
  const kids: AttrNode[] = [];
  const head = {
    firstChild: null as AttrNode | null,
    querySelector(sel: string): AttrNode | null {
      if (!sel.includes('data-speculum-document-base')) return null;
      return kids.find((n) => n.attrs['data-speculum-document-base'] === '1') ?? null;
    },
    insertBefore(el: AttrNode, _ref: AttrNode | null) {
      kids.unshift(el);
      this.firstChild = kids[0] ?? null;
      return el;
    },
  };
  const doc = {
    head,
    createElement(_tag: string): AttrNode {
      const node: AttrNode = {
        href: '',
        attrs: {},
        setAttribute(name, value) {
          this.attrs[name] = value;
          if (name === 'href') this.href = value;
        },
        getAttribute(name) {
          return this.attrs[name] ?? null;
        },
      };
      return node;
    },
  };
  return {
    doc: doc as unknown as Document,
    baseHref: () => kids[0]?.href ?? kids[0]?.attrs.href ?? null,
  };
}

const page = 'https://pt.wikipedia.org/wiki/X';
const init = constructedStyleSheetInit(page);
if (!init || init.baseURL !== 'https://pt.wikipedia.org/wiki/X') {
  fail(`baseURL da sheet: ${init?.baseURL}`);
}
if (constructedStyleSheetInit(undefined) !== undefined) {
  fail('sheet sem URL nao e undefined');
}

const resolved = new URL('/static/images/mobile/copyright/wikipedia-wordmark-fr.svg', init.baseURL).href;
if (resolved !== 'https://pt.wikipedia.org/static/images/mobile/copyright/wikipedia-wordmark-fr.svg') {
  fail(`relativo contra o site: ${resolved}`);
}
const labLeaked = new URL(
  '/static/images/mobile/copyright/wikipedia-wordmark-fr.svg',
  'http://127.0.0.1:4077/',
).href;
if (!labLeaked.startsWith('http://127.0.0.1:4077/')) {
  fail('controle lab origin');
}
if (resolved === labLeaked) {
  fail('relativo bateu com o lab');
}

const { doc, baseHref } = makeDoc();
ensureProjectedDocumentBase(doc, page);
const href = baseHref();
if (href !== 'https://pt.wikipedia.org/wiki/X') {
  fail(`<base href>: ${href}`);
}

ensureProjectedDocumentBase(doc, 'https://pt.wikipedia.org/wiki/Y');
if (baseHref() !== 'https://pt.wikipedia.org/wiki/Y') {
  fail(`<base> nao atualizou: ${baseHref()}`);
}

console.log('ok: base da pagina + baseURL da sheet');
