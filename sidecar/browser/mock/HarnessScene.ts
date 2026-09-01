import type {
  BrowserEditingState,
  BrowserInput,
  BrowserTouchPoint,
} from '../BrowserSession';
import { matchesAllowedDomain } from '../patchright/Navigation';

export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HarnessSceneSnapshot {
  nowMs: number;
  url: string;
  historyIndex: number;
  historyLength: number;
  scrollY: number;
  docScale: number;
  cursor: { x: number; y: number } | null;
  trail: readonly { x: number; y: number }[];
  mouseButton: number | null;
  ripples: readonly { x: number; y: number; bornAt: number }[];
  touches: readonly { id: number; x: number; y: number; force?: number }[];
  heldKeys: readonly string[];
  textBuffer: string;
  editableFocused: boolean;
  backHit: HitRect;
  forwardHit: HitRect;
  urlHit: HitRect;
  editableHit: HitRect;
  navFlash: { dir: 'back' | 'forward'; at: number } | null;
  evalToast: { text: string; at: number } | null;
  inputCount: number;
  lastInputType: string;
  lastInputAt: number;
  emitFps: number;
  encodeMs: number;
  jpegQuality: number;
}

export interface HarnessSceneEvents {
  onLocationChanged(url: string): void;
  onMainFrameNavigationBlocked(url: string): void;
  onEditableFocusChanged(editing: BrowserEditingState | null): void;
}

/**
 * Interactive mock page state for stream + input feel testing.
 */
export class HarnessScene {
  private width: number;
  private height: number;
  private url = 'https://mock.local/';
  private history: string[] = ['https://mock.local/'];
  private historyIndex = 0;
  private scrollY = 0;
  private docScale = 1;
  private cursor: { x: number; y: number } | null = null;
  private trail: { x: number; y: number }[] = [];
  private mouseButton: number | null = null;
  private ripples: { x: number; y: number; bornAt: number }[] = [];
  private touches = new Map<number, { x: number; y: number; force?: number }>();
  private heldKeys = new Set<string>();
  private textBuffer = '';
  private editableFocused = false;
  private navFlash: { dir: 'back' | 'forward'; at: number } | null = null;
  private evalToast: { text: string; at: number } | null = null;
  private inputCount = 0;
  private lastInputType = '';
  private lastInputAt = 0;
  private pinchStartDist: number | null = null;
  private pinchStartScale = 1;
  private allowedDomains: readonly string[] | undefined;

  constructor(
    width: number,
    height: number,
    private readonly events: HarnessSceneEvents,
  ) {
    this.width = width;
    this.height = height;
  }

  get currentUrl(): string {
    return this.url;
  }

  get historyIndexValue(): number {
    return this.historyIndex;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  setAllowedDomains(domains: readonly string[] | undefined): void {
    this.allowedDomains = domains;
  }

  /** Initial location after launch. */
  bootstrap(url = 'https://mock.local/'): void {
    this.url = url;
    this.history = [url];
    this.historyIndex = 0;
    this.events.onLocationChanged(url);
  }

  navigateTo(url: string, pushHistory: boolean): boolean {
    if (!this.isAllowed(url)) {
      this.events.onMainFrameNavigationBlocked(url);
      return false;
    }
    this.url = url;
    if (pushHistory) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(url);
      this.historyIndex = this.history.length - 1;
    }
    this.events.onLocationChanged(url);
    return true;
  }

  refresh(): void {
    this.events.onLocationChanged(this.url);
  }

  noteEvaluate(code: string): void {
    this.evalToast = { text: `[eval] ${code.slice(0, 72)}`, at: Date.now() };
  }

  applyInput(input: BrowserInput): void {
    const now = Date.now();
    this.inputCount++;
    this.lastInputType = input.type;
    this.lastInputAt = now;
    this.prune(now);

    switch (input.type) {
      case 'mousemove':
        this.setCursor(input.x, input.y);
        break;
      case 'mousedown':
        this.setCursor(input.x, input.y);
        this.mouseButton = input.button;
        this.ripples.push({ x: input.x, y: input.y, bornAt: now });
        this.handleClick(input.x, input.y);
        break;
      case 'mouseup':
        this.setCursor(input.x, input.y);
        this.mouseButton = null;
        break;
      case 'wheel':
        this.setCursor(input.x, input.y);
        this.scrollY = clamp(this.scrollY + input.deltaY, 0, 1600);
        break;
      case 'keydown':
        this.heldKeys.add(input.key);
        if (this.editableFocused && input.key === 'Backspace') {
          this.textBuffer = this.textBuffer.slice(0, -1);
        }
        break;
      case 'keyup':
        this.heldKeys.delete(input.key);
        break;
      case 'type':
      case 'text':
        if (this.editableFocused || input.type === 'text') {
          this.setEditableFocused(true);
          this.textBuffer += input.text;
        }
        break;
      case 'touch':
        this.applyTouch(input.phase, input.points, now);
        break;
      case 'goback':
        this.goHistory(-1);
        break;
      case 'goforward':
        this.goHistory(1);
        break;
    }
  }

