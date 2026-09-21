/**
 * Lab-only: DOM-apply captured frame bins served from /lab/static to isolate Projected apply
 * defects without a live Virtual session.
 */
import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
  peekFrameHeader,
} from '@speculum/page-projection/core/decode';
import { CONTEXT_ID_ROOT, DOCUMENT_ID } from '@speculum/page-projection/core/frame';
import {
  DomFrameApplier,
  PageProjectionRegistry,
  stampProjectedStandardsSrcdoc,
  whenProjectedStandardsReady,
} from '@speculum/page-projection/projected';

export type DiagDomApplyResult = {
  ok: boolean;
  frames: number;
  lastSequence: number | null;
  desync: {
    reason: string;
    op?: string;
    id?: number;
    message?: string;
    sequence?: number;
  } | null;
  registrySize: number;
  htmlLen: number;
  error?: string;
};

export async function diagDomApplyFrameUrls(urls: string[]): Promise<DiagDomApplyResult> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;';
  document.body.appendChild(host);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%;height:100%;border:0';
  stampProjectedStandardsSrcdoc(iframe);
  host.appendChild(iframe);
  try {
    await whenProjectedStandardsReady(iframe);
    const doc = iframe.contentDocument;
    if (!doc) return { ok: false, frames: 0, lastSequence: null, desync: null, registrySize: 0, htmlLen: 0, error: 'no contentDocument' };

    const registry = new PageProjectionRegistry();
    registry.register(DOCUMENT_ID, doc);
    let desync: DiagDomApplyResult['desync'] = null;
    let lastSequence: number | null = null;
    const applier = new DomFrameApplier(doc, registry, {
      onDesync: (info) => {
        desync = {
          reason: info.reason,
          op: info.op,
          id: info.id,
          message: info.message,
          sequence: info.sequence,
        };
      },
      onApplied: (frame) => {
        lastSequence = frame.sequence;
      },
      applyBudgetMs: 60_000,
    });

    const strings = new PersistentStringTable();
    const assembler = new FramePartAssembler();
    let frames = 0;

    for (const url of urls) {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const hdr = peekFrameHeader(buf);
      if (hdr && hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
      const decoded = decodeFramePart(buf, strings);
      if (!decoded.ok) {
        return {
          ok: false,
          frames,
          lastSequence,
          desync: { reason: decoded.reason, message: decoded.message },
          registrySize: registry.size,
          htmlLen: doc.documentElement?.outerHTML?.length ?? 0,
        };
      }
      const assembled = assembler.ingest(decoded.part);
      if (assembled === 'missing_part' || assembled === 'malformed') {
        return {
          ok: false,
          frames,
          lastSequence,
          desync: { reason: assembled },
          registrySize: registry.size,
          htmlLen: doc.documentElement?.outerHTML?.length ?? 0,
        };
      }
      if (assembled === null) continue;
      frames += 1;
      applier.enqueue(assembled);
      applier.flush();
      if (desync) {
        return {
          ok: false,
          frames,
          lastSequence,
          desync,
          registrySize: registry.size,
          htmlLen: doc.documentElement?.outerHTML?.length ?? 0,
        };
      }
    }

    return {
      ok: true,
      frames,
      lastSequence,
      desync: null,
      registrySize: registry.size,
      htmlLen: doc.documentElement?.outerHTML?.length ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      frames: 0,
      lastSequence: null,
      desync: null,
      registrySize: 0,
      htmlLen: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    host.remove();
  }
}
