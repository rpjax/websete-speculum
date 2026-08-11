import type { Page } from 'patchright';
import { DomAssetCache, isPassThroughUrl, type DomAssetShareability } from '../dom/DomAssetCache';
import { PAGE_PROJECTION_V2_PAGE_SCRIPT } from './inpageScript';
import { PageProjectionEngine, type PageProjectionEngineEvents } from './PageProjection';
import type { FrameClockScheduler } from './clock';
import type { ChildRef, FrameTreeQuery } from './frame';
import { createDirtyState, type DirtyState } from './observe';
import {
  publishElementSnapshot,
  publishTextSnapshot,
  publishCommentSnapshot,
  type FNode,
} from './fmap';
import { NONE_NODE_ID, type NodeId } from './identity';
import { encodeFrame, type EncodedFrameMeta, type WireOp } from './encode';
import { buildEstablishBegin, computeEstablishChecksum, splitHtmlIntoChunks } from './establish';
import { NodeMirror } from './node/mirror';
import { UrlRewriter } from './node/rewrite';

/**
 * §9 live cutover (Phase C1) — thin Node-side orchestration wiring the V2
 * producer modules into a real `Page`. Mirrors the V1 `PageProjection` call
 * surface used by `PatchrightBrowserSession` so the two are drop-in
 * compatible; V2-only concerns (soft-nav detection, scroll ops, shadow DOM,
 * scroll/element resync fidelity) stay stubbed for C2/C3 — see class doc.
 */

const WIRE_VERSION = 1;

export type LivePageProjectionEvents = {
  onPageProjectionDiff(diff: {
    sequence: number;
    generation: number;
    plane: string;
    operation: string;
    timestampMs: number;
    body: Uint8Array;
    partIndex?: number;
    partCount?: number;
    flags?: number;
    version?: number;
  }): void;
  onGenerationBumped?(event: {
    fromGeneration: number;
    toGeneration: number;
    reason: string;
    url?: string;
    diffKind?: string;
  }): void;
  onSoftNavObserved?(event: {
    generation: number;
    url?: string;
    documentEpoch?: string;
    liveArmed: boolean;
  }): void;
  onScrollEchoHit?(event: {
    kind: 'viewport' | 'element';
    generation?: number;
    anchor?: string;
    scrollX?: number;
    scrollY?: number;
    scrollTop?: number;
    scrollLeft?: number;
  }): void;
  onParity?(kind: string, payload: Record<string, unknown>): void;
};

export type LivePageProjectionNavigationType = 'goto' | 'reload' | 'back_forward' | 'soft' | 'unknown';

type LiveNode = { readonly id: NodeId };
type RawElement = { kind: 'element'; id: number; tag: string; attrs: [string, string][]; children: RawNode[] };
type RawText = { kind: 'text'; id: number; value: string };
type RawComment = { kind: 'comment'; id: number; value: string };
type RawNode = RawElement | RawText | RawComment;
type CacheEntry = { raw: RawNode; parentId: NodeId; order: number };

function safeHost(url: string): string {
  try {
    return new URL(url).host || 'invalid.local';
  } catch {
    return 'invalid.local';
  }
}

function isBlankDocumentUrl(url: string): boolean {
  const u = (url || '').trim().toLowerCase();
  return !u || u === 'about:blank' || u.startsWith('chrome-error://');
}

function collectTagsPreorder(node: FNode, out: string[] = []): string[] {
  out.push(node.kind === 'element' ? node.tag : node.kind === 'text' ? '#text' : '#comment');
  if (node.kind === 'element') for (const child of node.children) collectTagsPreorder(child, out);
  return out;
}

/** Node-side snapshot cache — a full raw-tree walk per tick, read synchronously by `FrameTreeQuery`. */
class SnapshotTreeQuery implements FrameTreeQuery<LiveNode> {
  private byId = new Map<NodeId, CacheEntry>();

  constructor(
    private readonly mirrorBox: { mirror: NodeMirror | null },
    private readonly rewriterBox: { current: UrlRewriter },
  ) {}

  load(root: RawNode | null): void {
    const next = new Map<NodeId, CacheEntry>();
    if (root) {
      let order = 0;
      const walk = (node: RawNode, parentId: NodeId): void => {
        next.set(node.id, { raw: node, parentId, order: order++ });
        if (node.kind === 'element') {
          for (const child of node.children) walk(child, node.id);
        }
      };
      walk(root, NONE_NODE_ID);
    }
    this.byId = next;
  }

