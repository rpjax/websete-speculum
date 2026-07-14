import { useState, useCallback, useEffect } from 'react'
import type { BrowserProbeResponse } from '@/lib/diagnosticsApi'

const STORAGE_KEY = 'speculum-probe-history'
const MAX_ENTRIES = 20

export interface ProbeHistoryEntry {
  id: string
  connectionId: string
  ops: string[]
  timestamp: string
  ok: boolean
  errorCode?: string
  correlationId?: string
  durationMs?: number
  summary: Record<string, unknown>
}

function loadHistory(): ProbeHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ProbeHistoryEntry[]) : []
  } catch {
    return []
  }
}

function saveHistory(entries: ProbeHistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
}

export function useProbeHistory() {
  const [history, setHistory] = useState<ProbeHistoryEntry[]>(loadHistory)

  useEffect(() => {
    const stored = loadHistory()
    setHistory(stored)
  }, [])

  const addEntry = useCallback((connectionId: string, ops: string[], result: BrowserProbeResponse, durationMs: number) => {
    const data = result.data as Record<string, unknown> | null
    const summary: Record<string, unknown> = {}
    if (data?.process && typeof data.process === 'object') {
      summary.pid = (data.process as Record<string, unknown>).pid
    }
    if (data?.tabs && Array.isArray(data.tabs)) {
      summary.tabs = (data.tabs as unknown[]).length
    }
    if (data?.cookies && Array.isArray(data.cookies)) {
      summary.cookies = (data.cookies as unknown[]).length
    }
    if (data?.resources && typeof data.resources === 'object') {
      const res = data.resources as Record<string, unknown>
      if (res.jsHeapUsed) summary.heapUsed = res.jsHeapUsed
    }

    const entry: ProbeHistoryEntry = {
      id: crypto.randomUUID(),
      connectionId,
      ops,
      timestamp: new Date().toISOString(),
      ok: result.ok,
      errorCode: result.errorCode ?? undefined,
      correlationId: result.correlationId ?? undefined,
      durationMs,
      summary,
    }

    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, MAX_ENTRIES)
      saveHistory(next)
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return { history, addEntry, clearHistory }
}

export interface ProbeTemplate {
  id: string
  name: string
  ops: string[]
  evaluateExpression?: string
  domSelector?: string
}

const TEMPLATES_KEY = 'speculum-probe-templates'

function loadTemplates(): ProbeTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    return raw ? (JSON.parse(raw) as ProbeTemplate[]) : []
  } catch {
    return []
  }
}

export function useProbeTemplates() {
  const [templates, setTemplates] = useState<ProbeTemplate[]>(loadTemplates)

  const saveTemplate = useCallback((name: string, ops: string[], evaluateExpression?: string, domSelector?: string) => {
    const t: ProbeTemplate = {
      id: crypto.randomUUID(),
      name,
      ops,
      evaluateExpression,
      domSelector,
    }
    setTemplates((prev) => {
      const next = [t, ...prev]
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id)
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { templates, saveTemplate, deleteTemplate }
}
