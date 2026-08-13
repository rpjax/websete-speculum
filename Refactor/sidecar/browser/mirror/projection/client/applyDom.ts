/**
 * Dom-plane apply — ported for lab/client (no asset stamp / React).
 * docs/page-projection/spec/engine-redesign.md §5.4, §5.9.1.
 */

import type {
  AssembledFrame,
  DecodedNode,
  DecodedOp,
  DocumentStateOp,
  PatchSnapshot,
} from './decode';
import type { PageProjectionRegistry } from './registry';

export type DomDesyncReason = 'address_miss';
export interface DomDesyncInfo {
  reason: DomDesyncReason;
  op: DecodedOp['op'];
  id: number;
}

export type ApplyChildListNote = {
  parent: number;
  mode: 'full' | 'append';
  nExisting: number;
  nFresh: number;
  parentChildCountBefore: number;
  appendOntoNonEmpty: boolean;
};

export type ApplyFrameNotes = {
  appendOntoNonEmptyCount: number;
  childLists: ApplyChildListNote[];
  patches: number;
  scrolls: number;
};

export interface DomFrameApplierOptions {
  onDesync?: (info: DomDesyncInfo) => void;
  onApplied?: (frame: AssembledFrame, notes: ApplyFrameNotes) => void;
  onOverrun?: (durationMs: number, lastSequence: number) => void;
  applyBudgetMs?: number;
}

type ResolvedChild =
  | { kind: 'existing'; node: Node }
  | { kind: 'fresh'; node: DecodedNode };
type ResolvedOp =
  | { op: 'childList'; parent: Element; mode: 'full' | 'append'; children: ResolvedChild[] }
  | { op: 'patch'; target: Node; snapshot: PatchSnapshot }
  | { op: 'scrollViewport'; scrollX: number; scrollY: number }
  | { op: 'scrollElement'; target: Element; scrollTop: number; scrollLeft: number };

const DOM_OP_NAMES = new Set(['childList', 'patch', 'scrollViewport', 'scrollElement']);

export class DomFrameApplier {
  private queued: AssembledFrame[] = [];
  private raf: number | null = null;
  private readonly doc: Document;
  private readonly registry: PageProjectionRegistry;
  private readonly options: DomFrameApplierOptions;

  constructor(doc: Document, registry: PageProjectionRegistry, options: DomFrameApplierOptions = {}) {
    this.doc = doc;
    this.registry = registry;
    this.options = options;
  }

  enqueue(frame: AssembledFrame): void {
    this.queued.push(frame);
    if (this.raf != null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.flush();
    });
  }

  flush(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    const batch = this.queued.sort((a, b) => a.sequence - b.sequence);
    this.queued = [];
    if (batch.length === 0) return;
    const start = performance.now();
    let lastSequence = 0;
    for (const frame of batch) {
      lastSequence = frame.sequence;
      this.applyFrame(frame);
    }
    const duration = performance.now() - start;
    const budget = this.options.applyBudgetMs ?? 4;
    if (duration > budget) this.options.onOverrun?.(duration, lastSequence);
  }

  reset(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.queued = [];
  }

  private applyFrame(frame: AssembledFrame): void {
    const notes: ApplyFrameNotes = {
      appendOntoNonEmptyCount: 0,
      childLists: [],
      patches: 0,
      scrolls: 0,
    };
    const domOps = frame.ops.filter((op) => DOM_OP_NAMES.has(op.op));
    if (domOps.length > 0) {
      const resolved = resolveDomOps(domOps, this.registry);
      if (!resolved.ok) {
        this.options.onDesync?.({ reason: 'address_miss', op: resolved.op, id: resolved.id });
        return;
      }
      applyResolvedOps(this.doc, this.registry, resolved.ops, notes);
    }
    const documentStateOp = frame.ops.find((op): op is DocumentStateOp => op.op === 'documentState');
    if (documentStateOp) applyDocumentState(this.doc, documentStateOp);
    this.options.onApplied?.(frame, notes);
  }
}

function resolveDomOps(
  ops: DecodedOp[],
  registry: PageProjectionRegistry,
): { ok: true; ops: ResolvedOp[] } | { ok: false; op: DecodedOp['op']; id: number } {
  const resolved: ResolvedOp[] = [];
  for (const op of ops) {
    if (op.op === 'childList') {
      const parent = registry.get(op.parent);
      if (!(parent instanceof Element) && parent?.nodeType !== 1) {
        return { ok: false, op: op.op, id: op.parent };
      }
      if (!parent || parent.nodeType !== 1) return { ok: false, op: op.op, id: op.parent };
      const children: ResolvedChild[] = [];
      for (const ref of op.children) {
        if (ref.kind === 'fresh') {
          children.push({ kind: 'fresh', node: ref.node });
          continue;
        }
        const node = registry.get(ref.id);
        if (!node) return { ok: false, op: op.op, id: ref.id };
        children.push({ kind: 'existing', node });
      }
      resolved.push({
        op: 'childList',
        parent: parent as Element,
        mode: op.mode,
        children,
      });
    } else if (op.op === 'patch') {
      const target = registry.get(op.node);
      if (!target) return { ok: false, op: op.op, id: op.node };
      resolved.push({ op: 'patch', target, snapshot: op.snapshot });
    } else if (op.op === 'scrollViewport') {
      resolved.push({ op: 'scrollViewport', scrollX: op.scrollX, scrollY: op.scrollY });
    } else if (op.op === 'scrollElement') {
      const target = registry.get(op.node);
      if (!target || target.nodeType !== 1) return { ok: false, op: op.op, id: op.node };
      resolved.push({
        op: 'scrollElement',
        target: target as Element,
        scrollTop: op.scrollTop,
        scrollLeft: op.scrollLeft,
      });
    }
  }
  return { ok: true, ops: resolved };
}