  isConnected(): boolean {
    return true; // anything reachable from this tick's walk is, by construction, connected.
  }

  resolve(id: NodeId): LiveNode | undefined {
    return this.byId.has(id) ? { id } : undefined;
  }

  isWithin(id: NodeId, ancestors: ReadonlySet<NodeId>): boolean {
    let cur: NodeId | undefined = id;
    while (cur !== undefined && cur !== NONE_NODE_ID) {
      if (ancestors.has(cur)) return true;
      cur = this.byId.get(cur)?.parentId;
    }
    return false;
  }

  childListSnapshot(parentId: NodeId): ChildRef[] | undefined {
    const entry = this.byId.get(parentId);
    if (!entry || entry.raw.kind !== 'element') return undefined;
    const mirror = this.mirrorBox.mirror;
    return entry.raw.children
      .filter((child) => this.byId.has(child.id))
      .map((child): ChildRef =>
        mirror?.get(child.id) !== undefined
          ? { kind: 'existing', id: child.id }
          : { kind: 'fresh', node: this.buildFullFNode(child) },
      );
  }

  fullSnapshot(id: NodeId): FNode | undefined {
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    return this.buildShallowFNode(entry.raw);
  }

  compareDocumentOrder(a: NodeId, b: NodeId): number {
    return (this.byId.get(a)?.order ?? 0) - (this.byId.get(b)?.order ?? 0);
  }

  /** Full recursive F snapshot — used for `childList` fresh entries and the establish walk. */
  buildFullFNode(raw: RawNode): FNode {
    if (raw.kind !== 'element') return this.leafFNode(raw);
    return publishElementSnapshot({
      id: raw.id,
      rawTag: raw.tag,
      rawAttrs: this.rewriteAttrs(raw),
      children: raw.children.filter((c) => this.byId.has(c.id)).map((c) => this.buildFullFNode(c)),
      iframeHost: raw.tag.toLowerCase() === 'iframe',
    });
  }

  private buildShallowFNode(raw: RawNode): FNode {
    if (raw.kind !== 'element') return this.leafFNode(raw);
    return publishElementSnapshot({
      id: raw.id,
      rawTag: raw.tag,
      rawAttrs: this.rewriteAttrs(raw),
      children: [], // §5.4.1 — patch snapshots never carry children.
      iframeHost: raw.tag.toLowerCase() === 'iframe',
    });
  }

  private leafFNode(raw: RawText | RawComment): FNode {
    return raw.kind === 'text' ? publishTextSnapshot(raw.id, raw.value) : publishCommentSnapshot(raw.id, raw.value);
  }

  private rewriteAttrs(raw: RawElement): Array<readonly [string, string]> {
    const rewriter = this.rewriterBox.current;
    return raw.attrs.map(([name, value]) => [name, rewriter.rewriteAttrValue(name, value)] as const);
  }
}

const BRIDGE_ONFRAME_SNIPPET = `(() => {
  const api = window.__speculumPageProjectionV2;
  if (!api || api.__ppv2Bridged) return;
  api.__ppv2Bridged = true;
  api.onFrame((tick) => {
    try { window.__speculumPPv2Tick(tick); } catch (e) {}
  });
})()`;

const SNAPSHOT_DOCUMENT_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.snapshotDocument === 'function')
    ? window.__speculumPageProjectionV2.snapshotDocument()
    : null