  snapshot(meta: {
    nowMs: number;
    emitFps: number;
    encodeMs: number;
    jpegQuality: number;
  }): HarnessSceneSnapshot {
    this.prune(meta.nowMs);
    return {
      nowMs: meta.nowMs,
      url: this.url,
      historyIndex: this.historyIndex,
      historyLength: this.history.length,
      scrollY: this.scrollY,
      docScale: this.docScale,
      cursor: this.cursor,
      trail: [...this.trail],
      mouseButton: this.mouseButton,
      ripples: [...this.ripples],
      touches: [...this.touches.entries()].map(([id, p]) => ({ id, ...p })),
      heldKeys: [...this.heldKeys],
      textBuffer: this.textBuffer,
      editableFocused: this.editableFocused,
      backHit: this.backHit(),
      forwardHit: this.forwardHit(),
      urlHit: this.urlHit(),
      editableHit: this.editableHitDoc(),
      navFlash: this.navFlash,
      evalToast: this.evalToast,
      inputCount: this.inputCount,
      lastInputType: this.lastInputType,
      lastInputAt: this.lastInputAt,
      emitFps: meta.emitFps,
      encodeMs: meta.encodeMs,
      jpegQuality: meta.jpegQuality,
    };
  }

  private applyTouch(
    phase: 'start' | 'move' | 'end' | 'cancel',
    points: readonly BrowserTouchPoint[],
    now: number,
  ): void {
    if (phase === 'end' || phase === 'cancel') {
      this.touches.clear();
      this.pinchStartDist = null;
      return;
    }
    this.touches.clear();
    for (const p of points) {
      this.touches.set(p.id, { x: p.x, y: p.y, force: p.force });
    }
    if (points.length >= 2) {
      const a = points[0]!;
      const b = points[1]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStartDist === null) {
        this.pinchStartDist = dist;
        this.pinchStartScale = this.docScale;
      } else if (this.pinchStartDist > 0) {
        this.docScale = clamp(
          this.pinchStartScale * (dist / this.pinchStartDist),
          0.5,
          2.5,
        );
      }
    } else {
      this.pinchStartDist = null;
      if (phase === 'start' && points[0]) {
        this.ripples.push({ x: points[0].x, y: points[0].y, bornAt: now });
        this.handleClick(points[0].x, points[0].y);
      }
    }
  }

  private handleClick(x: number, y: number): void {
    if (contains(this.backHit(), x, y)) {
      this.goHistory(-1);
      return;
    }
    if (contains(this.forwardHit(), x, y)) {
      this.goHistory(1);
      return;
    }
    // Editable field is in document space — map screen → doc
    const screenField = this.editableHitScreen();
    if (contains(screenField, x, y)) {
      this.setEditableFocused(true);
      return;
    }
    if (this.editableFocused) {
      this.setEditableFocused(false);
    }
  }

  private goHistory(delta: number): void {
    const next = this.historyIndex + delta;
    if (next < 0 || next >= this.history.length) return;
    this.historyIndex = next;
    this.url = this.history[next]!;
    this.navFlash = { dir: delta < 0 ? 'back' : 'forward', at: Date.now() };
    this.events.onLocationChanged(this.url);
  }

  private setEditableFocused(focused: boolean): void {
    if (this.editableFocused === focused) return;
    this.editableFocused = focused;
    if (focused) {
      this.events.onEditableFocusChanged({
        inputMode: 'text',
        multiline: false,
        tagName: 'INPUT',
      });
    } else {
      this.events.onEditableFocusChanged(null);
    }
  }

  private setCursor(x: number, y: number): void {
    this.cursor = { x, y };
    this.trail.push({ x, y });
    if (this.trail.length > 12) this.trail.shift();
  }

  private isAllowed(url: string): boolean {
    if (!this.allowedDomains || this.allowedDomains.length === 0) return true;
    try {
      const host = new URL(url).hostname;
      return matchesAllowedDomain(host, this.allowedDomains);
    } catch {
      return false;
    }
  }

  private prune(now: number): void {
    this.ripples = this.ripples.filter((r) => now - r.bornAt < 500);
    if (this.navFlash && now - this.navFlash.at > 450) this.navFlash = null;
    if (this.evalToast && now - this.evalToast.at > 1600) this.evalToast = null;
  }

  private backHit(): HitRect {
    return { x: 10, y: 8, w: 72, h: 28 };
  }

  private forwardHit(): HitRect {
    return { x: 90, y: 8, w: 96, h: 28 };
  }

  private urlHit(): HitRect {
    return { x: 200, y: 8, w: Math.max(120, this.width - 220), h: 28 };
  }

  /** Editable hit in document (pre-transform) coordinates. */
  private editableHitDoc(): HitRect {
    return { x: 40, y: 120, w: Math.min(480, this.width - 80), h: 44 };
  }

  /** Approximate screen-space editable hit for click tests. */
  private editableHitScreen(): HitRect {
    const toolbarH = 44;
    const pad = 12;
    const docY = toolbarH + pad;
    const field = this.editableHitDoc();
    return {
      x: pad + field.x * this.docScale,
      y: docY + (field.y - this.scrollY) * this.docScale,
      w: field.w * this.docScale,
      h: field.h * this.docScale,
    };
  }
}

function contains(r: HitRect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
