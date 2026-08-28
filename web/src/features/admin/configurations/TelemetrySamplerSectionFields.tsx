import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FieldGrid, HelperCallout, SwitchField } from '@/features/admin/components'
import {
  TELEMETRY_SECTIONS,
  asObject,
  describeSectionDetail,
  sectionEnabled,
  setAllSections,
  type JsonObject,
  type TelemetrySectionKey,
} from './telemetryHelpers'
import { ConfigField } from './configFieldPrimitives'

function SectionFieldBody({
  sectionKey,
  child,
  patchSection,
}: {
  sectionKey: TelemetrySectionKey
  child: JsonObject
  patchSection: (key: TelemetrySectionKey, patch: JsonObject) => void
}) {
  if (sectionKey === 'host') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Include
          </p>
          <SwitchField
            id="host-load"
            label="Load average"
            checked={child.includeLoadAverage !== false}
            onCheckedChange={(checked) => patchSection('host', { includeLoadAverage: checked })}
          />
          <SwitchField
            id="host-swap"
            label="Swap"
            checked={child.includeSwap !== false}
            onCheckedChange={(checked) => patchSection('host', { includeSwap: checked })}
          />
          <SwitchField
            id="host-disk-io"
            label="Disk I/O"
            checked={Boolean(child.includeDiskIo)}
            onCheckedChange={(checked) => patchSection('host', { includeDiskIo: checked })}
          />
          <SwitchField
            id="host-network"
            label="Network"
            checked={Boolean(child.includeNetwork)}
            onCheckedChange={(checked) => patchSection('host', { includeNetwork: checked })}
          />
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Paths & cache
          </p>
          <FieldGrid>
            <ConfigField
              id="host-proc-path"
              label="Proc path"
              helper="Usually /proc, or /host/proc in Docker."
              value={typeof child.procPath === 'string' ? child.procPath : '/proc'}
              onChange={(v) => patchSection('host', { procPath: v })}
            />
            <ConfigField
              id="host-disk-path"
              label="Disk path (optional)"
              helper="Leave empty to use the content root."
              value={typeof child.diskPath === 'string' ? child.diskPath : ''}
              onChange={(v) => patchSection('host', { diskPath: v || null })}
            />
            <ConfigField
              id="host-sample-interval"
              label="Collector cache (ms)"
              type="number"
              min={100}
              max={60_000}
              value={String(typeof child.sampleIntervalMs === 'number' ? child.sampleIntervalMs : 1000)}
              onChange={(v) => patchSection('host', { sampleIntervalMs: Number(v) || 1000 })}
            />
          </FieldGrid>
        </div>
      </div>
    )
  }

  if (sectionKey === 'apiProcess') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Include
          </p>
          <SwitchField
            id="api-memory"
            label="Private memory"
            checked={child.includePrivateMemory !== false}
            onCheckedChange={(checked) => patchSection('apiProcess', { includePrivateMemory: checked })}
          />
          <SwitchField
            id="api-gc"
            label="Garbage collection"
            checked={child.includeGarbageCollection !== false}
            onCheckedChange={(checked) =>
              patchSection('apiProcess', { includeGarbageCollection: checked })
            }
          />
          <SwitchField
            id="api-thread-pool"
            label="Thread pool"
            checked={child.includeThreadPool !== false}
            onCheckedChange={(checked) => patchSection('apiProcess', { includeThreadPool: checked })}
          />
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <ConfigField
            id="api-sample-interval"
            label="Collector cache (ms)"
            type="number"
            min={100}
            max={60_000}
            value={String(typeof child.sampleIntervalMs === 'number' ? child.sampleIntervalMs : 1000)}
            onChange={(v) => patchSection('apiProcess', { sampleIntervalMs: Number(v) || 1000 })}
          />
        </div>
      </div>
    )
  }

  if (sectionKey === 'sessions') {
    return (
      <div className="space-y-3">
        <HelperCallout title="Identity is optional">
          Ids and URL hosts make charts clearer but more sensitive. Prefer aggregate-only on shared
          hosts.
        </HelperCallout>
        <SwitchField
          id="sessions-ids"
          label="Session ids"
          checked={Boolean(child.includeSessionIds)}
          onCheckedChange={(checked) => patchSection('sessions', { includeSessionIds: checked })}
        />
        <SwitchField
          id="sessions-url-host"
          label="URL host"
          checked={Boolean(child.includeUrlHost)}
          onCheckedChange={(checked) => patchSection('sessions', { includeUrlHost: checked })}
        />
        <SwitchField
          id="sessions-per-session"
          label="Per-session rows"
          helper="Heavier — useful while debugging one session."
          checked={Boolean(child.includePerSession)}
          onCheckedChange={(checked) => patchSection('sessions', { includePerSession: checked })}
        />
      </div>
    )
  }

  if (sectionKey === 'sidecar') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Include
          </p>
          {(
            [
              ['sidecar-process', 'Process', 'includeProcess', true],
              ['sidecar-event-loop', 'Event loop', 'includeEventLoop', true],
              ['sidecar-chrome', 'Chrome', 'includeChrome', true],
              ['sidecar-queues', 'Queues', 'includeQueues', true],
              ['sidecar-sessions-summary', 'Sessions summary', 'includeSessionsSummary', true],
              ['sidecar-faulted', 'Faulted ids', 'includeFaultedIds', true],
              ['sidecar-alloc-summary', 'Allocations summary', 'includeAllocationsSummary', true],
            ] as const
          ).map(([id, label, key, defaultOn]) => (
            <SwitchField
              key={id}
              id={id}
              label={label}
              checked={defaultOn ? child[key] !== false : Boolean(child[key])}
              onCheckedChange={(checked) => patchSection('sidecar', { [key]: checked })}
            />
          ))}
          <SwitchField
            id="sidecar-alloc-sessions"
            label="Allocation sessions"
            helper="Heavier — off in Lean / Operable."
            checked={Boolean(child.includeAllocationSessions)}
            onCheckedChange={(checked) =>
              patchSection('sidecar', { includeAllocationSessions: checked })
            }
          />
        </div>
        <div className="border-t border-border pt-4">
          <ConfigField
            id="sidecar-timeout"
            label="Collect timeout (ms)"
            type="number"
            min={100}
            value={String(typeof child.timeoutMs === 'number' ? child.timeoutMs : 2000)}
            onChange={(v) => patchSection('sidecar', { timeoutMs: Number(v) || 2000 })}
          />
        </div>
      </div>
    )
  }

  if (sectionKey === 'profiles') {
    return (
      <SwitchField
        id="profiles-storage"
        label="Storage bytes"
        checked={child.includeStorageBytes !== false}
        onCheckedChange={(checked) => patchSection('profiles', { includeStorageBytes: checked })}
      />
    )
  }

  if (sectionKey === 'journal') {
    return (
      <SwitchField
        id="journal-pressure"
        label="Drain pressure"
        checked={child.includePressure !== false}
        onCheckedChange={(checked) => patchSection('journal', { includePressure: checked })}
      />
    )
  }

  if (sectionKey === 'docker') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Include
          </p>
          <SwitchField
            id="docker-runtime"
            label="Runtime"
            checked={child.includeRuntime !== false}
            onCheckedChange={(checked) => patchSection('docker', { includeRuntime: checked })}
          />
          <SwitchField
            id="docker-containers"
            label="Containers"
            checked={child.includeContainers !== false}
            onCheckedChange={(checked) => patchSection('docker', { includeContainers: checked })}
          />
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <FieldGrid>
            <ConfigField
              id="docker-endpoint"
              label="Docker endpoint"
              helper="Engine API socket or URL."
              value={
                typeof child.endpoint === 'string' ? child.endpoint : 'unix:///var/run/docker.sock'
              }
              onChange={(v) => patchSection('docker', { endpoint: v })}
            />
            <ConfigField
              id="docker-timeout"
              label="HTTP timeout (ms)"
              type="number"
              min={100}
              value={String(typeof child.timeoutMs === 'number' ? child.timeoutMs : 2000)}
              onChange={(v) => patchSection('docker', { timeoutMs: Number(v) || 2000 })}
            />
          </FieldGrid>
        </div>
      </div>
    )
  }

  return null as ReactNode
}

