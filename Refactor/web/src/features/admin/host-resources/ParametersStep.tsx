import { useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  DataCard,
  FieldGrid,
  HelperCallout,
  InlineValidation,
  RevealPanel,
  ResourceGauge,
  StatusPill,
  SwitchField,
} from '@/features/admin/components'
import {
  DEFAULT_PARAMS,
  PLAN_PRESETS,
  RESERVE_MIN_GIB_CHIPS,
  RESERVE_PERCENT_CHIPS,
  SHM_MIN_GIB_CHIPS,
  SHM_PERCENT_CHIPS,
  applyPlanPreset,
  bytesToGibInput,
  describePlanRecipe,
  estimatePlan,
  formatGibLabel,
  gibInputToBytes,
  isCustomChipValue,
  planBreakdownPercents,
  ramGibChips,
  type HostResourceProvisionParams,
  type PlanPresetId,
  validateAgainstHost,
} from './hostResourcesHelpers'

export function ParametersStep({
  params,
  hostMemoryTotalBytes,
  onChange,
  onPreview,
  pending,
}: {
  params: HostResourceProvisionParams
  hostMemoryTotalBytes?: number | null
  onChange: (next: HostResourceProvisionParams) => void
  onPreview: () => void
  pending: boolean
}) {
  const [pickedPreset, setPickedPreset] = useState<PlanPresetId | null>(null)
  const validation = validateAgainstHost(params, hostMemoryTotalBytes)
  const estimate =
    hostMemoryTotalBytes != null && hostMemoryTotalBytes > 0
      ? estimatePlan(params, hostMemoryTotalBytes)
      : null
  const breakdown = estimate
    ? planBreakdownPercents({
        budgetBytes: estimate.budgetBytes,
        reserveBytes: estimate.reserveBytes,
        shmTargetBytes: estimate.shmTargetBytes,
      })
    : null
  const ramChips = ramGibChips(hostMemoryTotalBytes)
  const maxRamGib = bytesToGibInput(params.maxRamBytes)
  const matchedRam =
    params.maxRamBytes == null
      ? null
      : ramChips.find((gib) => Math.abs(gib * (1024 ** 3) - (params.maxRamBytes ?? 0)) < 1)
  const reservePercent = params.reservePercent ?? DEFAULT_PARAMS.reservePercent!
  const reserveMinGib = Number(bytesToGibInput(params.reserveMinBytes)) || 0
  const shmMinGib = Number(bytesToGibInput(params.shmMinBytes)) || 0
  const shmCapPercent = params.shmMaxPercentOfBudget ?? DEFAULT_PARAMS.shmMaxPercentOfBudget!
  const picked = PLAN_PRESETS.find((preset) => preset.id === pickedPreset) ?? null

  const patch = (partial: Partial<HostResourceProvisionParams>) => {
    setPickedPreset(null)
    onChange({ ...params, ...partial })
  }

  const applyPreset = (presetId: PlanPresetId) => {
    setPickedPreset(presetId)
    onChange(applyPlanPreset(params, presetId, hostMemoryTotalBytes))
  }

  return (
    <div className="space-y-5">
      <HelperCallout title="What you are planning">
        Speculum browsers need shared memory on the host. Pick a starting plan that matches this machine, confirm the
        live estimate, then review. Open the three steps only when you need a custom split.
      </HelperCallout>

      <DataCard className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Choose a starting plan</h3>
          <p className="text-xs text-muted-foreground">
            One choice fills the knobs below. Nothing is applied to the host until you reach Review → Apply.
          </p>
        </div>

        <div role="radiogroup" aria-label="Plan presets" className="grid gap-2 sm:grid-cols-2">
          {PLAN_PRESETS.map((preset) => {
            const selected = pickedPreset === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => applyPreset(preset.id)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background/40 hover:bg-muted/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{preset.label}</p>
                  {selected ? (
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" aria-hidden />
                    </span>
                  ) : (
                    <span
                      className="mt-0.5 inline-flex h-5 w-5 shrink-0 rounded-full border border-border"
                      aria-hidden
                    />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
                <p className="mt-2 text-[11px] leading-snug text-foreground/80">{preset.effect}</p>
              </button>
            )
          })}
        </div>

        {picked ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={`Applied · ${picked.label}`} tone="success" />
            <p className="text-xs text-muted-foreground">Scroll to the estimate, then continue to Review when ready.</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Not sure? Start with <span className="font-medium text-foreground">Shared desktop</span> on a laptop, or{' '}
            <span className="font-medium text-foreground">Dedicated host</span> on a Speculum-only box.
          </p>
        )}
      </DataCard>

      <DataCard className="space-y-6 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Plan parameters</h3>
          <p className="text-xs text-muted-foreground">
            Answer the three questions in order. Numbers here are GiB and percent; Speculum converts them to bytes when
            you review.
          </p>
        </div>

        {estimate && breakdown && hostMemoryTotalBytes != null ? (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">What this plan does</p>
              <p className="text-sm text-muted-foreground">
                {describePlanRecipe(estimate, hostMemoryTotalBytes)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label={`Budget · ${formatGibLabel(estimate.budgetBytes)}`} tone="info" />
              <StatusPill label={`Host keeps · ${formatGibLabel(estimate.reserveBytes)}`} tone="neutral" />
              <StatusPill
                label={`Browsers get · ${formatGibLabel(estimate.shmTargetBytes)}`}
                tone="success"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniMetric label="Planning budget" value={formatGibLabel(estimate.budgetBytes)} />
              <MiniMetric label="Kept for the OS" value={formatGibLabel(estimate.reserveBytes)} />
              <MiniMetric label="Shared memory target" value={formatGibLabel(estimate.shmTargetBytes)} />
            </div>
            <ResourceGauge
              label="How the budget splits"
              usedLabel={`${formatGibLabel(estimate.reserveBytes)} OS · ${formatGibLabel(estimate.shmTargetBytes)} browsers`}
              percent={breakdown.shmPct + breakdown.reservePct}
            />
            <p className="text-xs text-muted-foreground">
              Review still asks the server for the authoritative numbers before anything is applied.
            </p>
          </div>
        ) : (
          <HelperCallout tone="warning" title="Waiting on host memory">
            Speculum has not loaded the host RAM total yet. You can still choose presets and answers; Review will compute
            the final plan on the server.
          </HelperCallout>
        )}

        <ol className="space-y-6">
          <PlanStep
            step={1}
            title="How much RAM may Speculum use?"
            body={
              hostMemoryTotalBytes != null
                ? `This is the planning budget — not a hard lock of the whole machine. Host total today: ${formatGibLabel(hostMemoryTotalBytes)}.`
                : 'This is the planning budget — not a hard lock of the whole machine.'
            }
          >
            <ChipRow
              leading={
                <Button
                  type="button"
                  size="sm"
                  variant={params.maxRamBytes == null ? 'default' : 'outline'}
                  onClick={() => patch({ maxRamBytes: null })}
                >
                  Whole host
                </Button>
              }
              values={ramChips}
              current={matchedRam ?? -1}
              suffix=" GiB"
              onSelect={(value) => patch({ maxRamBytes: value * (1024 ** 3) })}
            />
            <CustomValue
              id="maxRamBytes"
              label="Custom budget cap (GiB)"
              helper="Leave empty to plan against the full host total. Use a lower cap on a shared developer machine."
              value={maxRamGib}
              step="0.25"
              placeholder="Whole host"
              forceOpen={params.maxRamBytes != null && matchedRam == null}
              onChange={(raw) =>
                patch({ maxRamBytes: raw.trim() === '' ? null : gibInputToBytes(raw) })
              }
            />
          </PlanStep>

          <PlanStep
            step={2}
            title="How much should stay free for the OS?"
            body="Reserve is taken from the budget first so Windows, macOS, Linux, and other apps keep room to breathe."
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Reserve as a percent of the budget</p>
                <ChipRow
                  values={RESERVE_PERCENT_CHIPS}
                  current={reservePercent}
                  suffix="%"
                  onSelect={(value) => patch({ reservePercent: value })}
                />
                <CustomValue
                  id="reservePercent"
                  label="Custom reserve (%)"
                  helper="Typical lab hosts use 15–25%. Allowed range is 0–90."
                  value={String(reservePercent)}
                  suffix="%"
                  forceOpen={isCustomChipValue(reservePercent, RESERVE_PERCENT_CHIPS)}
                  onChange={(raw) => patch({ reservePercent: Math.max(0, Number(raw) || 0) })}
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Never reserve less than</p>
                <ChipRow
                  values={RESERVE_MIN_GIB_CHIPS}
                  current={reserveMinGib}
                  suffix=" GiB"
                  onSelect={(value) => patch({ reserveMinBytes: value * (1024 ** 3) })}
                />
                <CustomValue
                  id="reserveMinBytes"
                  label="Custom minimum reserve (GiB)"
                  helper="A floor in GiB wins over the percent when the percent would leave too little for the OS."
                  value={bytesToGibInput(params.reserveMinBytes)}
                  step="0.25"
                  forceOpen={isCustomChipValue(reserveMinGib, RESERVE_MIN_GIB_CHIPS)}
                  onChange={(raw) => patch({ reserveMinBytes: gibInputToBytes(raw) })}
                />
              </div>
            </div>
          </PlanStep>

          <PlanStep
            step={3}
            title="How much shared memory should browsers get?"
            body="Browser sessions need shared memory (the host path /dev/shm). Set a comfortable minimum, then a ceiling so Speculum cannot claim the whole budget."
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Minimum shared memory</p>
                <ChipRow
                  values={SHM_MIN_GIB_CHIPS}
                  current={shmMinGib}
                  suffix=" GiB"
                  onSelect={(value) => patch({ shmMinBytes: value * (1024 ** 3) })}
                />
                <CustomValue
                  id="shmMinBytes"
                  label="Custom minimum (GiB)"
                  helper="If the budget after reserve cannot meet this floor, Review will block until you raise the budget or lower the reserve."
                  value={bytesToGibInput(params.shmMinBytes)}
                  step="0.25"
                  forceOpen={isCustomChipValue(shmMinGib, SHM_MIN_GIB_CHIPS)}
                  onChange={(raw) => patch({ shmMinBytes: gibInputToBytes(raw) })}
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Ceiling as % of the budget</p>
                <ChipRow
                  values={SHM_PERCENT_CHIPS}
                  current={shmCapPercent}
                  suffix="%"
                  onSelect={(value) => patch({ shmMaxPercentOfBudget: value })}
                />
                <CustomValue
                  id="shmMaxPercentOfBudget"
                  label="Custom ceiling (%)"
                  helper="Shared memory is clamped between the minimum and this percent of the planning budget."
                  value={String(shmCapPercent)}
                  suffix="%"
                  forceOpen={isCustomChipValue(shmCapPercent, SHM_PERCENT_CHIPS)}
                  onChange={(raw) =>
                    patch({ shmMaxPercentOfBudget: Math.max(0, Number(raw) || 0) })
                  }
                />
              </div>
            </div>
          </PlanStep>
        </ol>

        <RevealPanel title="Process limits — usually leave on" defaultOpen={false}>
          <div className="space-y-4 pb-1 pt-3">
            <HelperCallout title="Safe for session-heavy hosts">
              Raising open-file and process limits helps when many browser sessions run together. Keep the defaults
              unless this host already enforces a stricter policy.
            </HelperCallout>
            <SwitchField
              id="raiseUlimits"
              label="Raise process limits when applying"
              helper="Applies soft nofile and nproc targets with the memory plan."
              checked={params.raiseUlimits ?? true}
              onCheckedChange={(checked) => patch({ raiseUlimits: checked })}
            />
            {params.raiseUlimits ?? true ? (
              <FieldGrid>
                <AlwaysField
                  id="nofile"
                  label="Open-file limit (nofile)"
                  helper="Soft limit target. Must be ≥ 1024."
                  value={String(params.nofile ?? DEFAULT_PARAMS.nofile)}
                  onChange={(raw) => patch({ nofile: Math.max(0, Math.floor(Number(raw) || 0)) })}
                />
                <AlwaysField
                  id="nproc"
                  label="Process limit (nproc)"
                  helper="Soft limit target. Must be ≥ 256."
                  value={String(params.nproc ?? DEFAULT_PARAMS.nproc)}
                  onChange={(raw) => patch({ nproc: Math.max(0, Math.floor(Number(raw) || 0)) })}
                />
              </FieldGrid>
            ) : null}
          </div>
        </RevealPanel>

        <InlineValidation message={validation ?? undefined} />

        {validation ? (
          <HelperCallout tone="warning" title="This plan does not fit the host yet">
            <p>{validation}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  patch({
                    reservePercent: 10,
                    reserveMinBytes: 1 * (1024 ** 3),
                    shmMinBytes: 1 * (1024 ** 3),
                    shmMaxPercentOfBudget: 75,
                  })
                }
              >
                Use a small-host split
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('shared-desktop')}>
                Apply Shared desktop
              </Button>
            </div>
          </HelperCallout>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Next: Review shows the server’s authoritative split. Nothing changes on the host until you apply there.
          </p>
          <Button onClick={onPreview} disabled={pending || Boolean(validation)}>
            {pending ? (
              'Preparing preview…'
            ) : (
              <>
                Review plan
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </DataCard>
    </div>
  )
}

function PlanStep({
  step,
  title,
  body,
  children,
}: {
  step: number
  title: string
  body: string
  children: ReactNode
}) {
  return (
    <li className="space-y-3 border-t border-border/70 pt-5 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-primary">Step {step} of 3</p>
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      {children}
    </li>
  )
}

function ChipRow({
  values,
  current,
  suffix,
  onSelect,
  leading,
}: {
  values: readonly number[]
  current: number
  suffix: string
  onSelect: (value: number) => void
  leading?: ReactNode
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {leading}
      {values.map((value) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={current === value ? 'default' : 'outline'}
          onClick={() => onSelect(value)}
        >
          {value}
          {suffix}
        </Button>
      ))}
    </div>
  )
}

function CustomValue({
  id,
  label,
  helper,
  value,
  onChange,
  step,
  suffix,
  placeholder,
  forceOpen,
}: {
  id: string
  label: string
  helper: string
  value: string
  onChange: (value: string) => void
  step?: string
  suffix?: string
  placeholder?: string
  forceOpen?: boolean
}) {
  const [open, setOpen] = useState(Boolean(forceOpen))
  const show = open || Boolean(forceOpen)

  return (
    <div className="space-y-2">
      {!show ? (
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen(true)}>
          Enter a custom value…
        </Button>
      ) : (
        <AlwaysField
          id={id}
          label={label}
          helper={helper}
          value={value}
          onChange={onChange}
          step={step}
          suffix={suffix}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}

function AlwaysField({
  id,
  label,
  helper,
  value,
  onChange,
  step,
  suffix,
  placeholder,
}: {
  id: string
  label: string
  helper: string
  value: string
  onChange: (value: string) => void
  step?: string
  suffix?: string
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min="0"
          step={step ?? '1'}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{helper}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/60 px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  )
}
