import { Link } from 'react-router-dom'
import { Activity, Database, HardDrive, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DataCard,
  FieldGrid,
  GuidedPreset,
  HelperCallout,
  InlineValidation,
  RevealPanel,
  StatCard,
  StatusPill,
  SwitchField,
} from '@/features/admin/components'
import {
  CAPACITY_PRESETS,
  GIB,
  KIB,
  RETENTION_DAY_PRESETS,
  SESSION_DURATION_PRESETS,
  STORAGE_BUDGET_PRESETS_GIB,
  applyCapacityPreset,
  bytesToGibInput,
  describeTimeSpan,
  formatGibLabel,
  formatKiBLabel,
  gibInputToBytes,
  isUnlimitedTimeSpan,
  nestedNumber,
  nestedText,
  retentionPresetId,
  sessionDurationPresetId,
  summarizeResourceManagement,
  timeSpanFromDays,
  type JsonObject,
} from './resourceManagementHelpers'

function Field({
  id,
  label,
  helper,
  value,
  onChange,
  type = 'text',
  min,
  step,
  placeholder,
  error,
  disabled,
}: {
  id: string
  label: string
  helper?: string
  value: string
  onChange: (value: string) => void
  type?: string
  min?: number
  step?: number
  placeholder?: string
  error?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        min={min}
        step={step}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
      <InlineValidation message={error} />
    </div>
  )
}

