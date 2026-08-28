import { useEffect, useRef, useCallback } from 'react'

export function usePolling(fn: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  const refresh = useCallback(() => {
    void fnRef.current()
  }, [])

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return
    const id = setInterval(() => void fnRef.current(), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])

  return { refresh }
}
