import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  AdminPage,
  HelperCallout,
  InlineValidation,
  PageHeader,
  StepWizard,
} from '@/features/admin/components'
import { resourceMonitoringApi } from '@/lib/resourceMonitoringApi'
import { AdminApiError } from '@/lib/adminFetch'

const KINDS = [
  { id: 'resourceTrend', label: 'Resource trend', helper: 'Summarize host, API process, and session series for a window.' },
  { id: 'leakSuspect', label: 'Leak suspect', helper: 'Focus on API memory leak and related signals.' },
  { id: 'saturationWindow', label: 'Saturation window', helper: 'Host CPU/memory or session capacity pressure.' },
  { id: 'journalHealth', label: 'Journal health', helper: 'Journal queue depth, drops, and persist pressure.' },
] as const

const STEPS = [
  { id: 'kind', title: 'Kind' },
  { id: 'period', title: 'Period' },
  { id: 'review', title: 'Review' },
]

type StepId = 'kind' | 'period' | 'review'

function stepIndex(step: StepId): number {
  return STEPS.findIndex((s) => s.id === step)
}

export function ReportFlowPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const step = ((params.get('step') as StepId) || 'kind')
  const kind = params.get('kind') ?? ''
  const from = params.get('from') ?? new Date(Date.now() - 3600_000).toISOString()
  const to = params.get('to') ?? new Date().toISOString()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setStep = (next: StepId, extra?: Record<string, string>) => {
    const q = new URLSearchParams(params)
    q.set('step', next)
    if (extra) Object.entries(extra).forEach(([k, v]) => q.set(k, v))
    setParams(q, { replace: true })
  }

  return (
    <AdminPage>
      <PageHeader title="Generate report" description="Materialize a Journal-backed resource report." />
      <StepWizard
        steps={STEPS}
        currentIndex={Math.max(0, stepIndex(step))}
        onBack={
          step === 'kind'
            ? undefined
            : () => setStep(step === 'review' ? 'period' : 'kind')
        }
        allowAbandon
        onAbandon={() => navigate('/w7s/admin/diagnostics/reports')}
      >
        {step === 'kind' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`rounded-lg border p-4 text-left hover:border-primary ${kind === k.id ? 'border-primary bg-primary/5' : ''}`}
                onClick={() => setStep('kind', { kind: k.id })}
              >
                <div className="font-medium">{k.label}</div>
                <p className="mt-1 text-sm text-muted-foreground">{k.helper}</p>
              </button>
            ))}
            {!kind && <InlineValidation message="Choose a report kind" />}
            <div className="sm:col-span-2 flex justify-end">
              <Button disabled={!kind} onClick={() => setStep('period', { kind })}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 'period' && (
          <div className="space-y-4 max-w-lg">
            <HelperCallout title="Window">
              Reports read Telemetry.Sampling.SampleCollected facts in this window.
            </HelperCallout>
            <label className="block text-sm">
              From
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={toDatetimeLocal(from)}
                onChange={(e) => setStep('period', { from: fromDatetimeLocal(e.target.value) })}
              />
            </label>
            <label className="block text-sm">
              To
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={toDatetimeLocal(to)}
                onChange={(e) => setStep('period', { to: fromDatetimeLocal(e.target.value) })}
              />
            </label>
            <div className="flex justify-end">
              <Button onClick={() => setStep('review')}>Next</Button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4 max-w-lg">
            <HelperCallout title="Server materialization">
              The API materializes chapters from Journal samples. Large windows stay pending until ready.
            </HelperCallout>
            <div className="rounded-md border p-4 text-sm space-y-1">
              <div>Kind: {KINDS.find((k) => k.id === kind)?.label ?? kind}</div>
              <div>
                Window: {new Date(from).toLocaleString()} → {new Date(to).toLocaleString()}
              </div>
              <div>Source: Journal Telemetry.Sampling.SampleCollected</div>
            </div>
            {error && <InlineValidation message={error} />}
            <div className="flex justify-end">
              <Button
                disabled={submitting || !kind}
                onClick={() => {
                  void (async () => {
                    setSubmitting(true)
                    setError(null)
                    try {
                      const created = await resourceMonitoringApi.createReport({ kind, from, to })
                      navigate(`/w7s/admin/diagnostics/reports/${created.id}`)
                    } catch (e) {
                      setError(e instanceof AdminApiError ? e.message : 'Could not create report')
                    } finally {
                      setSubmitting(false)
                    }
                  })()
                }}
              >
                Generate
              </Button>
            </div>
          </div>
        )}
      </StepWizard>
      <p className="text-sm">
        <Link to="/w7s/admin/diagnostics/reports" className="text-primary underline-offset-4 hover:underline">
          Back to reports
        </Link>
      </p>
    </AdminPage>
  )
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}