function DurationFacilitator({
  id,
  label,
  helper,
  value,
  onChange,
}: {
  id: string
  label: string
  helper: string
  value: string
  onChange: (next: string) => void
}) {
  const preset = sessionDurationPresetId(value)
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-mode`}>{label}</Label>
      <Select
        value={preset}
        onValueChange={(next) => {
          if (next === 'custom') {
            onChange(isUnlimitedTimeSpan(value) ? '04:00:00' : value || '04:00:00')
            return
          }
          const found = SESSION_DURATION_PRESETS.find((item) => item.id === next)
          if (found) onChange(found.value)
        }}
      >
        <SelectTrigger id={`${id}-mode`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SESSION_DURATION_PRESETS.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom TimeSpan…</SelectItem>
        </SelectContent>
      </Select>
      {preset === 'custom' ? (
        <Input
          id={id}
          value={value}
          placeholder="04:00:00 or 1.00:00:00"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {helper} Current: {describeTimeSpan(value)}.
      </p>
    </div>
  )
}

function RetentionFacilitator({
  id,
  label,
  helper,
  value,
  onChange,
}: {
  id: string
  label: string
  helper: string
  value: string
  onChange: (next: string) => void
}) {
  const preset = retentionPresetId(value)
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-mode`}>{label}</Label>
      <Select
        value={preset}
        onValueChange={(next) => {
          if (next === 'custom') {
            onChange(value.trim() || timeSpanFromDays(30))
            return
          }
          onChange(timeSpanFromDays(Number(next)))
        }}
      >
        <SelectTrigger id={`${id}-mode`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RETENTION_DAY_PRESETS.map((days) => (
            <SelectItem key={days} value={String(days)}>
              {days} days
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom TimeSpan…</SelectItem>
        </SelectContent>
      </Select>
      {preset === 'custom' ? (
        <Input
          id={id}
          value={value}
          placeholder="30.00:00:00"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {helper} Current: {describeTimeSpan(value)}.
      </p>
    </div>
  )
}

export function ResourceManagementEditor({
  value,
  replace,
  update,
}: {
  value: JsonObject
  replace: (next: JsonObject) => void
  update: (path: string[], raw: string | boolean | number) => void
}) {
  const summary = summarizeResourceManagement(value)
  const budgetBytes = nestedNumber(value, 'storage', 'budgetBytes')
  const budgetGib = bytesToGibInput(budgetBytes)
  const perProfile = nestedNumber(value, 'sessions', 'maxConcurrentSessionsPerProfile')
  const unlimitedPerProfile = perProfile <= 0
  const pipes = nestedNumber(value, 'sessions', 'maxPipesPerSession')
  const unlimitedPipes = pipes <= 0
  const probeBytes = nestedNumber(value, 'diagnostics', 'maxProbeResponseBytes')
  const probeKiB = probeBytes > 0 ? String(Math.round(probeBytes / KIB)) : '512'

  const matchedBudget = STORAGE_BUDGET_PRESETS_GIB.find((gib) => gib * GIB === budgetBytes)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={summary.complete ? `Admission · ${summary.slotsLabel}` : 'Admission incomplete'}
          tone={summary.complete ? 'success' : 'warning'}
        />
        <StatusPill label={`Budget · ${summary.budgetLabel}`} tone={budgetBytes > 0 ? 'success' : 'warning'} />
        <StatusPill label={`Duration · ${summary.durationLabel}`} tone="neutral" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Concurrent slots"
          value={summary.complete ? summary.maxSessions : '—'}
          icon={<Activity className="h-4 w-4" />}
          sub={summary.complete ? 'Live sessions this host may admit' : 'Set at least 1 to complete setup'}
          tone={summary.complete ? 'success' : 'warning'}
        />
        <StatCard
          label="Per profile"
          value={unlimitedPerProfile ? '∞' : perProfile}
          icon={<HardDrive className="h-4 w-4" />}
          sub={summary.perProfileLabel}
        />
        <StatCard
          label="Storage budget"
          value={budgetBytes > 0 ? formatGibLabel(budgetBytes) : '—'}
          icon={<Database className="h-4 w-4" />}
          sub="SQLite + journal soft ceiling"
          tone={budgetBytes > 0 ? 'default' : 'warning'}
        />
      </div>

      {!summary.complete ? (
        <HelperCallout tone="warning" title="Admission capacity is required">
          Completeness needs <span className="font-medium text-foreground">max concurrent sessions ≥ 1</span>.
          Pick a capacity preset below or enter a slot count.
        </HelperCallout>
      ) : null}

      <DataCard className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-medium">Capacity presets</h3>
          <p className="text-xs text-muted-foreground">
            Apply a starting point for slots, per-profile limit, pipes, session duration, and storage budget.
            Retention and diagnostics stay as-is unless you change them below.
          </p>
        </div>
        <GuidedPreset
          presets={CAPACITY_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label,
            apply: () => replace(applyCapacityPreset(value, preset)),
          }))}
        />
        <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          {CAPACITY_PRESETS.map((preset) => (
            <li key={preset.id} className="rounded-md border border-border/70 bg-background/40 px-2.5 py-2">
              <p className="font-medium text-foreground">{preset.label}</p>
              <p className="mt-0.5">{preset.description}</p>
              <p className="mt-1 tabular-nums">
                {preset.sessions.maxConcurrentSessions} slots · {formatGibLabel(preset.storage.budgetBytes)} ·{' '}
                {describeTimeSpan(preset.sessions.maxSessionDuration)}
              </p>
            </li>
          ))}
        </ul>
      </DataCard>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Session admission</h3>
          <p className="text-xs text-muted-foreground">
            How many live sessions this host may run, and how they are capped per browser profile.
          </p>
        </div>
        <FieldGrid>
          <Field
            id="maxConcurrentSessions"
            label="Maximum concurrent sessions"
            helper="Admission capacity for live sessions on this host. Required ≥ 1."
            type="number"
            min={1}
            value={summary.maxSessions ? String(summary.maxSessions) : ''}
            error={summary.maxSessions < 1 ? 'Enter at least 1 concurrent session.' : undefined}
            onChange={(v) => update(['sessions', 'maxConcurrentSessions'], v)}
          />
          <div className="space-y-3">
            <SwitchField
              id="unlimited-per-profile"
              label="Unlimited sessions per profile"
              helper="Off = cap concurrent sessions that share one profile."
              checked={unlimitedPerProfile}
              onCheckedChange={(checked) =>
                update(['sessions', 'maxConcurrentSessionsPerProfile'], checked ? 0 : Math.max(1, summary.maxSessions || 1))
              }
            />
            {!unlimitedPerProfile ? (
              <Field
                id="maxConcurrentSessionsPerProfile"
                label="Max sessions per profile"
                type="number"
                min={1}
                value={String(perProfile)}
                onChange={(v) => update(['sessions', 'maxConcurrentSessionsPerProfile'], v)}
              />
            ) : null}
          </div>
        </FieldGrid>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 4, 8, 16].map((slots) => (
            <Button
              key={slots}
              type="button"
              size="sm"
              variant={summary.maxSessions === slots ? 'default' : 'outline'}
              onClick={() => update(['sessions', 'maxConcurrentSessions'], slots)}
            >
              {slots} slot{slots === 1 ? '' : 's'}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-4 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-medium">Storage budget</h3>
          <p className="text-xs text-muted-foreground">
            Soft ceiling for Speculum SQLite and journal payload. Retention cleaners use this for degradation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STORAGE_BUDGET_PRESETS_GIB.map((gib) => (
            <Button
              key={gib}
              type="button"
              size="sm"
              variant={matchedBudget === gib ? 'default' : 'outline'}
              onClick={() => update(['storage', 'budgetBytes'], gib * GIB)}
            >
              {gib} GiB
            </Button>
          ))}
        </div>
        <Field
          id="budgetGib"
          label="Custom budget (GiB)"
          helper={budgetBytes > 0 ? `Wire value: ${budgetBytes.toLocaleString()} bytes.` : 'Budget must be greater than zero.'}
          type="number"
          min={0.1}
          step={0.1}
          value={budgetGib}
          error={budgetBytes <= 0 ? 'Set a storage budget greater than 0 GiB.' : undefined}
          onChange={(v) => update(['storage', 'budgetBytes'], gibInputToBytes(v))}
        />
      </section>

      <HelperCallout
        title="Host memory and /dev/shm"
        action={{ label: 'Open Host resources', href: '/admin/host-resources' }}
      >
        This section caps admission and storage policy. Shared-memory sizing for the sidecar is planned separately
        under Host resources.
      </HelperCallout>

      <RevealPanel title="Session duration and pipes" defaultOpen>
        <div className="space-y-4">
          <DurationFacilitator
            id="maxSessionDuration"
            label="Max session duration"
            helper="Hard stop for a live session lifetime. No limit leaves the server default."
            value={nestedText(value, 'sessions', 'maxSessionDuration')}
            onChange={(next) => update(['sessions', 'maxSessionDuration'], next)}
          />
          <SwitchField
            id="unlimited-pipes"
            label="Unlimited pipes per session"
            helper="Off = limit concurrent pipes attached to one session."
            checked={unlimitedPipes}
            onCheckedChange={(checked) => update(['sessions', 'maxPipesPerSession'], checked ? 0 : 4)}
          />
          {!unlimitedPipes ? (
            <Field
              id="maxPipesPerSession"
              label="Max pipes per session"
              type="number"
              min={1}
              value={String(pipes)}
              onChange={(v) => update(['sessions', 'maxPipesPerSession'], v)}
            />
          ) : null}
        </div>
      </RevealPanel>

      <RevealPanel title="Profiles and retention">
        <div className="space-y-4">
          <RetentionFacilitator
            id="inactiveRetentionPeriod"
            label="Inactive profile retention"
            helper="How long unused profiles stay before cleanup."
            value={nestedText(value, 'profiles', 'inactiveRetentionPeriod') || timeSpanFromDays(30)}
            onChange={(next) => update(['profiles', 'inactiveRetentionPeriod'], next)}
          />
          <Field
            id="maxNavigationHistoryEntries"
            label="Max navigation history entries"
            helper="Per-profile history cap stored with the profile."
            type="number"
            min={0}
            value={String(nestedNumber(value, 'profiles', 'maxNavigationHistoryEntries') || 500)}
            onChange={(v) => update(['profiles', 'maxNavigationHistoryEntries'], v)}
          />
          <div className="flex flex-wrap gap-2">
            {[100, 250, 500, 1000].map((count) => (
              <Button
                key={count}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => update(['profiles', 'maxNavigationHistoryEntries'], count)}
              >
                {count} entries
              </Button>
            ))}
          </div>
          <RetentionFacilitator
            id="sessionTelemetryRetention"
            label="Session telemetry retention"
            helper="Session-indexed journal facts."
            value={nestedText(value, 'storage', 'sessionTelemetryRetention') || timeSpanFromDays(7)}
            onChange={(next) => update(['storage', 'sessionTelemetryRetention'], next)}
          />
          <RetentionFacilitator
            id="telemetrySampleRetention"
            label="Telemetry sample retention"
            helper="Composite Telemetry.SampleCollected rows."
            value={nestedText(value, 'storage', 'telemetrySampleRetention') || timeSpanFromDays(7)}
            onChange={(next) => update(['storage', 'telemetrySampleRetention'], next)}
          />
          <RetentionFacilitator
            id="journalFactRetention"
            label="Journal fact retention"
            helper="Remaining journal facts not covered by the tiers above."
            value={nestedText(value, 'storage', 'journalFactRetention') || timeSpanFromDays(30)}
            onChange={(next) => update(['storage', 'journalFactRetention'], next)}
          />
        </div>
      </RevealPanel>

      <RevealPanel title="Diagnostics probe limits">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Caps for BrowserQuery / DiagProbe traffic so investigations cannot starve live sessions.
          </p>
          <FieldGrid>
            <Field
              id="maxConcurrentProbesPerSession"
              label="Max concurrent probes / session"
              type="number"
              min={1}
              value={String(nestedNumber(value, 'diagnostics', 'maxConcurrentProbesPerSession') || 2)}
              onChange={(v) => update(['diagnostics', 'maxConcurrentProbesPerSession'], v)}
            />
            <div className="space-y-2">
              <Label htmlFor="maxProbeResponseKiB">Max probe response (KiB)</Label>
              <Input
                id="maxProbeResponseKiB"
                type="number"
                min={64}
                step={64}
                value={probeKiB}
                onChange={(event) => {
                  const kib = Number(event.target.value)
                  update(
                    ['diagnostics', 'maxProbeResponseBytes'],
                    Number.isFinite(kib) && kib > 0 ? Math.round(kib * KIB) : 512 * KIB,
                  )
                }}
              />
              <p className="text-xs text-muted-foreground">Current: {formatKiBLabel(probeBytes || 512 * KIB)}.</p>
              <div className="flex flex-wrap gap-2">
                {[256, 512, 1024].map((kib) => (
                  <Button
                    key={kib}
                    type="button"
                    size="sm"
                    variant={Math.round((probeBytes || 0) / KIB) === kib ? 'default' : 'outline'}
                    onClick={() => update(['diagnostics', 'maxProbeResponseBytes'], kib * KIB)}
                  >
                    {kib} KiB
                  </Button>
                ))}
              </div>
            </div>
          </FieldGrid>
          <DurationFacilitator
            id="maxElevationDuration"
            label="Max elevation duration"
            helper="Longest diagnostics elevate window an operator may request."
            value={nestedText(value, 'diagnostics', 'maxElevationDuration') || '00:30:00'}
            onChange={(next) => update(['diagnostics', 'maxElevationDuration'], next)}
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5" />
            <span>
              Need live capacity on the machine itself?{' '}
              <Link className="font-medium underline" to="/admin/host-resources">
                Plan Host resources
              </Link>
              .
            </span>
          </div>
        </div>
      </RevealPanel>
    </div>
  )
}
