import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnalysisMandateForm } from './AnalysisMandateForm'
import { AnalysisProgress } from './AnalysisProgress'
import { AnalysisReportView } from './AnalysisReportView'
import { runAnalysis } from './pipeline/orchestrator'
import type { AnalysisMandate, AnalysisPhase, ReportDocument } from './types'

const HISTORY_KEY = 'speculum.diagnostics.analysis.history'

interface HistoryEntry {
  id: string
  title: string
  generatedAt: string
  report: ReportDocument
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    return JSON.parse(raw) as HistoryEntry[]
  } catch {
    return []
  }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 8)))
}

export default function AnalysisWorkspacePage() {
  const [searchParams] = useSearchParams()
  const [phase, setPhase] = useState<AnalysisPhase>('idle')
  const [detail, setDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ReportDocument | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())

  const initial = useMemo(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const connectionId = searchParams.get('connectionId')
    const partial: Partial<AnalysisMandate> = {}
    if (from) partial.fromMs = Date.parse(from)
    if (to) partial.toMs = Date.parse(to)
    if (connectionId) partial.scope = { kind: 'sessions', connectionIds: [connectionId] }
    return partial
  }, [searchParams])

  async function handleRun(mandate: AnalysisMandate) {
    setError(null)
    setReport(null)
    setPhase('collect')
    try {
      const doc = await runAnalysis(mandate, (p, d) => {
        setPhase(p)
        setDetail(d ?? null)
      })
      setReport(doc)
      const entry: HistoryEntry = {
        id: `${Date.now()}`,
        title: doc.title,
        generatedAt: doc.generatedAt,
        report: doc,
      }
      const next = [entry, ...history.filter((h) => h.id !== entry.id)]
      setHistory(next)
      saveHistory(next)
    } catch (e: unknown) {
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Analysis failed')
    }
  }

  return (
    <div className="space-y-4">
      <AnalysisMandateForm initial={initial} pending={phase !== 'idle' && phase !== 'done' && phase !== 'error'} onRun={(m) => void handleRun(m)} />
      <AnalysisProgress phase={phase} detail={detail} />
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
      )}
      {report && <AnalysisReportView report={report} />}

      {history.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent analyses (this browser)</p>
          <ul className="mt-2 space-y-1">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="text-left text-sm text-primary hover:underline"
                  onClick={() => {
                    setReport(h.report)
                    setPhase('done')
                  }}
                >
                  {h.title}
                  <span className="ml-2 text-xs text-muted-foreground">{new Date(h.generatedAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