`;

/**
 * Live cutover (Phase C1) V2 producer, wired to a real `Page`. Owns the
 * Node-side `PageProjectionEngine`, the raw-tree snapshot cache that feeds
 * its `FrameTreeQuery`, and the asset cache. §5.5 binary parts are handed to
 * the caller's `onPageProjectionDiff` with empty `plane`/`operation` — no
 * JSON→binary adapter anywhere on this path.
 *
 * Stubs left for C2/C3 (see individual methods): soft-nav detection (every
 * post-boot main-frame navigation is treated as a hard nav), scroll dirty
 * tracking (not yet emitted by `inpageScript.ts`), shadow DOM piercing, and
 * document-level state (`title`/`lang`/`dir`/viewport meta).
 */
export class LivePageProjection {
  private stopped = false;
  private established = false;
  private schedulerStarted = false;
  private busy = false;
  private pendingDirty: DirtyState = createDirtyState();
  private hasPending = false;
  private pendingNav: LivePageProjectionNavigationType | null = null;
  private engine!: PageProjectionEngine<LiveNode>;
  private readonly treeQuery: SnapshotTreeQuery;
  private readonly mirrorBox: { mirror: NodeMirror | null } = { mirror: null };
  private readonly rewriterBox: { current: UrlRewriter };
  private readonly assets = new DomAssetCache();
  private readonly uploads = new Map<string, { body: Buffer; contentType: string; name: string }>();
  private stallWatchdog: ReturnType<typeof setInterval> | null = null;

  private constructor(
    private readonly page: Page,
    private readonly events: LivePageProjectionEvents,
  ) {
    this.rewriterBox = { current: new UrlRewriter({ originHost: safeHost(page.url()) }) };
    this.treeQuery = new SnapshotTreeQuery(this.mirrorBox, this.rewriterBox);
  }

  static async start(
    page: Page,
    events: LivePageProjectionEvents,
    opts?: { browserLaunchedAtMs?: number; frameRateHz?: number; maxFrameBytes?: number },
  ): Promise<LivePageProjection> {
    const proj = new LivePageProjection(page, events);
    await page.exposeBinding('__speculumPPv2Tick', (_source, tick) => {
      if (proj.stopped) return;
      proj.absorbRawTick(tick);
    });
    proj.engine = new PageProjectionEngine<LiveNode>({
      events: proj.buildEngineEvents(),
      scheduler: proj.buildScheduler(),
      channel: { push: () => {} }, // relaying happens via events.onFrame (task-mandated seam), not this channel.
      treeQuery: proj.treeQuery,
      originHost: safeHost(page.url()),
      frameRateHz: opts?.frameRateHz,
      maxFrameBytes: opts?.maxFrameBytes,
    });
    proj.mirrorBox.mirror = proj.engine.mirror;
    await proj.installPageScript();
    await proj.bridgeOnFrame();
    page.on('framenavigated', (frame) => {
      if (proj.stopped) return;
      if (frame === page.mainFrame()) void proj.onMainFrameNavigated();
    });
    proj.stallWatchdog = setInterval(() => {
      if (!proj.stopped) proj.engine.checkClockStall();
    }, 500);
    return proj;
  }

  private buildEngineEvents(): PageProjectionEngineEvents {
    return {
      onFrame: (parts, meta) => this.emitParts(parts, meta),
      onGenerationBumped: (event) =>
        this.events.onGenerationBumped?.({ ...event, reason: 'main_frame_navigated' }),
    };
  }

  private buildScheduler(): FrameClockScheduler {
    return {
      setInterval: (callback, ms) => setInterval(() => void this.onSchedulerTick(callback), Math.max(1, ms)),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      now: () => Date.now(),
    };
  }

  /** One clock tick: poll the page for a fresh snapshot only when something is dirty, then flush. */
  private async onSchedulerTick(tick: () => void): Promise<void> {
    if (this.stopped || this.busy) return;
    if (this.hasPending && this.established) {
      this.busy = true;
      try {
        await this.pollAndIngest();
      } catch {
        /* mid-navigation — next tick retries against the fresh document. */
      } finally {
        this.busy = false;
      }
    }
    if (!this.stopped) tick();
  }

  private async pollAndIngest(): Promise<void> {
    const dirty = this.pendingDirty;
    this.pendingDirty = createDirtyState();
    this.hasPending = false;
    const raw = await this.snapshotDocumentRaw();
    if (!raw) return;
    this.treeQuery.load(raw);
    this.engine.ingestDirty(dirty);
  }

  private async snapshotDocumentRaw(): Promise<RawNode | null> {
    try {
      const result = await this.page.evaluate(SNAPSHOT_DOCUMENT_SNIPPET);
      return (result as RawNode | null) ?? null;
    } catch {
      return null;
    }
  }

  private absorbRawTick(tick: unknown): void {
    if (this.stopped || !tick || typeof tick !== 'object') return;
    const dirty = (tick as { dirty?: Record<string, number[]> }).dirty;
    if (!dirty) return;
    let any = false;
    for (const id of dirty.newIds ?? []) { this.pendingDirty.newIds.add(id); any = true; }
    for (const id of dirty.dirtyParents ?? []) { this.pendingDirty.dirtyParents.add(id); any = true; }
    for (const id of dirty.attrDirty ?? []) { this.pendingDirty.attrDirty.add(id); any = true; }
    for (const id of dirty.textDirty ?? []) { this.pendingDirty.textDirty.add(id); any = true; }
    for (const id of dirty.stateDirty ?? []) { this.pendingDirty.stateDirty.add(id); any = true; }
    for (const id of dirty.detached ?? []) { this.pendingDirty.detached.add(id); any = true; }
    if (any) this.hasPending = true;
  }

  private async installPageScript(): Promise<void> {
    await this.page.addInitScript({ content: PAGE_PROJECTION_V2_PAGE_SCRIPT });
    await this.page.evaluate(PAGE_PROJECTION_V2_PAGE_SCRIPT).catch(() => {});
  }

  private async bridgeOnFrame(): Promise<void> {
    await this.page.evaluate(BRIDGE_ONFRAME_SNIPPET).catch(() => {});
  }

  private async onMainFrameNavigated(): Promise<void> {
    if (this.stopped) return;
    try {
      const url = this.page.url();
      if (isBlankDocumentUrl(url)) return;
      await this.installPageScript();
      await this.bridgeOnFrame();
      if (!this.established) {
        await this.runEstablish();
        return;
      }
      // C1 simplification: every post-boot main-frame nav is a hard nav (real
      // Document swap) — soft-nav (SPA history/hash) detection is a C2/C3 stub.
      this.busy = true;
      try {
        this.engine.bumpGeneration();
        this.pendingDirty = createDirtyState();
        this.hasPending = false;
        this.rewriterBox.current = new UrlRewriter({ originHost: safeHost(url) });
        await this.runEstablish();
      } finally {
        this.busy = false;
      }
    } catch {
      /* mid-navigation — the next framenavigated retries. */
    }
  }

  private async runEstablish(): Promise<void> {
    const raw = await this.snapshotDocumentRaw();
    if (!raw) return;
    this.treeQuery.load(raw);
    const rootFNode = this.treeQuery.buildFullFNode(raw);
    const mirror = this.mirrorBox.mirror!;
    mirror.clear();
    mirror.seedRoot(rootFNode);
    const html = mirror.serializeToHtml();
    const { nodeCount, checksum } = computeEstablishChecksum(collectTagsPreorder(rootFNode));
    const chunks = splitHtmlIntoChunks(html);
    const viewport = this.page.viewportSize() ?? { width: 0, height: 0 };
    const ops: WireOp[] = [
      { op: 'establishBegin', payload: buildEstablishBegin(this.engine.currentGeneration, viewport, { x: 0, y: 0 }) },
      ...chunks.map((chunk): WireOp => ({ op: 'establishChunk', bytes: Buffer.from(chunk, 'utf8') })),
      { op: 'establishEnd', nodeCount, checksum },
    ];
    const meta: EncodedFrameMeta = {
      generation: this.engine.currentGeneration,
      sequence: this.engine.currentSequence,
      establish: true,
    };
    this.emitParts(encodeFrame(ops, meta), meta);
    if (!this.established) {
      this.established = true;
      this.startScheduler();
    }
  }

  private startScheduler(): void {
    if (this.schedulerStarted) return;
    this.schedulerStarted = true;
    this.engine.start();
  }

  private emitParts(parts: Uint8Array[], meta: EncodedFrameMeta): void {
    const partCount = parts.length;
    const flags = (meta.establish ? 0b01 : 0) | (meta.resync ? 0b10 : 0);
    const timestampMs = Date.now();
    parts.forEach((body, partIndex) => {
      this.events.onPageProjectionDiff({
        sequence: meta.sequence,
        generation: meta.generation,
        plane: '',
        operation: '',
        timestampMs,
        body,
        partIndex,
        partCount,
        flags,
        version: WIRE_VERSION,
      });
    });
  }

  /** Run once after `page.goto` — no-op once already established (subsequent boots ride `framenavigated`). */
  async establishBoot(): Promise<void> {
    if (this.stopped || this.established) return;
    await this.runEstablish();
  }

  notePendingNavigation(kind: LivePageProjectionNavigationType): void {
    this.pendingNav = kind;
  }

  getGeneration(): number {
    return this.engine?.currentGeneration ?? 1;
  }

  getAsset(key: string): {
    body: Buffer;
    contentType: string;
    sourceUrl?: string;
    mode: string;
    shareability?: DomAssetShareability;
  } | undefined {
    return this.assets.get(key);
  }

  /** First header value, tolerating Playwright's `string | string[]` header shape. */
  private static headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
    const raw = headers[name];
    return typeof raw === 'string' ? raw : (raw as unknown as string[] | undefined)?.[0];
  }

  /**
   * §5.12.2.1 — whether *this* request would have carried a `Cookie` header. Read from
   * the browser context's own cookie jar for `sourceUrl` rather than guessed, so the
   * signal the API's `SharedAssetCacheL2` predicate gates on is never fabricated.
   */
  private async requestHadCookie(sourceUrl: string): Promise<boolean> {
    try {
      const cookies = await this.page.context().cookies([sourceUrl]);
      return cookies.length > 0;
    } catch {
      return false;
    }
  }

  async fetchPassThrough(
    key: string,
    rangeHeader?: string,
  ): Promise<{
    body: Buffer;
    contentType: string;
    statusCode: number;
    contentRange?: string;
    shareability: DomAssetShareability;
    /** 'cache' ⇒ safe to buffer-and-replay same-session AND L2-eligible; 'pass-through' ⇒ neither. */
    mode: 'cache' | 'pass-through';
  } | null> {
    const cached = this.assets.get(key);
    const sourceUrl = cached?.sourceUrl ?? (key.includes('://') ? key : `https://${key}`);
    try {
      const headers: Record<string, string> = {};
      if (rangeHeader) headers['Range'] = rangeHeader;
      const requestHadCookie = await this.requestHadCookie(sourceUrl);
      const res = await this.page.context().request.get(sourceUrl, { timeout: 30_000, headers });
      if (!res.ok() && res.status() !== 206) return null;
      const buf = Buffer.from(await res.body());
      const resHeaders = res.headers();
      const contentType =
        LivePageProjection.headerValue(resHeaders, 'content-type')?.split(';')[0]?.trim()
        || cached?.contentType
        || 'application/octet-stream';
      const contentRange = LivePageProjection.headerValue(resHeaders, 'content-range');
      const shareability: DomAssetShareability = {
        requestHadCookie,
        cacheControl: LivePageProjection.headerValue(resHeaders, 'cache-control'),
        vary: LivePageProjection.headerValue(resHeaders, 'vary'),
      };
      // §5.12.2 — a plain (non-Range) fetch of a non-streaming resource is safe to serve
      // straight from the buffered copy on repeat same-session requests ('cache' mode);
      // Range requests and streaming/media URLs (isPassThroughUrl) always re-verify with
      // the origin ('pass-through') — never buffered-and-replayed for those (PP-ASSET-*).
      const mode = !rangeHeader && !isPassThroughUrl(sourceUrl, contentType) ? 'cache' : 'pass-through';
      if (!rangeHeader && buf.byteLength > 0 && buf.byteLength < 2 * 1024 * 1024) {
        this.assets.put(key, buf, contentType, { sourceUrl, mode, shareability });
      }
      return { body: buf, contentType, statusCode: res.status(), contentRange, shareability, mode };
    } catch {
      return null;
    }
  }

  putUpload(id: string, body: Buffer, contentType: string, name: string): void {
    this.uploads.set(id, { body, contentType, name });
  }

  takeUpload(id: string): { body: Buffer; contentType: string; name: string } | undefined {
    const upload = this.uploads.get(id);
    if (upload) this.uploads.delete(id);
    return upload;
  }

  /** §5.3.5.3 — collapses to the hidden rate ladder rung; mutations keep accumulating (never a hard stop). */
  async pauseLiveEmitForBackpressure(): Promise<void> {
    this.engine?.setHidden(true);
  }

  async resumeLiveEmitAfterBackpressure(): Promise<void> {
    this.engine?.setHidden(false);
  }

  /** OOB resync — served from the Node-side mirror; never advances the live `sequence` counter. */
  async captureResyncSnapshot(): Promise<{
    generation: number;
    coversThroughSequence: number;
    root: unknown;
    sheets: unknown[];
    pageEpochId?: string;
    source: 'mirror' | 'dump_fallback';
    domMapMs?: number;
    cssomCloneMs?: number;
    rewriteMs?: number;
    serializeMs?: number;
  } | null> {
    if (this.stopped || !this.established) return null;
    const mirror = this.mirrorBox.mirror;
    if (!mirror || mirror.root === null) return null;
    const start = Date.now();
    const html = mirror.serializeToHtml();
    return {
      generation: this.engine.currentGeneration,
      coversThroughSequence: this.engine.currentSequence,
      root: { html },
      sheets: [], // C2/C3 stub — CSSOM plane resync not yet wired.
      pageEpochId: '',
      source: 'mirror',
      serializeMs: Date.now() - start,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.stallWatchdog) {
      clearInterval(this.stallWatchdog);
      this.stallWatchdog = null;
    }
    this.engine?.stop();
    this.assets.clear();
    this.uploads.clear();
  }
}
