/**
 * Live CDP / navigation helpers — soft-nav (PP-NAV-2), closed-shadow adopt,
 * and cross-origin iframe pierce (PP-F-4).
 */

import type { Page, CDPSession, Frame } from 'patchright';
import { PAGE_PROJECTION_V2_PAGE_SCRIPT } from './inpageScript';
import {
  adoptAllClosedShadowsFromCdp,
  adoptClosedShadowPair,
  attachChildUnderIframe,
  collectXoIframeIds,
  maxRawNodeId,
  remapPierceTree,
  type PierceRawNode,
} from './cdpPierce';
import type { RawNode } from './snapshotTreeQuery';

export const BRIDGE_ONFRAME_SNIPPET = `(() => {
  const api = window.__speculumPageProjectionV2;
  if (!api || api.__ppv2Bridged) return;
  api.__ppv2Bridged = true;
  api.onFrame((tick) => {
    try { window.__speculumPPv2Tick(tick); } catch (e) {}
  });
})()`;

export const SNAPSHOT_DOCUMENT_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.snapshotDocument === 'function')
    ? window.__speculumPageProjectionV2.snapshotDocument()
    : null
`;

/** Stage full-tree JSON on Virtual, then pull in ≤256KiB slices (Beleza-scale CDP). */
const STAGE_DOCUMENT_JSON_SNIPPET = `(() => {
  const api = window.__speculumPageProjectionV2;
  if (!api || typeof api.snapshotDocument !== 'function') return { ok: false, reason: 'no_api' };
  let raw;
  try { raw = api.snapshotDocument(); } catch (e) { return { ok: false, reason: 'snap_throw', detail: String(e && e.message || e).slice(0, 200) }; }
  if (!raw) return { ok: false, reason: 'empty' };
  let json;
  try { json = JSON.stringify(raw); } catch (e) { return { ok: false, reason: 'stringify_throw', detail: String(e && e.message || e).slice(0, 200) }; }
  window.__speculumPPv2EstablishJson = json;
  return { ok: true, length: json.length };
})()`;

const CLEAR_DOCUMENT_JSON_SNIPPET = `(() => { try { delete window.__speculumPPv2EstablishJson; } catch (_) {} return true; })()`;

const DOCUMENT_JSON_SLICE_CHUNK = 256 * 1024;

export const READ_EPOCH_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.getEpochId === 'function')
    ? window.__speculumPageProjectionV2.getEpochId()
    : null
`;

export function safeHost(url: string): string {
  try {
    return new URL(url).host || 'invalid.local';
  } catch {
    return 'invalid.local';
  }
}

export function isBlankDocumentUrl(url: string): boolean {
  const u = (url || '').trim().toLowerCase();
  return !u || u === 'about:blank' || u.startsWith('chrome-error://');
}

export async function installLivePageScript(page: Page): Promise<void> {
  await page.addInitScript({ content: PAGE_PROJECTION_V2_PAGE_SCRIPT });
  await page.evaluate(PAGE_PROJECTION_V2_PAGE_SCRIPT).catch(() => {});
}

export async function bridgeLiveOnFrame(page: Page): Promise<void> {
  await page.evaluate(BRIDGE_ONFRAME_SNIPPET).catch(() => {});
}

export async function readDocumentEpoch(page: Page): Promise<string | null> {
  try {
    const epoch = await page.evaluate(READ_EPOCH_SNIPPET);
    return typeof epoch === 'string' ? epoch : null;
  } catch {
    return null;
  }
}

export type LiveCdpSoftNavHooks = {
  mintPageEpoch: (args: { soft: boolean; documentEpoch?: string | null }) => void;
  onSoftNavObserved?: (event: {
    generation: number;
    url?: string;
    documentEpoch?: string;
    liveArmed: boolean;
  }) => void;
  getGeneration: () => number;
  isLiveArmed: () => boolean;
  setSoftNavEpoch: (epoch: string | null) => void;
};

/**
 * W4 — CDP session for soft-nav corroboration (Page.navigatedWithinDocument) and
 * closed-shadow / XO pierce. Soft-nav sets softNavEpoch before framenavigated
 * so onMainFrameNavigated can skip generation bump (PP-NAV-2).
 */
