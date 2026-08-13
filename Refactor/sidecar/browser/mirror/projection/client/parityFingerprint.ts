/**
 * Cheap structural fingerprint of the projected document (no HTML dump).
 */

import { isRepeatedConcat } from '../models/telemetry';
import type { PageProjectionRegistry } from './registry';

export type ParityFingerprintFields = {
  registrySize: number;
  title: string;
  h1: string;
  bodyChildTags: string;
  anchorCount: number;
  scriptCount: number;
  pCount: number;
  htmlLen: number;
  duplicateTitle: boolean;
  duplicateH1: boolean;
};

export function captureParityFingerprint(
  doc: Document,
  registry: PageProjectionRegistry,
): ParityFingerprintFields {
  const title = doc.title ?? '';
  const h1 = doc.querySelector('h1')?.textContent ?? '';
  const tags = [...(doc.body?.children ?? [])]
    .slice(0, 24)
    .map((el) => el.tagName.toLowerCase());
  return {
    registrySize: registry.size,
    title,
    h1,
    bodyChildTags: tags.join(','),
    anchorCount: doc.querySelectorAll('[speculum-anchor]').length,
    scriptCount: doc.querySelectorAll('script').length,
    pCount: doc.querySelectorAll('p').length,
    htmlLen: doc.documentElement?.outerHTML.length ?? 0,
    duplicateTitle: isRepeatedConcat(title),
    duplicateH1: isRepeatedConcat(h1),
  };
}
