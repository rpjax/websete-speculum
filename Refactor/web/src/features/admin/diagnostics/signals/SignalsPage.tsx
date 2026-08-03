import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  AdminPage,
  EmptyState,
  HelperCallout,
  PageHeader,
  StatusPill,
} from '@/features/admin/components'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { resourceMonitoringApi, type ResourceSignal } from '@/lib/resourceMonitoringApi'

const KIND_LABELS: Record<string, string> = {
  apiMemoryLeak: 'API memory leak',
  hostSaturation: 'Host saturation',
  renderRegression: 'Render regression',
  threadStarvation: 'Thread pool starvation',
  sessionCapacitySaturation: 'Session capacity saturation',
  sidecarInstability: 'Sidecar instability',
  journalStress: 'Journal stress',
}

function severityTone(s: string): 'info' | 'warning' | 'danger' | 'neutral' {
  if (s === 'critical') return 'danger'
  if (s === 'warning') return 'warning'
  if (s === 'info') return 'info'
  return 'neutral'
}

export function SignalsPage() {
  const [items, setItems] = useState<ResourceSignal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ResourceSignal | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await resourceMonitoringApi.signals({ status: 'active' })
        setItems(res.items)
      } catch {
        setError('Could not load signals')
      }
    })()
  }, [])

  return (
    <AdminPage>
      <PageHeader
        title="Signals"
        description="Active leaks and resource anomalies detected from Telemetry samples."
      />
      <HelperCallout title="Server-side detection">
        Signals are detected server-side from Telemetry samples in Journal.
      </HelperCallout>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {items.length === 0 && !error ? (
        <EmptyState
          title="No active signals"
          body="No resource anomalies are open right now."
          cta={{ label: 'Watch resources', href: '/w7s/admin/diagnostics/resources' }}
          tone="reassure"
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setSelected(s)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{KIND_LABELS[s.kind] ?? s.kind}</span>
                  <StatusPill label={s.severity} tone={severityTone(s.severity)} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.summary}</p>
                <p className="text-xs text-muted-foreground">{new Date(s.detectedAt).toLocaleString()}</p>
              </button>
              <Button asChild size="sm" variant="outline">
                <Link to={`/w7s/admin/diagnostics/resources?signalId=${s.id}`}>Jump to Resources</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected ? KIND_LABELS[selected.kind] ?? selected.kind : 'Signal'}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-3 text-sm">
              <p>{selected.summary}</p>
              <p className="text-muted-foreground">Detection phase: {selected.phase}</p>
              <Button asChild>
                <Link to={`/w7s/admin/diagnostics/resources?signalId=${selected.id}`}>Jump to Resources</Link>
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AdminPage>
  )
}