export async function attachLiveCdpSession(opts: {
  page: Page;
  cdp: CDPSession | null;
  isStopped: () => boolean;
  getMainFrameCdpId: () => string | null;
  setMainFrameCdpId: (id: string | null) => void;
  setCdp: (cdp: CDPSession) => void;
  softNav: LiveCdpSoftNavHooks;
  onShadowAdopted: () => void;
  adoptClosedShadows: () => Promise<void>;
}): Promise<CDPSession | null> {
  if (opts.cdp || opts.isStopped()) return opts.cdp;
  try {
    const cdp = await opts.page.context().newCDPSession(opts.page);
    opts.setCdp(cdp);
    await cdp.send('DOM.enable');
    await cdp.send('Page.enable');
    try {
      await cdp.send('CSS.enable');
    } catch {
      /* W4 optional on older builds */
    }
    try {
      const frameTree = (await cdp.send('Page.getFrameTree')) as {
        frameTree?: { frame?: { id?: string } };
      };
      const id = frameTree?.frameTree?.frame?.id;
      if (typeof id === 'string' && id) opts.setMainFrameCdpId(id);
    } catch {
      /* optional */
    }
    cdp.on('Page.frameNavigated', (ev: { frame?: { id?: string; parentId?: string } }) => {
      if (ev.frame && !ev.frame.parentId && typeof ev.frame.id === 'string') {
        opts.setMainFrameCdpId(ev.frame.id);
      }
    });
    cdp.on('Page.navigatedWithinDocument', (ev: { frameId?: string }) => {
      if (opts.isStopped()) return;
      const mainFrameCdpId = opts.getMainFrameCdpId();
      if (mainFrameCdpId && ev.frameId && ev.frameId !== mainFrameCdpId) return;
      void readDocumentEpoch(opts.page)
        .then((epoch) => {
          if (epoch) {
            opts.softNav.setSoftNavEpoch(epoch);
            opts.softNav.mintPageEpoch({ soft: true, documentEpoch: epoch });
          }
          opts.softNav.onSoftNavObserved?.({
            generation: opts.softNav.getGeneration(),
            url: (() => {
              try {
                return opts.page.url();
              } catch {
                return undefined;
              }
            })(),
            documentEpoch: epoch ?? undefined,
            liveArmed: opts.softNav.isLiveArmed(),
          });
        })
        .catch(() => {});
    });
    cdp.on('DOM.shadowRootPushed', (ev: { hostId?: number; rootId?: number; root?: { nodeId?: number } }) => {
      if (opts.isStopped()) return;
      const hostId = ev.hostId;
      const shadowId = ev.rootId ?? ev.root?.nodeId;
      if (hostId == null || shadowId == null) return;
      void adoptClosedShadowPair(cdp, hostId, shadowId).then(() => {
        opts.onShadowAdopted();
      });
    });
    await opts.adoptClosedShadows();
    return cdp;
  } catch {
    /* CDP unavailable — soft-nav falls back to hard-nav; open shadows still work via attachShadow hook. */
    return null;
  }
}

export async function adoptClosedShadowsWithParity(opts: {
  cdp: CDPSession | null;
  isStopped: () => boolean;
  pageEpochId: string;
  generation: number;
  onParity?: (kind: string, payload: Record<string, unknown>) => void;
}): Promise<void> {
  if (!opts.cdp || opts.isStopped()) return;
  try {
    const n = await adoptAllClosedShadowsFromCdp(opts.cdp);
    if (n > 0) {
      opts.onParity?.('parity_closed_shadow_adopted', {
        pageEpochId: opts.pageEpochId,
        count: n,
        generation: opts.generation,
      });
    }
  } catch {
    /* ignore */
  }
}

/** PP-F-4 — inject V2 script into XO child frames and merge remapped interiors under the host iframe. */
export async function mergeCrossOriginIframes(opts: {
  page: Page;
  raw: RawNode;
  cdp: CDPSession | null;
  xoIdMaps: Map<Frame, Map<number, number>>;
  xoFrameByIframeId: Map<number, Frame>;
}): Promise<RawNode> {
  const { page, raw, cdp, xoIdMaps, xoFrameByIframeId } = opts;
  const xoIds = collectXoIframeIds(raw as PierceRawNode);
  if (xoIds.length === 0) return raw;
  const nextId = { value: maxRawNodeId(raw as PierceRawNode) + 1 };
  for (const iframeId of xoIds) {
    try {
      const handle = await page.evaluateHandle((id) => {
        const g = globalThis as typeof globalThis & {
          __speculumPageProjectionV2?: { resolve?: (n: number) => unknown };
        };
        return g.__speculumPageProjectionV2?.resolve?.(id) ?? null;
      }, iframeId);
      const el = handle.asElement();
      if (!el) {
        await handle.dispose().catch(() => undefined);
        continue;
      }
      const frame = await el.contentFrame();
      await handle.dispose().catch(() => undefined);
      if (!frame || frame === page.mainFrame()) continue;

      await frame.evaluate('try { delete window.__speculumPageProjectionV2; } catch (e) {}').catch(() => undefined);
      await frame.evaluate(PAGE_PROJECTION_V2_PAGE_SCRIPT);
      await frame.evaluate(`(() => {
          const api = window.__speculumPageProjectionV2;
          if (!api || typeof api.onFrame !== 'function') return;
          api.onFrame((tick) => {
            try {
              window.__speculumPPv2Tick && window.__speculumPPv2Tick(tick);
            } catch (e) {}
          });
        })()`).catch(() => undefined);

      const childRaw = (await frame.evaluate(SNAPSHOT_DOCUMENT_SNIPPET)) as PierceRawNode | null;
      if (!childRaw) continue;
      const idMap = new Map<number, number>();
      const remapped = remapPierceTree(childRaw, nextId, idMap);
      xoIdMaps.set(frame, idMap);
      xoFrameByIframeId.set(iframeId, frame);
      attachChildUnderIframe(raw as PierceRawNode, iframeId, remapped);
      if (cdp) await adoptAllClosedShadowsFromCdp(cdp).catch(() => 0);
    } catch {
      /* frame detached / mid-navigation */
    }
  }
  return raw;
}

