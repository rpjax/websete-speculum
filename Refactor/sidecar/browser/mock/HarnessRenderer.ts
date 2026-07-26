import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { HarnessSceneSnapshot } from './HarnessScene';

const QUALITY_FLOOR = 35;
const QUALITY_CEIL = 70;
const ENCODE_BUDGET_MS = 16;

/**
 * Owns the @napi-rs/canvas surface and JPEG encode path for the mock harness.
 * Auto-drops quality when encode regularly exceeds the 60 fps budget.
 */
export class HarnessRenderer {
  private canvas: Canvas;
  private ctx: SKRSContext2D;
  private quality = QUALITY_CEIL;
  private slowStreak = 0;
  private lastEncodeMs = 0;

  constructor(
    private width: number,
    private height: number,
  ) {
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }

  get encodeMs(): number {
    return this.lastEncodeMs;
  }

  get jpegQuality(): number {
    return this.quality;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }

  async renderJpeg(snap: HarnessSceneSnapshot): Promise<Uint8Array> {
    const t0 = Date.now();
    paint(this.ctx, this.width, this.height, snap);
    const buf = await this.canvas.encode('jpeg', this.quality);
    this.lastEncodeMs = Date.now() - t0;
    this.adaptQuality(this.lastEncodeMs);
    return new Uint8Array(buf);
  }

  private adaptQuality(encodeMs: number): void {
    if (encodeMs > ENCODE_BUDGET_MS) {
      this.slowStreak++;
      if (this.slowStreak >= 3 && this.quality > QUALITY_FLOOR) {
        this.quality = Math.max(QUALITY_FLOOR, this.quality - 5);
        this.slowStreak = 0;
      }
    } else {
      this.slowStreak = 0;
      if (encodeMs < ENCODE_BUDGET_MS * 0.5 && this.quality < QUALITY_CEIL) {
        this.quality = Math.min(QUALITY_CEIL, this.quality + 1);
      }
    }
  }
}

