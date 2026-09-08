/**
 * The `flat` serializer, proved as a unit.
 *
 * The tree, the asset resolver and the document map all arrive as arguments, so
 * every rule this emitter enforces is checkable without a browser, a filesystem or
 * a session — which is the lesson C-4e paid for: a fault that inspection cannot see
 * is found by a fixture with a known answer, not by opening one real site.
 */
import { emitDocument, rewriteCssUrls, type ElementNode } from './generate/flatHtml.js'

export function proveFlatHtml(): { lines: string[]; failures: number } {
  const lines: string[] = []
  let failures = 0
  const check = (name: string, cond: boolean, detail = ''): void => {
    if (cond) lines.push(`  ok   ${name}`)
    else { lines.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); failures++ }
  }

  const el = (n: string, a: Record<string, string> = {}, c: ElementNode['c'] = []): ElementNode =>
    ({ t: 'element', n, a, c })
  const text = (v: string) => ({ t: 'text' as const, v })

  const held: Record<string, string> = {
    'https://shop.test/logo.png': 'assets/aaaa1111.png',
    'https://shop.test/logo@2x.png': 'assets/bbbb2222.png',
    'https://cdn.test/hero.webp': 'assets/cccc3333.webp',
    'https://cdn.test/font.woff2': 'assets/dddd4444.woff2',
    'https://shop.test/favicon.ico': 'assets/eeee5555.ico',
  }
  const docs: Record<string, string> = { 'https://shop.test/produto': 'produto/index.html' }
  const deps = {
    resolve: (u: string) => held[u] ?? null,
    document: (u: string) => docs[u] ?? null,
    stylesheets: ['styles/000-1a2b.css', 'styles/001-3c4d.css'],
    baseUrl: 'https://shop.test/',
  }

  const tree: ElementNode = el('html', { lang: 'pt-BR' }, [
    el('head', {}, [
      el('title', {}, [text('Loja & Cia')] as ElementNode['c']),
      el('base', { href: 'https://shop.test/app/' }),
      el('link', { rel: 'stylesheet', href: 'https://cdn.test/app.css' }),
      el('link', { rel: 'preload', href: 'https://cdn.test/x.js', as: 'script' }),
      el('link', { rel: 'manifest', href: '/manifest.json' }),
      el('link', { rel: 'icon', href: '/favicon.ico' }),
      el('meta', { 'http-equiv': 'Content-Security-Policy', content: "default-src 'none'" }),
      el('meta', { name: 'viewport', content: 'width=device-width' }),
      el('style', {}, [text('body{color:red}')] as ElementNode['c']),
      el('script', { src: 'https://cdn.test/app.js', integrity: 'sha384-x' }),
    ]),
    el('body', {}, [
      el('img', {
        src: '/logo.png',
        srcset: '/logo.png 1x, /logo@2x.png 2x, /missing.png 3x',
        loading: 'lazy',
        alt: 'a "quoted" & < tricky > alt',
      }),
      el('img', { src: 'https://gone.test/never-captured.png', alt: 'gap' }),
      el('div', { style: 'background:url(https://cdn.test/hero.webp) no-repeat' }),
      el('a', { href: 'https://shop.test/produto' }, [text('captured page')] as ElementNode['c']),
      el('a', { href: 'https://elsewhere.test/go' }, [text('out')] as ElementNode['c']),
      // 71 of 87 links on a real page look like this — and every one of them used to
      // dead-end inside the bundle
      el('a', { href: '/store/all' }, [text('root-relative')] as ElementNode['c']),
      el('a', { href: 'sub/page' }, [text('document-relative')] as ElementNode['c']),
      el('a', { href: '#reviews' }, [text('same page')] as ElementNode['c']),
      el('a', { href: 'javascript:openMenu()' }, [text('script link')] as ElementNode['c']),
      el('a', { href: '/produto' }, [text('captured, relative')] as ElementNode['c']),
      el('form', { action: '/store/all', method: 'get' }, []),
      el('button', { onclick: 'doThing()', class: 'btn' }, [text('click')] as ElementNode['c']),
      el('script', {}, [text('window.x=1')] as ElementNode['c']),
      el('noscript', {}, [text('turn on javascript')] as ElementNode['c']),
      { ...el('input', { type: 'text', name: 'q' }), s: { value: 'terraria' } },
      { ...el('input', { type: 'checkbox' }), s: { checked: true } },
      {
        ...el('my-widget', { class: 'w' }),
        shadow: {
          mode: 'open' as const,
          root: el('#shadow-root', {}, [el('span', {}, [text('inside')] as ElementNode['c'])]),
        },
      },
      {
        ...el('iframe', { src: 'https://widget.review.test/box.html', title: 'reviews' }),
        doc: { src: 'https://widget.review.test/box.html', crossOrigin: true, root: null },
      },
      // a frame the agent never reached at all — no doc record, src still live
      el('iframe', { src: 'https://tracker.test/pixel.html', width: '1', height: '1' }),
      { ...el('canvas', { width: '640', height: '480' }), canvas: { w: 640, h: 480, substitute: null } },
      el('pre', {}, [text('  keep\n  this  ')] as ElementNode['c']),
    ]),
  ])

  const out = emitDocument(tree, deps)

  check('the flat document opens with a doctype',
    out.html.startsWith('<!doctype html>\n<html lang="pt-BR">'))

  // the point of the emitter
  check('no <script> element survives', !/<script/i.test(out.html))
  check('no inline event handler survives', !/onclick/i.test(out.html))
  check('<noscript> is dropped — its content never rendered',
    !out.html.includes('turn on javascript'))

  // the cascade (IR-4 / I3)
  check('our stylesheets are injected in cascade order',
    out.html.indexOf('styles/000-1a2b.css') < out.html.indexOf('styles/001-3c4d.css') &&
    out.html.includes('<link rel="stylesheet" href="styles/000-1a2b.css">'))
  check("the origin's own stylesheet link is gone", !out.html.includes('cdn.test/app.css'))
  check('the inline <style> is gone — the CSSOM already carries that text',
    !out.html.includes('body{color:red}'))
  check('the cascade lands inside <head>',
    out.html.indexOf('styles/000-1a2b.css') < out.html.indexOf('</head>'))

  // what a page that runs nothing must not carry
  check('<base> is dropped — it would break every relative path', !/<base/i.test(out.html))
  check('their CSP is dropped — ours is derived from the closed world',
    !out.html.includes('default-src'))
  check('rel=preload and rel=manifest are dropped',
    !out.html.includes('rel="preload"') && !out.html.includes('rel="manifest"'))
  check('rel=icon survives, rehosted',
    out.html.includes('<link rel="icon" href="assets/eeee5555.ico">'))
  check('the viewport meta survives', out.html.includes('name="viewport"'))

  // assets
  check('an image src becomes the local asset', out.html.includes('src="assets/aaaa1111.png"'))
  check('srcset keeps its descriptors and drops what we do not hold',
    out.html.includes('srcset="assets/aaaa1111.png 1x, assets/bbbb2222.png 2x"'),
    out.html.match(/srcset="[^"]*"/)?.[0] ?? 'no srcset')
  check('loading=lazy is dropped — nothing will scroll this page',
    !out.html.includes('loading='))
  check('url() in a style attribute is rewritten',
    out.html.includes(`background:url('assets/cccc3333.webp') no-repeat`))
  check('an asset we never captured is reported and its attribute dropped (E2)',
    out.missing.includes('https://gone.test/never-captured.png') && !out.html.includes('gone.test'),
    JSON.stringify(out.missing))
  check('a dropped srcset candidate is reported too',
    out.missing.includes('https://shop.test/missing.png'), JSON.stringify(out.missing))

  // links are destinations, not bytes
  check('a link to a page we captured points at our copy',
    out.html.includes('href="produto/index.html"'))
  check('a link we never captured keeps its absolute destination',
    out.html.includes('href="https://elsewhere.test/go"'))
  check('a root-relative link becomes absolute instead of dead-ending in the bundle',
    out.html.includes('href="https://shop.test/store/all"'),
    out.html.match(/href="[^"]*store\/all"/)?.[0] ?? 'not found')
  check('a document-relative link is resolved against the page, not our origin',
    out.html.includes('href="https://shop.test/sub/page"'))
  check('a relative link to a page we DID capture still points at our copy',
    out.html.includes('href="produto/index.html"'))
  check('an in-page anchor stays an in-page anchor', out.html.includes('href="#reviews"'))
  check('a javascript: link is dropped — it is inline script', !out.html.includes('javascript:'))
  check("a form's action is a destination too", out.html.includes('action="https://shop.test/store/all"'))
  check('no navigation target is left root-relative',
    !/(?:href|action)="\/(?!\/)/.test(out.html),
    (out.html.match(/(?:href|action)="\/[^"]*"/g) ?? []).join(' | '))

  // fidelity
  check('text is escaped', out.html.includes('Loja &amp; Cia'))
  check('attribute values are escaped',
    out.html.includes('alt="a &quot;quoted&quot; &amp; < tricky > alt"'),
    out.html.match(/alt="[^"]*"/)?.[0] ?? 'no alt')
  check('a void element is not closed',
    out.html.includes('<meta name="viewport" content="width=device-width">'))
  check('<pre> whitespace is preserved', out.html.includes('<pre>  keep\n  this  </pre>'))
  check('a live input value is emitted as an attribute', out.html.includes('value="terraria"'))
  check('a checked box stays checked', out.html.includes('checked=""'))
  check('a shadow root becomes declarative shadow DOM, needing no script',
    out.html.includes('<template shadowrootmode="open"><span>inside</span></template>'))
  check('a blank canvas is named as a limitation, not hidden',
    out.warnings.some((w) => w.includes('canvas left blank')), JSON.stringify(out.warnings))

  // The leak that reached a real eneba bundle: six live external frames — a review
  // widget, an anti-fraud SDK, three tracking pixels — in a supposedly closed world,
  // because `iframe` was not in the URL-attribute table and its src fell through.
  check('a cross-origin iframe is emitted with no src at all',
    /<iframe title="reviews"><\/iframe>/.test(out.html),
    out.html.match(/<iframe[^>]*>/g)?.join(' | ') ?? 'no iframe')
  check('a frame nobody captured loses its src too',
    !out.html.includes('tracker.test'), out.html.match(/<iframe[^>]*>/g)?.join(' | ') ?? '')
  check('and both are named, with the reason',
    out.warnings.some((w) => w.includes('cross-origin iframe emitted without src')) &&
    out.warnings.some((w) => w.includes('nothing was captured for it')),
    JSON.stringify(out.warnings))
  check('NO src attribute in the document points outside the bundle (E2, mechanical)',
    !/\ssrc="(?!assets\/)[^"]*(?:https?:)?\/\//.test(out.html),
    (out.html.match(/\ssrc="[^"]*"/g) ?? []).join(' | '))

  // the cascade text itself
  const css = [
    '@font-face{font-family:X;src:url("https://cdn.test/font.woff2") format("woff2")}',
    'a:hover{color:red}',
    '.hero{background-image:url(https://cdn.test/hero.webp)}',
    ".gap{background:url('https://gone.test/nope.png')}",
    '.data{background:url(data:image/gif;base64,R0lGOD)}',
    '@media (min-width:900px){.hero{background-image:url(/logo.png)}}',
  ].join('\n')
  const cssMissing: string[] = []
  const rewritten = rewriteCssUrls(css, deps.resolve, deps.baseUrl, (u) => cssMissing.push(u))

  check('@font-face src is rewritten', rewritten.includes(`url('assets/dddd4444.woff2')`))
  check('a :hover rule survives untouched', rewritten.includes('a:hover{color:red}'))
  check('an unquoted url() is rewritten',
    rewritten.includes(`.hero{background-image:url('assets/cccc3333.webp')}`))
  check('url() inside @media is rewritten',
    rewritten.includes('@media (min-width:900px)') && rewritten.includes(`url('assets/aaaa1111.png')`))
  check('a data: url is left alone', rewritten.includes('url(data:image/gif;base64,R0lGOD)'))
  check('a missing css asset is neutralised and reported',
    cssMissing.includes('https://gone.test/nope.png') && !rewritten.includes('gone.test'),
    JSON.stringify(cssMissing))

  const headless = emitDocument(
    el('html', {}, [el('body', {}, [text('hi')] as ElementNode['c'])]), deps,
  )
  check('a tree with no <head> still gets the cascade',
    headless.html.includes('<head><link rel="stylesheet" href="styles/000-1a2b.css">'))
  check('and says so in a warning',
    headless.warnings.some((w) => w.includes('no <head>')))

  return { lines, failures }
}
