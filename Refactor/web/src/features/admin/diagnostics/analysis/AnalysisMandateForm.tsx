import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AnalysisDepth, AnalysisMandate, AnalysisStudyProfile, AnalysisScope } from './types'

interface AnalysisMandateFormProps {
  initial?: Partial<AnalysisMandate>
  pending: boolean
  onRun: (mandate: AnalysisMandate) => void
}

function defaultMandate(initial?: Partial<AnalysisMandate>): AnalysisMandate {
  const now = Date.now()
  return {
    fromMs: initial?.fromMs ?? now - 3600_000,
    toMs: initial?.toMs ?? now,
    scope: initial?.scope ?? { kind: 'platform' },
    depth: initial?.depth ?? 'standard',
    profile: initial?.profile ?? 'operational',
    includeEvents: initial?.includeEvents ?? true,
    includeTelemetry: initial?.includeTelemetry ?? true,
    includeRuntime: initial?.includeRuntime ?? true,
    includeSnapshots: initial?.includeSnapshots ?? false,
  }
}

function toLocal(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AnalysisMandateForm({ initial, pending, onRun }: AnalysisMandateFormProps) {
  const seed = useMemo(() => defaultMandate(initial), [initial])
  const [fromLocal, setFromLocal] = useState(toLocal(seed.fromMs))
  const [toLocalVal, setToLocalVal] = useState(toLocal(seed.toMs))
  const [scopeKind, setScopeKind] = useState<'platform' | 'system' | 'sessions'>(
    seed.scope.kind === 'sessions' ? 'sessions' : seed.scope.kind,
  )
  const [sessionIds, setSessionIds] = useState(
    seed.scope.kind === 'sessions' ? seed.scope.connectionIds.join(', ') : '',
  )
  const [depth, setDepth] = useState<AnalysisDepth>(seed.depth)
  const [profile, setProfile] = useState<AnalysisStudyProfile>(seed.profile)
  const [includeEvents, setIncludeEvents] = useState(seed.includeEvents)
  const [includeTelemetry, setIncludeTelemetry] = useState(seed.includeTelemetry)
  const [includeRuntime, setIncludeRuntime] = useState(seed.includeRuntime)
  const [includeSnapshots, setIncludeSnapshots] = useState(seed.includeSnapshots)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function submit() {
    const fromMs = Date.parse(fromLocal)
    const toMs = Date.parse(toLocalVal)
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return

    let scope: AnalysisScope = { kind: 'platform' }
    if (scopeKind === 'system') scope = { kind: 'system' }
    if (scopeKind === 'sessions') {
      const ids = sessionIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
      scope = { kind: 'sessions', connectionIds: ids }
    }

    onRun({
      fromMs,
      toMs,
      scope,
      depth,
      profile,
      includeEvents,
      includeTelemetry,
      includeRuntime,
      includeSnapshots: includeSnapshots && depth === 'deep',
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Set the mandate</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Analysis is a separate tool from the Timeline. Choose a period and study profile, then run a full didactic report —
          routine success and friction alike. Nothing here syncs live with the Timeline canvas.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="analysis-from" className="text-xs">From</Label>
          <Input
            id="analysis-from"
            type="datetime-local"
            className="h-9 text-sm"
            value={fromLocal}
            onChange={(e) => setFromLocal(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="analysis-to" className="text-xs">To</Label>
          <Input
            id="analysis-to"
            type="datetime-local"
            className="h-9 text-sm"
            value={toLocalVal}
            onChange={(e) => setToLocalVal(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Scope</Label>
          <Select value={scopeKind} onValueChange={(v) => setScopeKind(v as typeof scopeKind)}>
            <SelectTrigger className="h-9" aria-label="Analysis scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="platform">Platform</SelectItem>
              <SelectItem value="system">System only</SelectItem>
              <SelectItem value="sessions">Session id(s)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Study profile</Label>
          <Select value={profile} onValueChange={(v) => setProfile(v as AnalysisStudyProfile)}>
            <SelectTrigger className="h-9" aria-label="Study profile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="operational">Operational portrait</SelectItem>
              <SelectItem value="post-incident">Post-incident</SelectItem>
              <SelectItem value="capacity">Capacity & saturation</SelectItem>
              <SelectItem value="evidence-completeness">Evidence completeness</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {scopeKind === 'sessions' && (
        <div className="space-y-1.5">
          <Label htmlFor="analysis-sessions" className="text-xs">Connection ids (comma-separated)</Label>
          <Input
            id="analysis-sessions"
            className="h-9 font-mono text-sm"
            value={sessionIds}
            onChange={(e) => setSessionIds(e.target.value)}
            placeholder="conn-…"
          />
        </div>
      )}

      <div>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground',
            advancedOpen && 'text-primary',
          )}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          Advanced — depth & evidence
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')} />
        </button>

        {advancedOpen && (
          <div className="mt-3 space-y-4 rounded-lg border border-border/60 bg-muted/10 p-4">
            <div className="space-y-1.5 max-w-xs">
              <Label className="text-xs">Depth</Label>
              <Select value={depth} onValueChange={(v) => setDepth(v as AnalysisDepth)}>
                <SelectTrigger className="h-9" aria-label="Analysis depth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overview">Overview</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="deep">Deep</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeEvents}
                  onCheckedChange={(c) => setIncludeEvents(!!c)}
                  aria-label="Include events and chapters"
                />
                Events / chapters
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeTelemetry}
                  onCheckedChange={(c) => setIncludeTelemetry(!!c)}
                  aria-label="Include telemetry"
                />
                Telemetry
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeRuntime}
                  onCheckedChange={(c) => setIncludeRuntime(!!c)}
                  aria-label="Include runtime and governance"
                />
                Runtime / governance
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeSnapshots && depth === 'deep'}
                  disabled={depth !== 'deep'}
                  onCheckedChange={(c) => setIncludeSnapshots(!!c)}
                  aria-label="Include snapshots"
                />
                Snapshots (deep)
              </label>
            </div>
          </div>
        )}
      </div>

      <Button disabled={pending} onClick={submit} className="gap-1.5">
        {pending ? 'Running analysis…' : 'Run analysis'}
      </Button>
    </div>
  )
}
