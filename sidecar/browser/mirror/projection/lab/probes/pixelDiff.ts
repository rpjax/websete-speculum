/**
 * PNG pixel diff for lab paint parity (Virtual vs Projected clips).
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';

export type PixelDiffResult = {
  ok: boolean;
  identical: boolean;
  reason?: string;
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  diffPngBase64?: string;
};

export async function diffPngBuffers(
  a: Buffer,
  b: Buffer,
  opts?: { tolerance?: number; emitDiffImage?: boolean },
): Promise<PixelDiffResult> {
  const tolerance = opts?.tolerance ?? 0;
  try {
    const imgA = await loadImage(a);
    const imgB = await loadImage(b);
    const w = Math.min(imgA.width, imgB.width);
    const h = Math.min(imgA.height, imgB.height);
    if (w === 0 || h === 0) {
      return {
        ok: false,
        identical: false,
        reason: 'empty_dimensions',
        width: w,
        height: h,
        diffPixels: 0,
        totalPixels: 0,
        diffRatio: 1,
      };
    }
    const canvasA = createCanvas(w, h);
    const ctxA = canvasA.getContext('2d');
    ctxA.drawImage(imgA, 0, 0, w, h);
    const canvasB = createCanvas(w, h);
    const ctxB = canvasB.getContext('2d');
    ctxB.drawImage(imgB, 0, 0, w, h);
    const dataA = ctxA.getImageData(0, 0, w, h).data;
    const dataB = ctxB.getImageData(0, 0, w, h).data;
    let diffPixels = 0;
    const diffCanvas = opts?.emitDiffImage ? createCanvas(w, h) : null;
    const diffCtx = diffCanvas?.getContext('2d');
    const diffData = diffCtx ? diffCtx.createImageData(w, h) : null;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const dr = Math.abs(dataA[o]! - dataB[o]!);
      const dg = Math.abs(dataA[o + 1]! - dataB[o + 1]!);
      const db = Math.abs(dataA[o + 2]! - dataB[o + 2]!);
      const da = Math.abs(dataA[o + 3]! - dataB[o + 3]!);
      const differs = dr > tolerance || dg > tolerance || db > tolerance || da > tolerance;
      if (differs) diffPixels += 1;
      if (diffData) {
        if (differs) {
          diffData.data[o] = 255;
          diffData.data[o + 1] = 0;
          diffData.data[o + 2] = 0;
          diffData.data[o + 3] = 255;
        } else {
          diffData.data[o] = dataA[o]!;
          diffData.data[o + 1] = dataA[o + 1]!;
          diffData.data[o + 2] = dataA[o + 2]!;
          diffData.data[o + 3] = 128;
        }
      }
    }
    const totalPixels = w * h;
    let diffPngBase64: string | undefined;
    if (diffCtx && diffData && diffCanvas) {
      diffCtx.putImageData(diffData, 0, 0);
      diffPngBase64 = diffCanvas.toBuffer('image/png').toString('base64');
    }
    return {
      ok: true,
      identical: diffPixels === 0,
      width: w,
      height: h,
      diffPixels,
      totalPixels,
      diffRatio: totalPixels > 0 ? diffPixels / totalPixels : 0,
      diffPngBase64,
    };
  } catch (err) {
    return {
      ok: false,
      identical: false,
      reason: err instanceof Error ? err.message : String(err),
      width: 0,
      height: 0,
      diffPixels: 0,
      totalPixels: 0,
      diffRatio: 1,
    };
  }
}

export async function diffPngBase64(
  aBase64: string,
  bBase64: string,
  opts?: { tolerance?: number; emitDiffImage?: boolean },
): Promise<PixelDiffResult> {
  return diffPngBuffers(Buffer.from(aBase64, 'base64'), Buffer.from(bBase64, 'base64'), opts);
}
