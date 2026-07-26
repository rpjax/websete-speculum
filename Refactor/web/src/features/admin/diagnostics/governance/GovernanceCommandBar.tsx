import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SystemStateBanner } from '@/components/admin/SystemStateBanner'
import type { DiagnosticsOverview, DiagnosticsProfile } from '@/lib/diagnosticsApi'
import { cn } from '@/lib/utils'
import {
  Check,
  FlaskConical,
  Gauge,
  HelpCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Zap,
} from 'lucide-react'
import { PROFILE_GUIDES, PROFILES } from './governanceDefaults'

interface GovernanceCommandBarProps {
  overview: DiagnosticsOverview | null
  profile: DiagnosticsProfile
  dirtyCount: number
  saving: boolean
  recovering: boolean
  onProfileChange: (profile: DiagnosticsProfile) => void
  onRefresh: () => void
  onSave: () => void
  onDiscard: () => void
  onElevateOpen: () => void
  onRecover: () => void
  onClearElevate: () => void
}

const PROFILE_ICONS: Record<DiagnosticsProfile, typeof Gauge> = {
  Development: FlaskConical,
  Production: Shield,
  Assertive: Gauge,
}

export function GovernanceCommandBar({
  overview,
  profile,
  dirtyCount,
  saving,
  recovering,
  onProfileChange,
  onRefresh,
  onSave,
  onDiscard,
  onElevateOpen,
  onRecover,
  onClearElevate,
}: GovernanceCommandBarProps) {
  const elevateActive = Boolean(overview?.elevate?.active)
  const guide = PROFILE_GUIDES[profile]

  return (
    <div className="space-y-4">
      {/* Runtime plane */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Runtime
          </p>
          {overview && (
            <span className="text-xs text-muted-foreground">
              Redaction: <span className="font-medium text-foreground">{overview.redactionMode}</span>
              <span className="mx-1.5 text-border">·</span>
              Schema v{overview.diagnosticsSchemaVersion}
            </span>
          )}
          <Button variant="ghost" size="sm" className="ml-auto h-8 gap-1.5 text-xs" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {overview && (
          <SystemStateBanner
            degraded={overview.degraded}
            elevate={overview.elevate}
            onRecover={onRecover}
            onClearElevate={onClearElevate}
            recovering={recovering}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!elevateActive && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onElevateOpen}>
              <Zap className="h-3.5 w-3.5" /> Elevate…
            </Button>
          )}
          {overview?.degraded && (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onRecover}
              disabled={recovering}
            >
              {recovering ? 'Recovering…' : 'Recover'}
            </Button>
          )}
          <p className="hidden text-[11px] text-muted-foreground sm:block sm:max-w-xs">
            Elevate / Recover are temporary overlays — they never rewrite the saved profile or toggles.
          </p>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {dirtyCount > 0 && (
              <span className="text-xs font-medium text-warning">● {dirtyCount} unsaved</span>
            )}
            {dirtyCount > 0 && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onDiscard}>
                <RotateCcw className="h-3.5 w-3.5" /> Discard
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onSave}
              disabled={saving || dirtyCount === 0}
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving…' : 'Save configuration'}
            </Button>
          </div>
        </div>
      </div>

      {/* Profile plane */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-start gap-3 border-b border-border/50 px-4 py-3 sm:px-5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Gauge className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold">Profile baseline</h3>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm text-xs leading-relaxed">
                  A profile is a named seed of capability + telemetry toggles. Choosing one fills the draft
                  (Coverage and Telemetry tabs). It does not auto-save. After you Save, individual toggles
                  still override the profile name — the profile field only records which baseline you started from.
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Start from a sensible bundle for your environment, then fine-tune Coverage / Telemetry / Budgets.
              Selecting a profile updates the <strong className="font-medium text-foreground">draft only</strong>
              — click Save to apply, and wait for <code className="rounded bg-muted px-1">ConfigApplied</code>.
            </p>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {PROFILES.map((p) => {
            const meta = PROFILE_GUIDES[p]
            const Icon = PROFILE_ICONS[p]
            const selected = profile === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => onProfileChange(p)}
                className={cn(
                  'relative flex flex-col rounded-lg border px-3.5 py-3 text-left transition-colors',
                  selected
                    ? 'border-primary/50 bg-primary/10 ring-2 ring-primary/20'
                    : 'border-border bg-muted/10 hover:border-border hover:bg-muted/20',
                )}
              >
                {selected && (
                  <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <div className="mb-2 flex items-center gap-2">
                  <Icon className={cn('h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="text-sm font-bold">{p}</span>
                </div>
                <p className="text-xs font-medium text-foreground/90">{meta.tagline}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{meta.audience}</p>
                <ul className="mt-2.5 space-y-1 border-t border-border/40 pt-2.5">
                  {meta.highlights.map((h) => (
                    <li key={h} className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      {h}
                    </li>
                  ))}
                </ul>
              </button>
            )
          })}
        </div>

        <div className="border-t border-border/50 bg-muted/10 px-4 py-3 sm:px-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Active draft: {profile}</span>
            {' — '}
            {guide.tagline}. Overrides in Coverage or Telemetry keep working after you pick a profile;
            Save publishes the full draft (profile name + every toggle).
          </p>
        </div>
      </div>
    </div>
  )
}
