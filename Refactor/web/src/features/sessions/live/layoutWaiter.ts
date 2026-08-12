import type { CanvasSize } from './CanvasViewportSync'

/** Minimum CSS box StartSession accepts — matches sessionPreStart policy. */
export const MIN_LAYOUT_PX = 100

export interface LayoutWaiter {
  /** Invalidate cached layout — next `wait` requires a fresh `report` after this call. */
  invalidate(): void
  /** Surface host measured a definitive layout box. */
  report(size: CanvasSize): void
  /** Wait until the definitive surface reports ≥ MIN_LAYOUT_PX or budget elapses. */
  wait(budgetMs: number): Promise<CanvasSize | null>
}

function isUsable(size: CanvasSize): boolean {
  return size.width >= MIN_LAYOUT_PX && size.height >= MIN_LAYOUT_PX
}

/**
 * Promise-based layout gate for StartSession. Replaces blind polling of
 * `canvasLayoutRef` after a mirror-mode swap (the ref was zeroed too early).
 */
export function createLayoutWaiter(layoutRef: { current: CanvasSize }): LayoutWaiter {
  let generation = 0
  let lastReportGeneration = -1

  return {
    invalidate() {
      generation += 1
    },
    report(size: CanvasSize) {
      if (size.width <= 0 || size.height <= 0) return
      layoutRef.current = size
      lastReportGeneration = generation
    },
    async wait(budgetMs: number): Promise<CanvasSize | null> {
      const deadline = performance.now() + budgetMs
      while (performance.now() < deadline) {
        const size = layoutRef.current
        if (lastReportGeneration >= generation && isUsable(size)) {
          return { width: size.width, height: size.height }
        }
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
      }
      const size = layoutRef.current
      if (lastReportGeneration >= generation && isUsable(size)) {
        return { width: size.width, height: size.height }
      }
      return null
    },
  }
}
