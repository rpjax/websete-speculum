#!/usr/bin/env node
/**
 * Oracle: foco vs inserção no Virtual após keyDown.
 *
 * Uso (lab Gecko com sessão viva + evaluate no Virtual):
 *   node gecko-engine/devpath/_diag-gecko-keyboard-oracle.mjs
 *
 * Ou cole o bloco `probe` no evaluate do lab após focar um <input> e mandar keyDown "a".
 *
 * Residual GECKO-INPUT-NODE-TARGET (2026-09-17): value ficava "" — síntese sem
 * keyCode/charCode e sem insertText. Este script documenta o assert de efeito.
 */
const probe = `
(() => {
  const el = document.activeElement;
  const tag = el && el.tagName;
  const isEditable =
    tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable);
  const value =
    tag === 'INPUT' || tag === 'TEXTAREA' ? String(el.value ?? '') : null;
  const htmlFallback = tag === 'HTML' || tag === 'BODY';
  return {
    tag: tag || null,
    isEditable: !!isEditable,
    htmlFallback: !!htmlFallback,
    value,
    valueLen: value != null ? value.length : null,
    // Pass = focused editable com pelo menos 1 char após keyDown "a"
    pass: !!isEditable && !htmlFallback && typeof value === 'string' && value.length > 0,
  };
})()
`;

console.log(
  JSON.stringify(
    {
      purpose: 'effect-oracle keyboard insert after keyDown a',
      residualWas: 'value stays empty on search/email',
      evaluateProbe: probe.trim(),
      passWhen: 'isEditable && valueLen > 0 && !htmlFallback',
    },
    null,
    2,
  ),
);