function paint(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  snap: HarnessSceneSnapshot,
): void {
  const toolbarH = 44;
  const pad = 12;

  // Pulsing background
  const pulse = 0.5 + 0.5 * Math.sin(snap.nowMs / 700);
  ctx.fillStyle = `rgb(${18 + pulse * 12 | 0}, ${22 + pulse * 8 | 0}, ${38})`;
  ctx.fillRect(0, 0, width, height);

  // Toolbar
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, width, toolbarH);
  drawButton(ctx, snap.backHit, '← Back', snap.historyIndex > 0);
  drawButton(ctx, snap.forwardHit, 'Forward →', snap.historyIndex < snap.historyLength - 1);

  ctx.fillStyle = '#0f172a';
  roundRect(ctx, snap.urlHit.x, snap.urlHit.y, snap.urlHit.w, snap.urlHit.h, 6);
  ctx.fill();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px sans-serif';
  ctx.fillText(truncate(snap.url, 64), snap.urlHit.x + 10, snap.urlHit.y + 18);

  // Document pane
  const docX = pad;
  const docY = toolbarH + pad;
  const docW = width - pad * 2;
  const docH = height - toolbarH - pad * 2 - 56;

  ctx.save();
  ctx.beginPath();
  ctx.rect(docX, docY, docW, docH);
  ctx.clip();

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(docX, docY, docW, docH);

  const scale = snap.docScale;
  const scroll = snap.scrollY;
  ctx.save();
  ctx.translate(docX + docW / 2, docY);
  ctx.scale(scale, scale);
  ctx.translate(-docW / 2, -scroll);

  // Scrollable stripes + labels
  for (let i = 0; i < 24; i++) {
    const y = i * 80;
    ctx.fillStyle = i % 2 === 0 ? '#e2e8f0' : '#f1f5f9';
    ctx.fillRect(0, y, docW, 80);
    ctx.fillStyle = '#334155';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Section ${i + 1} — scroll / pinch me`, 24, y + 36);
  }

  // Fake editable field
  const field = snap.editableHit;
  ctx.fillStyle = snap.editableFocused ? '#fff7ed' : '#ffffff';
  ctx.strokeStyle = snap.editableFocused ? '#f97316' : '#94a3b8';
  ctx.lineWidth = 2;
  roundRect(ctx, field.x, field.y, field.w, field.h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.font = '18px monospace';
  const caret = snap.editableFocused && Math.floor(snap.nowMs / 500) % 2 === 0 ? '|' : '';
  ctx.fillText((snap.textBuffer || 'Click to focus…') + caret, field.x + 12, field.y + 28);

  ctx.restore(); // scale/scroll
  ctx.restore(); // clip

  // Idle bobble
  const bx = width * 0.82 + Math.cos(snap.nowMs / 450) * 28;
  const by = height * 0.72 + Math.sin(snap.nowMs / 380) * 22;
  const hue = (snap.nowMs / 20) % 360;
  ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
  ctx.beginPath();
  ctx.arc(bx, by, 22 + Math.sin(snap.nowMs / 200) * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(bx - 7, by - 4, 3, 0, Math.PI * 2);
  ctx.arc(bx + 7, by - 4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx, by + 4, 8, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // Ripples
  for (const r of snap.ripples) {
    const age = (snap.nowMs - r.bornAt) / 450;
    if (age > 1) continue;
    ctx.strokeStyle = `rgba(249, 115, 22, ${1 - age})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 8 + age * 40, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Touch blobs
  for (const t of snap.touches) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.beginPath();
    ctx.arc(t.x, t.y, 28 * (t.force || 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#038';
    ctx.font = '12px sans-serif';
    ctx.fillText(`#${t.id}`, t.x - 8, t.y - 34);
  }

  // Cursor trail + cursor
  for (let i = 0; i < snap.trail.length; i++) {
    const p = snap.trail[i]!;
    const a = (i + 1) / (snap.trail.length + 1);
    ctx.fillStyle = `rgba(148, 163, 184, ${a * 0.5})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (snap.cursor) {
    const pressed = snap.mouseButton !== null;
    ctx.fillStyle = pressed ? '#f97316' : '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(snap.cursor.x, snap.cursor.y);
    ctx.lineTo(snap.cursor.x + 14, snap.cursor.y + 18);
    ctx.lineTo(snap.cursor.x + 6, snap.cursor.y + 16);
    ctx.closePath();
    ctx.fill();
    if (snap.mouseButton !== null) {
      const label = snap.mouseButton === 0 ? 'L' : snap.mouseButton === 1 ? 'M' : 'R';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(label, snap.cursor.x + 16, snap.cursor.y + 10);
    }
  }

  // History flash
  if (snap.navFlash) {
    const age = (snap.nowMs - snap.navFlash.at) / 400;
    if (age < 1) {
      ctx.fillStyle = `rgba(250, 204, 21, ${1 - age})`;
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText(snap.navFlash.dir === 'back' ? '←' : '→', width / 2 - 20, height / 2);
    }
  }

  // Evaluate toast
  if (snap.evalToast) {
    const age = (snap.nowMs - snap.evalToast.at) / 1500;
    if (age < 1) {
      ctx.fillStyle = `rgba(15, 23, 42, ${0.85 * (1 - age)})`;
      roundRect(ctx, pad, height - 48, width - pad * 2, 36, 8);
      ctx.fill();
      ctx.fillStyle = '#a3e635';
      ctx.font = '13px monospace';
      ctx.fillText(truncate(snap.evalToast.text, 80), pad + 12, height - 24);
    }
  }

  // HUD
  const hudY = height - 52;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  roundRect(ctx, pad, hudY - 8, Math.min(520, width - pad * 2), 48, 8);
  ctx.fill();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '12px monospace';
  const lag =
    snap.lastInputAt > 0 ? `${Math.max(0, snap.nowMs - snap.lastInputAt)}ms since input` : 'no input yet';
  ctx.fillText(
    `MOCK HARNESS  fps=${snap.emitFps.toFixed(0)}  encode=${snap.encodeMs}ms  q=${snap.jpegQuality}`,
    pad + 10,
    hudY + 10,
  );
  ctx.fillText(
    `inputs=${snap.inputCount}  last=${snap.lastInputType || '—'}  ${lag}`,
    pad + 10,
    hudY + 28,
  );

  // Held keys
  if (snap.heldKeys.length > 0) {
    ctx.fillStyle = '#fbbf24';
    ctx.font = '12px monospace';
    ctx.fillText(`keys: ${snap.heldKeys.join(' ')}`, width - 220, hudY + 18);
  }
}

function drawButton(
  ctx: SKRSContext2D,
  hit: { x: number; y: number; w: number; h: number },
  label: string,
  enabled: boolean,
): void {
  ctx.fillStyle = enabled ? '#334155' : '#1e293b';
  roundRect(ctx, hit.x, hit.y, hit.w, hit.h, 6);
  ctx.fill();
  ctx.fillStyle = enabled ? '#f8fafc' : '#64748b';
  ctx.font = '12px sans-serif';
  ctx.fillText(label, hit.x + 10, hit.y + 18);
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