function applyResolvedOps(
  doc: Document,
  registry: PageProjectionRegistry,
  ops: ResolvedOp[],
  notes: ApplyFrameNotes,
): void {
  for (const op of ops) {
    if (op.op === 'childList') applyChildList(doc, registry, op, notes);
    else if (op.op === 'patch') {
      notes.patches += 1;
      applyPatch(op.target, op.snapshot);
    } else if (op.op === 'scrollViewport') {
      notes.scrolls += 1;
      doc.defaultView?.scrollTo(op.scrollX, op.scrollY);
    } else {
      notes.scrolls += 1;
      const el = op.target as HTMLElement;
      el.scrollTop = op.scrollTop;
      el.scrollLeft = op.scrollLeft;
    }
  }
}

function applyChildList(
  doc: Document,
  registry: PageProjectionRegistry,
  op: { parent: Element; mode: 'full' | 'append'; children: ResolvedChild[] },
  notes: ApplyFrameNotes,
): void {
  const parentChildCountBefore = op.parent.childNodes.length;
  let nExisting = 0;
  let nFresh = 0;
  for (const c of op.children) {
    if (c.kind === 'existing') nExisting += 1;
    else nFresh += 1;
  }
  const appendOntoNonEmpty = op.mode === 'append' && parentChildCountBefore > 0 && op.children.length > 0;
  if (appendOntoNonEmpty) notes.appendOntoNonEmptyCount += 1;
  if (notes.childLists.length < 32) {
    notes.childLists.push({
      parent: registry.idOf(op.parent) ?? 0,
      mode: op.mode,
      nExisting,
      nFresh,
      parentChildCountBefore,
      appendOntoNonEmpty,
    });
  }

  const wanted = op.children.map((c) =>
    c.kind === 'existing' ? c.node : materialize(doc, registry, c.node),
  );

  if (op.mode === 'append') {
    for (const node of wanted) op.parent.appendChild(node);
    return;
  }

  const wantedSet = new Set(wanted);
  for (const child of Array.from(op.parent.childNodes)) {
    if (wantedSet.has(child)) continue;
    registry.unregisterSubtree(child);
    child.parentNode?.removeChild(child);
  }

  let cursor: Node | null = op.parent.firstChild;
  for (const node of wanted) {
    if (cursor === node) {
      cursor = node.nextSibling;
      continue;
    }
    op.parent.insertBefore(node, cursor);
  }
}

function applyPatch(target: Node, snapshot: PatchSnapshot): void {
  if (snapshot.kind === 'text' || snapshot.kind === 'comment') {
    target.textContent = snapshot.value ?? '';
    return;
  }
  if (target.nodeType !== 1) return;
  applyElementSnapshot(target as Element, snapshot.attrs ?? {});
}

function materialize(doc: Document, registry: PageProjectionRegistry, node: DecodedNode): Node {
  if (node.kind === 'text') {
    const n = doc.createTextNode(node.value ?? '');
    registry.register(node.id, n);
    return n;
  }
  if (node.kind === 'comment') {
    const n = doc.createComment(node.value ?? '');
    registry.register(node.id, n);
    return n;
  }
  const tag = node.tag ?? 'div';
  const el =
    tag === 'svg' || tag.startsWith('svg:')
      ? doc.createElementNS('http://www.w3.org/2000/svg', tag)
      : doc.createElement(tag);
  registry.register(node.id, el);
  applyElementSnapshot(el, node.attrs ?? {});
  for (const child of node.children ?? []) el.appendChild(materialize(doc, registry, child));
  return el;
}

function applyElementSnapshot(el: Element, attrs: Record<string, string>): void {
  for (const name of Array.from(el.getAttributeNames())) {
    if (!(name in attrs)) el.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(attrs)) {
    try {
      el.setAttribute(name, value);
    } catch {
      /* ignore */
    }
  }
  applyNodeState(el, attrs);
}

function applyNodeState(el: Element, attrs: Record<string, string>): void {
  const value = attrs['speculum-input-value'];
  if (value != null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    if (el.value !== value) el.value = value;
  } else if (value != null && el instanceof HTMLSelectElement) {
    el.value = value;
  }
  const checked = attrs['speculum-input-checked'];
  if (checked != null && el instanceof HTMLInputElement) el.checked = checked === 'true';
  const selected = attrs['speculum-option-selected'];
  if (selected != null && el instanceof HTMLOptionElement) el.selected = selected === 'true';
  if (el instanceof HTMLDialogElement) {
    const modal = attrs['speculum-dialog-modal'];
    if (modal === 'true' && !el.open) el.showModal();
    else if (modal !== 'true' && el.open) el.close();
  }
}

export function applyDocumentState(doc: Document, op: DocumentStateOp): void {
  doc.title = op.title;
  const html = doc.documentElement;
  if (html) {
    if (op.lang !== null) html.setAttribute('lang', op.lang);
    else html.removeAttribute('lang');
    if (op.dir !== null) html.setAttribute('dir', op.dir);
    else html.removeAttribute('dir');
  }
  const existing = doc.querySelector('meta[name="viewport"]');
  if (op.viewportContent === null) {
    existing?.remove();
    return;
  }
  const meta = existing ?? doc.createElement('meta');
  if (!existing) {
    meta.setAttribute('name', 'viewport');
    (doc.head ?? doc.documentElement)?.appendChild(meta);
  }
  meta.setAttribute('content', op.viewportContent);
}
