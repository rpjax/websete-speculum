import {
  disableProjectedNativeStylesheet,
  isHtmlStylesheetLink,
} from '@speculum/page-projection/projected/ownedStylesheetLink';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function stubLink(rel: string): HTMLLinkElement {
  let disabled = false;
  const attrs: Record<string, string> = { rel };
  const tokens = rel.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  return {
    nodeType: 1,
    localName: 'link',
    rel,
    relList: {
      contains(token: string) {
        return tokens.includes(token.toLowerCase());
      },
    },
    get disabled() {
      return disabled;
    },
    set disabled(v: boolean) {
      disabled = Boolean(v);
    },
    getAttribute(name: string) {
      if (name === 'disabled') return null;
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name]! : null;
    },
  } as HTMLLinkElement;
}

export function runOwnedStylesheetLinkUnitTests(): void {
  const sheet = stubLink('stylesheet');
  assert(isHtmlStylesheetLink(sheet) === true, 'rel=stylesheet is a stylesheet link');
  disableProjectedNativeStylesheet(sheet);
  assert(sheet.disabled === true, 'native stylesheet must be disabled for C6 owned CSSOM');
  assert(sheet.getAttribute('disabled') === null, 'disabled is IDL only — not a replicated attr');

  const preload = stubLink('stylesheet preload');
  disableProjectedNativeStylesheet(preload);
  assert(preload.disabled === true, 'rel list containing stylesheet is disabled');

  const icon = stubLink('icon');
  assert(isHtmlStylesheetLink(icon) === false, 'rel=icon is not a stylesheet');
  disableProjectedNativeStylesheet(icon);
  assert(icon.disabled === false, 'non-stylesheet link must not be disabled');

  console.log('[unit] ownedStylesheetLink ok');
}