export function TelemetrySamplerSectionFields({
  value,
  samplerOn,
  patchSection,
  onReplaceSections,
}: {
  value: JsonObject
  samplerOn: boolean
  patchSection: (key: TelemetrySectionKey, patch: JsonObject) => void
  onReplaceSections: (next: JsonObject) => void
}) {
  const [openKey, setOpenKey] = useState<TelemetrySectionKey | null>(null)
  const openMeta = TELEMETRY_SECTIONS.find((section) => section.key === openKey) ?? null
  const openChild = openKey ? asObject(value[openKey]) : {}

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {TELEMETRY_SECTIONS.filter((section) => sectionEnabled(value, section.key)).length}
          </span>
          {' of '}
          {TELEMETRY_SECTIONS.length} sections
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!samplerOn}
            onClick={() => onReplaceSections(setAllSections(value, true))}
          >
            All on
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!samplerOn}
            onClick={() => onReplaceSections(setAllSections(value, false))}
          >
            Clear
          </Button>
        </div>
      </div>

      <ul
        className={cn(
          'overflow-hidden rounded-xl border border-border divide-y divide-border',
          !samplerOn && 'pointer-events-none opacity-55',
        )}
      >
        {TELEMETRY_SECTIONS.map((section) => {
          const enabled = sectionEnabled(value, section.key)
          const detail = enabled
            ? describeSectionDetail(value, section.key)
            : 'Not included'
          return (
            <li key={section.key} className="flex items-stretch gap-0">
              <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 sm:px-4">
                <Switch
                  id={`telemetry-section-${section.key}`}
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    patchSection(section.key, { isEnabled: checked })
                  }
                  aria-label={enabled ? `Disable ${section.label}` : `Enable ${section.label}`}
                />
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={`telemetry-section-${section.key}`}
                    className="block text-sm font-medium text-foreground"
                  >
                    {section.label}
                  </label>
                  <p className="truncate text-xs text-muted-foreground">{detail}</p>
                </div>
              </div>
              <button
                type="button"
                className={cn(
                  'flex shrink-0 items-center gap-1 border-l border-border px-3 text-xs font-medium',
                  'text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  !enabled && 'opacity-40',
                )}
                disabled={!enabled}
                onClick={() => setOpenKey(section.key)}
              >
                Tune
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      <Sheet open={openKey != null} onOpenChange={(open) => !open && setOpenKey(null)}>
        <SheetContent className="overflow-y-auto [scrollbar-width:thin]">
          {openMeta ? (
            <>
              <SheetHeader>
                <SheetTitle>{openMeta.label}</SheetTitle>
                <SheetDescription>{openMeta.helper}</SheetDescription>
              </SheetHeader>
              <div className="mt-2">
                <SectionFieldBody
                  sectionKey={openMeta.key}
                  child={openChild}
                  patchSection={patchSection}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