export async function snapshotDocumentRaw(opts: {
  page: Page;
  cdp: CDPSession | null;
  xoIdMaps: Map<Frame, Map<number, number>>;
  xoFrameByIframeId: Map<number, Frame>;
}): Promise<RawNode | null> {
  const pageWithTimeout = opts.page as Page & {
    setDefaultTimeout?: (ms: number) => void;
    getDefaultTimeout?: () => number;
  };
  const prevTimeout = pageWithTimeout.getDefaultTimeout?.() ?? 30_000;
  pageWithTimeout.setDefaultTimeout?.(180_000);
  try {
    const staged = (await opts.page.evaluate(STAGE_DOCUMENT_JSON_SNIPPET)) as {
      ok?: boolean;
      length?: number;
      reason?: string;
    } | null;
    if (!staged || !staged.ok || typeof staged.length !== 'number' || staged.length <= 0) {
      return null;
    }
    const parts: string[] = [];
    for (let start = 0; start < staged.length; start += DOCUMENT_JSON_SLICE_CHUNK) {
      const end = Math.min(staged.length, start + DOCUMENT_JSON_SLICE_CHUNK);
      const slice = await opts.page.evaluate(
        ({ s, e }: { s: number; e: number }) => {
          const json = (globalThis as unknown as { __speculumPPv2EstablishJson?: string })
            .__speculumPPv2EstablishJson;
          return typeof json === 'string' ? json.slice(s, e) : '';
        },
        { s: start, e: end },
      );
      if (typeof slice !== 'string' || slice.length === 0) {
        await opts.page.evaluate(CLEAR_DOCUMENT_JSON_SNIPPET).catch(() => undefined);
        return null;
      }
      parts.push(slice);
    }
    await opts.page.evaluate(CLEAR_DOCUMENT_JSON_SNIPPET).catch(() => undefined);
    let raw: RawNode | null = null;
    try {
      raw = JSON.parse(parts.join('')) as RawNode;
    } catch {
      return null;
    }
    if (raw) {
      raw = await mergeCrossOriginIframes({
        page: opts.page,
        raw,
        cdp: opts.cdp,
        xoIdMaps: opts.xoIdMaps,
        xoFrameByIframeId: opts.xoFrameByIframeId,
      });
    }
    return raw;
  } catch {
    await opts.page.evaluate(CLEAR_DOCUMENT_JSON_SNIPPET).catch(() => undefined);
    return null;
  } finally {
    pageWithTimeout.setDefaultTimeout?.(prevTimeout);
  }
}

/**
 * Main-frame `framenavigated` handling: soft-nav skip (PP-NAV-2), first establish,
 * or hard re-establish after generation bump.
 */
export async function handleLiveMainFrameNavigated(opts: {
  page: Page;
  isStopped: () => boolean;
  getSoftNavEpoch: () => string | null;
  setSoftNavEpoch: (epoch: string | null) => void;
  getDocumentEpoch: () => string | null;
  setDocumentEpoch: (epoch: string | null) => void;
  getPageEpochId: () => string;
  isEstablished: () => boolean;
  getGeneration: () => number;
  mintPageEpoch: (args: { soft: boolean; documentEpoch?: string | null }) => void;
  onSoftNavObserved?: (event: {
    generation: number;
    url?: string;
    documentEpoch?: string;
    liveArmed: boolean;
  }) => void;
  ensureCdpSession: () => Promise<void>;
  adoptClosedShadows: () => Promise<void>;
  runEstablish: () => Promise<void>;
  onHardNav: (url: string) => Promise<void>;
}): Promise<void> {
  if (opts.isStopped()) return;
  try {
    const url = opts.page.url();
    if (isBlankDocumentUrl(url)) return;
    await installLivePageScript(opts.page);
    await bridgeLiveOnFrame(opts.page);
    await opts.ensureCdpSession();
    await opts.adoptClosedShadows();

    const epoch = await readDocumentEpoch(opts.page);
    if (epoch === null) return;

    // Soft (same-document) navigation — never bump generation / re-establish (PP-NAV-2).
    const softNavEpoch = opts.getSoftNavEpoch();
    if (softNavEpoch !== null && epoch === softNavEpoch) {
      opts.setSoftNavEpoch(null);
      opts.setDocumentEpoch(epoch);
      // Soft-nav already minted pageEpoch via CDP navigatedWithinDocument when available.
      if (!opts.getPageEpochId()) opts.mintPageEpoch({ soft: true, documentEpoch: epoch });
      opts.onSoftNavObserved?.({
        generation: opts.getGeneration(),
        url,
        documentEpoch: epoch,
        liveArmed: opts.isEstablished(),
      });
      return;
    }

    if (!opts.isEstablished()) {
      await opts.runEstablish();
      opts.setDocumentEpoch(epoch);
      return;
    }

    if (epoch === opts.getDocumentEpoch()) return;
    opts.setDocumentEpoch(epoch);
    await opts.onHardNav(url);
  } catch {
    /* mid-navigation — the next framenavigated retries. */
  }
}
