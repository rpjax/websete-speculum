/**
 * DOM establish (§5.6) — HTML chunks with speculum-anchor; checksum matches client registry.
 * Does not write identity into the live Virtual DOM (§5.1.3).
 */

import { OpCode } from '../../models/opcodes';
import {
  createEstablishFrame,
  type Frame,
  type FrameOp,
} from '../../models/frame';
import type { DomNodeTable } from '../dom/domNodeTable';
import {
  escapeAttr,
  escapeText,
  isPlaceholderTag,
  listFVisibleChildren,
  snapshotAttrs,
} from '../frame/fVisible';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const DEFAULT_CHUNK_BYTES = 64 * 1024;

export type EstablishDomResult = {
  frame: Frame;
  nodeCount: number;
  checksum: number;
  publishedKeys: number[];
  /** Parent → F-visible child keys at establish (includes text/comment ids not on the HTML wire). */
  childLists: Array<readonly [number, number[]]>;
};

export type EstablishDomOptions = {
  domNodes: DomNodeTable;
  generation: number;
  /** Establish frame sequence (typically 0). */
  sequence?: number;
  chunkBytes?: number;
};

/**
 * Walk documentElement, allocate ids, build establish frame (begin + chunks + end + documentState).
 */
export function buildEstablishDomFrame(opts: EstablishDomOptions): EstablishDomResult {
  const domNodes = opts.domNodes;
  const generation = opts.generation;
  const sequence = opts.sequence ?? 0;
  const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;

  const root = document.documentElement;
  if (!root) {
    throw new Error('establishDom: document.documentElement missing');
  }

  let hash = FNV_OFFSET_BASIS;
  let nodeCount = 0;
  const publishedKeys: number[] = [];
  const childLists: Array<readonly [number, number[]]> = [];

  const addTag = (tag: string) => {
    nodeCount += 1;
    for (let i = 0; i < tag.length; i++) {
      hash ^= tag.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
    hash ^= nodeCount & 0xff;
    hash = Math.imul(hash, FNV_PRIME);
  };

  const noteKey = (key: number) => {
    publishedKeys.push(key);
  };

  const serializeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      domNodes.allocate(node);
      return escapeText((node as Text).data);
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      domNodes.allocate(node);
      return `<!--${(node as Comment).data}-->`;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const key = domNodes.allocate(el);
    noteKey(key);
    addTag(tag);

    const attrs = snapshotAttrs(el);
    let attrStr = ` speculum-anchor="${key}"`;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]!;
      if (a.name.toLowerCase() === 'speculum-anchor') continue;
      attrStr += ` ${a.name}="${escapeAttr(a.value)}"`;
    }

    if (isPlaceholderTag(tag)) {
      childLists.push([key, []]);
      return `<${tag}${attrStr}></${tag}>`;
    }

    // void elements
    if (
      tag === 'img' ||
      tag === 'br' ||
      tag === 'hr' ||
      tag === 'input' ||
      tag === 'meta' ||
      tag === 'link' ||
      tag === 'area' ||
      tag === 'col' ||
      tag === 'embed' ||
      tag === 'source' ||
      tag === 'track' ||
      tag === 'wbr'
    ) {
      childLists.push([key, []]);
      return `<${tag}${attrStr}>`;
    }

    const kids = listFVisibleChildren(el);
    const childKeys: number[] = [];
    let inner = '';
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i]!;
      childKeys.push(domNodes.allocate(child));
      inner += serializeNode(child);
    }
    childLists.push([key, childKeys]);
    return `<${tag}${attrStr}>${inner}</${tag}>`;
  };

  // Preorder matches client registry.buildFromDocument: html tag first, then kids.
  const htmlKey = domNodes.allocate(root);
  noteKey(htmlKey);
  addTag('html');
  const htmlAttrs = snapshotAttrs(root);
  let htmlAttrStr = ` speculum-anchor="${htmlKey}"`;
  for (let i = 0; i < htmlAttrs.length; i++) {
    const a = htmlAttrs[i]!;
    if (a.name.toLowerCase() === 'speculum-anchor') continue;
    htmlAttrStr += ` ${a.name}="${escapeAttr(a.value)}"`;
  }
  const kids = listFVisibleChildren(root);
  const htmlChildKeys: number[] = [];
  let inner = '';
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]!;
    htmlChildKeys.push(domNodes.allocate(child));
    inner += serializeNode(child);
  }
  childLists.push([htmlKey, htmlChildKeys]);
  const full = `<!DOCTYPE html><html${htmlAttrStr}>${inner}</html>`;
  const chunks: string[] = [];
  for (let i = 0; i < full.length; i += chunkBytes) {
    chunks.push(full.slice(i, i + chunkBytes));
  }
  if (chunks.length === 0) chunks.push(full);

  const viewport = window.visualViewport;
  const viewportWidth = Math.round(viewport?.width ?? window.innerWidth);
  const viewportHeight = Math.round(viewport?.height ?? window.innerHeight);

  const ops: FrameOp[] = [
    {
      op: OpCode.EstablishBegin,
      generation,
      viewportWidth,
      viewportHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollElements: [],
    },
  ];

  const title = document.title ?? '';
  const lang = root.getAttribute('lang');
  const dir = root.getAttribute('dir');
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  ops.push({
    op: OpCode.DocumentState,
    title,
    lang,
    dir,
    viewportContent: viewportMeta?.getAttribute('content') ?? null,
  });

  for (let i = 0; i < chunks.length; i++) {
    ops.push({ op: OpCode.EstablishChunk, html: chunks[i]! });
  }

  const checksum = hash >>> 0;
  ops.push({
    op: OpCode.EstablishEnd,
    nodeCount,
    checksum,
  });

  return {
    frame: createEstablishFrame({ generation, sequence, ops }),
    nodeCount,
    checksum,
    publishedKeys,
    childLists,
  };
}
