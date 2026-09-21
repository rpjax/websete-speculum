/**
 * Leitura de marcadores do mundo MAIN sob patchright.
 *
 * patchright roda page.evaluate em ExecutionContext ISOLADO (README, patch do
 * Runtime.enable). Mundo isolado tem copia propria de Element.prototype etc, entao
 * patch de content script MAIN e INVISIVEL de la. Ler dali sempre da false.
 *
 * Canal: DOM. Um <script> inline roda no MAIN, escreve o resultado num atributo,
 * o mundo isolado le o atributo. Node e compartilhado; prototipo nao.
 */
const MARKER_ATTR = 'data-speculum-probe';

const MAIN_SNIPPET = `(() => {
  const isNative = (fn) => { try { return /native code/.test(Function.prototype.toString.call(fn)); } catch { return null; } };
  const g = window.WebGLRenderingContext && window.WebGLRenderingContext.prototype.getParameter;
  const out = {
    world: 'main',
    webglPatched: g ? isNative(g) === false : null,
    webglOrigOnProto: !!(window.WebGLRenderingContext && '__speculumWebglOrigGetParam' in window.WebGLRenderingContext.prototype),
    webglProtoSpeculumProps: window.WebGLRenderingContext ? Object.getOwnPropertyNames(window.WebGLRenderingContext.prototype).filter((n) => /speculum/i.test(n)) : [],
    setAttributePatched: isNative(Element.prototype.setAttribute) === false,
    appendChildPatched: isNative(Node.prototype.appendChild) === false,
    attachShadowPatched: isNative(Element.prototype.attachShadow) === false,
    openerLocked: (() => { const d = Object.getOwnPropertyDescriptor(window, 'opener'); return !!d && d.configurable === false; })(),
    speculumGlobals: Object.getOwnPropertyNames(window).filter((n) => /speculum/i.test(n)),
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    dpr: window.devicePixelRatio,
  };
  document.documentElement.setAttribute(${JSON.stringify(MARKER_ATTR)}, JSON.stringify(out));
})();`;

/**
 * @returns objeto do MAIN, ou { mainUnreachable: true } quando o script inline foi
 * barrado (CSP). mainUnreachable NAO significa "sem extensao" — significa sem leitura.
 */
async function readMainWorld(page) {
  return page
    .evaluate(
      ({ snippet, attr }) => {
        try {
          document.documentElement.removeAttribute(attr);
          const s = document.createElement('script');
          s.textContent = snippet;
          (document.head || document.documentElement).appendChild(s);
          s.remove();
          const raw = document.documentElement.getAttribute(attr);
          document.documentElement.removeAttribute(attr);
          if (!raw) return { mainUnreachable: true, reason: 'inline script nao executou (CSP?)' };
          return JSON.parse(raw);
        } catch (e) {
          return { mainUnreachable: true, reason: String(e).slice(0, 200) };
        }
      },
      { snippet: MAIN_SNIPPET, attr: MARKER_ATTR },
    )
    .catch((e) => ({ mainUnreachable: true, reason: String(e).slice(0, 200) }));
}

/** Extensao presente = qualquer marcador estrutural. null quando nao houve leitura. */
function extensionPresent(main) {
  if (!main || main.mainUnreachable) return null;
  return !!(
    main.webglOrigOnProto ||
    main.openerLocked ||
    (main.speculumGlobals && main.speculumGlobals.length > 0) ||
    (main.webglProtoSpeculumProps && main.webglProtoSpeculumProps.length > 0)
  );
}

module.exports = { readMainWorld, extensionPresent, MAIN_SNIPPET };
