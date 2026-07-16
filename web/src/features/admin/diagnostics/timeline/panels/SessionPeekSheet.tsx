import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  diagnosticsApi,
  isFullSessionSnapshot,
  type MotorSessionDiagnosticsSnapshot,
} from '@/lib/diagnosticsApi'
import { formatDuration, formatRelativeTime } from '@/lib/diagnosticsConstants'
import { humanizeConnectionId } from '@/lib/diagnosticsDescriptions'
import type { NarrativeLane } from '../model/narrativeTypes'
import { ArrowRight, RefreshCw } from 'lucide-react'

interface SessionPeekSheetProps {
  lane: NarrativeLane | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SessionPeekSheet({ lane, open, onOpenChange }: SessionPeekSheetProps) {
  const [snapshot, setSnapshot] = useState<MotorSessionDiagnosticsSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!lane || lane.kind !== 'session') {
      setSnapshot(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await diagnosticsApi.getSession(lane.id))
    } catch (e: unknown) {
      setSnapshot(null)
      setError(e instanceof Error ? e.message : 'Session snapshot unavailable')
    } finally {
      setLoading(false)
    }
  }, [lane])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {lane && (
          <>
            <SheetHeader>
              <SheetTitle>{lane.label}</SheetTitle>
              <SheetDescription>
                {lane.kind === 'system'
                  ? 'System lane — DiagnosticsSelf and connection-less beats.'
                  : `Live peek for ${humanizeConnectionId(lane.id)}. Snapshot loads on demand.`}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="muted">{lane.chapters.length} chapters</Badge>
              <Badge variant="muted">{lane.beats.length} beats</Badge>
            </div>

            {lane.kind === 'session' && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => void load()} disabled={loading}>
                    <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh snapshot
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-xs">
                    <Link to={`/admin/diagnostics/investigate?connectionId=${encodeURIComponent(lane.id)}`}>
                      Probe <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
                {loading && <Skeleton className="h-24 w-full" />}
                {error && <p className="text-sm text-muted-foreground">{error}</p>}
                {snapshot && (
                  <dl className="space-y-2 rounded-lg border border-border p-3 text-sm">
                    {!isFullSessionSnapshot(snapshot) && (
                      <Row label="Detail" value="Limited (Motor.Snapshots off)" />
                    )}
                    <Row label="Phase" value={snapshot.phase} />
                    <Row label="FPS" value={String(snapshot.fps)} />
                    <Row label="Uptime" value={formatDuration(snapshot.uptimeMs)} />
                    <Row label="URL" value={snapshot.currentUrl || '—'} />
                    <Row label="Sidecar" value={snapshot.sidecarConnected ? 'connected' : 'disconnected'} />
                    <Row label="Last event" value={formatRelativeTime(snapshot.lastEventUtc)} />
                    {snapshot.lastFault && <Row label="Fault" value={snapshot.lastFault} />}
                  </dl>
                )}
                <Link
                  to={`/admin/sessions/${encodeURIComponent(lane.id)}`}
                  className="flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/10"
                >
                  Open full session details <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}

            {lane.kind === 'system' && (
              <div className="mt-4 space-y-2">
                {lane.chapters.slice(0, 8).map((c) => (
                  <div key={c.key} className="rounded-md border border-border/50 px-3 py-2 text-xs">
                    <p className="font-medium">{c.proseHint.slice(0, 120)}…</p>
                    <p className="mt-1 text-muted-foreground">{c.beats.length} beats · {c.outcome}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  )
}
