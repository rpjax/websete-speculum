import { useCallback, useEffect, useState } from 'react'
import { Cpu, HardDrive, RefreshCw } from 'lucide-react'
import {
  api,
  type HostResourceApplyResult,
  type HostResourceProvisionParams,
  type HostResourceProvisionPlan,
  type HostResourceStatus,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { PageHeader } from '@/components/admin/PageHeader'
import { ConfirmDestructive } from '@/components/admin/ConfirmDestructive'

const GiB = 1024 ** 3

function formatGiB(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  return `${(bytes / GiB).toFixed(2)} GiB`
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

const DEFAULTS = {
  reservePercent: 15,
  reserveMinGiB: 2,
  shmMinGiB: 2,
  shmMaxPercentOfBudget: 75,
  raiseUlimits: true,
  nofile: 1_048_576,
  nproc: 65_535,
}

export default function HostResourcesPage() {
  const [status, setStatus] = useState<HostResourceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<HostResourceProvisionPlan | null>(null)
  const [lastResult, setLastResult] = useState<HostResourceApplyResult | null>(null)

  const [maxRamGiB, setMaxRamGiB] = useState('')
  const [reservePercent, setReservePercent] = useState(DEFAULTS.reservePercent)
  const [reserveMinGiB, setReserveMinGiB] = useState(DEFAULTS.reserveMinGiB)
  const [shmMinGiB, setShmMinGiB] = useState(DEFAULTS.shmMinGiB)
  const [shmMaxPercent, setShmMaxPercent] = useState(DEFAULTS.shmMaxPercentOfBudget)
  const [raiseUlimits, setRaiseUlimits] = useState(DEFAULTS.raiseUlimits)
  const [nofile, setNofile] = useState(DEFAULTS.nofile)
  const [nproc, setNproc] = useState(DEFAULTS.nproc)

  const buildParams = useCallback((): HostResourceProvisionParams => {
    const trimmed = maxRamGiB.trim()
    const maxRamBytes =
      trimmed === '' ? null : Math.round(Number(trimmed) * GiB)
    return {
      maxRamBytes: maxRamBytes != null && Number.isFinite(maxRamBytes) ? maxRamBytes : null,
      reservePercent,
      reserveMinBytes: Math.round(reserveMinGiB * GiB),
      shmMinBytes: Math.round(shmMinGiB * GiB),
      shmMaxPercentOfBudget: shmMaxPercent,
      raiseUlimits,
      nofile,
      nproc,
    }
  }, [
    maxRamGiB,
    reservePercent,
    reserveMinGiB,
    shmMinGiB,
    shmMaxPercent,
    raiseUlimits,
    nofile,
    nproc,
  ])

  const applyParamsToForm = useCallback((params: HostResourceProvisionParams) => {
    setMaxRamGiB(
      params.maxRamBytes != null && params.maxRamBytes > 0
        ? String(Number((params.maxRamBytes / GiB).toFixed(2)))
        : '',
    )
    setReservePercent(params.reservePercent ?? DEFAULTS.reservePercent)
    setReserveMinGiB(
      params.reserveMinBytes != null
        ? Number((params.reserveMinBytes / GiB).toFixed(2))
        : DEFAULTS.reserveMinGiB,
    )
    setShmMinGiB(
      params.shmMinBytes != null
        ? Number((params.shmMinBytes / GiB).toFixed(2))
        : DEFAULTS.shmMinGiB,
    )
    setShmMaxPercent(params.shmMaxPercentOfBudget ?? DEFAULTS.shmMaxPercentOfBudget)
    setRaiseUlimits(params.raiseUlimits ?? DEFAULTS.raiseUlimits)
    setNofile(params.nofile ?? DEFAULTS.nofile)
    setNproc(params.nproc ?? DEFAULTS.nproc)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await api.getHostResources()
      setStatus(next)
      if (next.lastApply?.params) {
        applyParamsToForm(next.lastApply.params)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load host resources')
    } finally {
      setLoading(false)
    }
  }, [applyParamsToForm])

  useEffect(() => {
    void load()
  }, [load])

  const hostSummary = status?.host
    ? {
        ram: formatGiB(status.host.memoryTotalBytes),
        available: formatGiB(status.host.memoryAvailableBytes),
        cpu: status.host.cpuCount,
        source: status.host.source,
      }
    : null

  async function runPreview() {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const plan = await api.previewHostResources(buildParams())
      setPreview(plan)
      setMessage(`Preview: will target ${formatGiB(plan.shmTargetBytes)} of /dev/shm`)
    } catch (e: unknown) {
      setPreview(null)
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPending(false)
    }
  }

  async function runApply() {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api.applyHostResources(buildParams())
      setLastResult(result)
      setPreview(result.plan)
      setMessage(
        `Applied ${formatGiB(result.shmAppliedBytes)} shm`
        + (result.warnings.length ? ` (${result.warnings.length} warning(s))` : ''),
      )
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Host resources"
        description="Manually size sidecar /dev/shm (and optional ulimits) from detected host RAM. Use a RAM ceiling on shared developer machines so Speculum does not claim the whole box."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || pending}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Detected host</CardTitle>
          <CardDescription>
            Probe uses the API host procfs mount (for example /host/proc). Docker Desktop reflects the Linux VM, not the Windows host.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && !status ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <>
              {status?.hostError && (
                <p className="text-sm text-destructive">{status.hostError}</p>
              )}
              {hostSummary ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-start gap-2 rounded-md border p-3">
                    <HardDrive className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{hostSummary.ram} total</p>
                      <p className="text-xs text-muted-foreground">
                        {hostSummary.available} available · source {hostSummary.source}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border p-3">
                    <Cpu className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{hostSummary.cpu} CPUs</p>
                      <p className="text-xs text-muted-foreground">
                        Sidecar shm now:{' '}
                        {formatGiB(status?.sidecar?.shmSizeBytes ?? undefined)}
                        {status?.sidecar?.error ? ` · ${status.sidecar.error}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Host probe not available.</p>
              )}
              {status?.lastApply && (
                <p className="text-xs text-muted-foreground">
                  Last apply {formatWhen(status.lastApply.appliedAtUtc)} →{' '}
                  {formatGiB(status.lastApply.shmAppliedBytes)} shm. Restarting the sidecar
                  resets shm to the Docker floor until you Apply again.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provision parameters</CardTitle>
          <CardDescription>
            Leave RAM ceiling empty to use the full detected host. On a local PC, set a ceiling
            (for example 8 GiB) so Cursor and Visual Studio keep headroom.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="max-ram">Max RAM for Speculum (GiB, optional)</Label>
            <Input
              id="max-ram"
              type="number"
              min={0}
              step={0.5}
              placeholder="Use full host"
              value={maxRamGiB}
              onChange={(e) => setMaxRamGiB(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reserve-pct">Reserve %</Label>
              <Input
                id="reserve-pct"
                type="number"
                min={0}
                max={90}
                value={reservePercent}
                onChange={(e) => setReservePercent(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shm-cap">Shm max % of budget</Label>
              <Input
                id="shm-cap"
                type="number"
                min={1}
                max={100}
                value={shmMaxPercent}
                onChange={(e) => setShmMaxPercent(Number(e.target.value))}
              />
            </div>
          </div>

          <Accordion type="single" collapsible>
            <AccordionItem value="advanced">
              <AccordionTrigger>Advanced floors and ulimits</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="reserve-min">Reserve min (GiB)</Label>
                    <Input
                      id="reserve-min"
                      type="number"
                      min={0}
                      step={0.5}
                      value={reserveMinGiB}
                      onChange={(e) => setReserveMinGiB(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shm-min">Shm min (GiB)</Label>
                    <Input
                      id="shm-min"
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={shmMinGiB}
                      onChange={(e) => setShmMinGiB(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Raise sidecar ulimits</p>
                    <p className="text-xs text-muted-foreground">nofile / nproc via prlimit</p>
                  </div>
                  <Switch checked={raiseUlimits} onCheckedChange={setRaiseUlimits} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="nofile">nofile</Label>
                    <Input
                      id="nofile"
                      type="number"
                      min={1024}
                      value={nofile}
                      disabled={!raiseUlimits}
                      onChange={(e) => setNofile(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nproc">nproc</Label>
                    <Input
                      id="nproc"
                      type="number"
                      min={256}
                      value={nproc}
                      disabled={!raiseUlimits}
                      onChange={(e) => setNproc(Number(e.target.value))}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <Separator />

          {(preview || lastResult) && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p className="font-medium">Plan</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>Budget: {formatGiB(preview?.budgetBytes ?? lastResult?.plan.budgetBytes)}</li>
                <li>Reserve: {formatGiB(preview?.reserveBytes ?? lastResult?.plan.reserveBytes)}</li>
                <li>
                  Shm target:{' '}
                  {formatGiB(preview?.shmTargetBytes ?? lastResult?.plan.shmTargetBytes)}
                </li>
                {lastResult && (
                  <li>
                    Last applied: {formatGiB(lastResult.shmBeforeBytes)} →{' '}
                    {formatGiB(lastResult.shmAppliedBytes)}
                  </li>
                )}
              </ul>
              {lastResult && lastResult.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-400">
                  {lastResult.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && !error && <p className="text-sm text-muted-foreground">{message}</p>}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending || loading} onClick={() => void runPreview()}>
              Preview
            </Button>
            <ConfirmDestructive
              trigger={
                <Button disabled={pending || loading}>Apply</Button>
              }
              title="Apply host resource plan?"
              description="This remounts /dev/shm inside the sidecar (and may raise ulimits). A sidecar restart resets shm until you Apply again."
              confirmLabel="Apply"
              onConfirm={() => void runApply()}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
