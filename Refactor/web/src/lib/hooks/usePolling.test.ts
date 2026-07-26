import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePolling } from './usePolling'

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls the function at the specified interval', () => {
    const fn = vi.fn()
    renderHook(() => usePolling(fn, 1000))

    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not poll when disabled', () => {
    const fn = vi.fn()
    renderHook(() => usePolling(fn, 1000, false))

    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('stops polling on unmount', () => {
    const fn = vi.fn()
    const { unmount } = renderHook(() => usePolling(fn, 500))

    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)

    unmount()
    vi.advanceTimersByTime(2000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not poll when interval is zero or negative', () => {
    const fn = vi.fn()
    renderHook(() => usePolling(fn, 0))

    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('provides a refresh function for manual invocation', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => usePolling(fn, 10_000))

    result.current.refresh()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses latest function reference via ref', () => {
    let counter = 0
    const fn1 = vi.fn(() => { counter = 1 })
    const fn2 = vi.fn(() => { counter = 2 })

    const { rerender } = renderHook(
      ({ fn }) => usePolling(fn, 1000),
      { initialProps: { fn: fn1 } },
    )

    rerender({ fn: fn2 })
    vi.advanceTimersByTime(1000)

    expect(counter).toBe(2)
    expect(fn2).toHaveBeenCalled()
  })
})
