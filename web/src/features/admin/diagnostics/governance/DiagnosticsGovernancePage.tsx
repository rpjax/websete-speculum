import { useRef, useState } from 'react'
import { BookOpen, FileJson, RotateCcw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ExportButton } from '@/components/admin/ExportButton'
import { ConfigChangePreview } from './ConfigChangePreview'
import { ElevateSheet } from './ElevateSheet'
import { GovernanceBudgetsTab } from './GovernanceBudgetsTab'
import { GovernanceCatalogAuditTab } from './GovernanceCatalogAuditTab'
import { GovernanceCommandBar } from './GovernanceCommandBar'
import { GovernanceControlTab } from './GovernanceControlTab'
import { GovernanceCoverageTab } from './GovernanceCoverageTab'
import { GovernanceTelemetryTab } from './GovernanceTelemetryTab'
import { useDiagnosticsGovernance } from './useDiagnosticsGovernance'

export default function DiagnosticsGovernancePage() {
  const g = useDiagnosticsGovernance()
  const [elevateOpen, setElevateOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (g.loading && !g.overview) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    )
  }

  const overlays = {
    degraded: Boolean(g.overview?.degraded),
    elevateActive: Boolean(g.overview?.elevate?.active),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm leading-relaxed text-primary/90">
          <p>
            <strong>Governance</strong> is the control plane for what diagnostics may observe, record,
            and probe. Pick a <strong>profile</strong>, tune capability coverage, then Save — apply is
            confirmed via <code className="rounded bg-primary/10 px-1">Diagnostics.ConfigApplied</code>.
            Elevate and Recover are runtime overlays and do not rewrite saved config.
          </p>
        </div>
      </div>

      {g.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {g.error}
        </div>
      )}
      {g.message && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {g.message}
        </div>
      )}

      <GovernanceCommandBar
        overview={g.overview}
        profile={g.config.profile}
        dirtyCount={g.changes.length}
        saving={g.saving}
        recovering={g.recovering}
        onProfileChange={g.applyProfile}
        onRefresh={() => void g.refresh()}
        onSave={() => void g.save()}
        onDiscard={g.discard}
        onElevateOpen={() => setElevateOpen(true)}
        onRecover={() => void g.recover()}
        onClearElevate={() => void g.clearElevate()}
      />

      <ElevateSheet
        open={elevateOpen}
        onOpenChange={setElevateOpen}
        maxMinutes={g.config.elevate.browserQueryMaxMinutes}
        elevating={g.elevating}
        onConfirm={g.elevate}
      />

      <Tabs defaultValue="control">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="control">Control</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="catalog">Catalog & Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="control">
          <GovernanceControlTab
            overview={g.overview}
            config={g.config}
            onChange={g.setConfig}
          />
        </TabsContent>
        <TabsContent value="coverage">
          <GovernanceCoverageTab
            config={g.config}
            onChange={g.setConfig}
            effective={g.overview?.effectiveCapabilities}
            overlays={overlays}
          />
        </TabsContent>
        <TabsContent value="telemetry">
          <GovernanceTelemetryTab config={g.config} onChange={g.setConfig} />
        </TabsContent>
        <TabsContent value="budgets">
          <GovernanceBudgetsTab
            config={g.config}
            onChange={g.setConfig}
            bytesUsed={g.overview?.bytesUsed}
          />
        </TabsContent>
        <TabsContent value="catalog">
          <GovernanceCatalogAuditTab
            config={g.config}
            overviewEffective={g.overview?.effectiveCapabilities}
            overlays={overlays}
          />
        </TabsContent>
      </Tabs>

      <ConfigChangePreview changes={g.changes} />

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3">
          <FileJson className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Import / Export / Reset</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3 p-5">
          <ExportButton data={g.config} filename="diagnostics-config" formats={['json']} />
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = (ev) => {
                g.importConfig(String(ev.target?.result ?? ''))
              }
              reader.readAsText(file)
              e.target.value = ''
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3 w-3" /> Import JSON
          </Button>
          {g.importError && <span className="text-xs text-destructive">{g.importError}</span>}

          <Dialog open={resetOpen} onOpenChange={setResetOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto h-8 gap-1.5 text-xs">
                <RotateCcw className="h-3 w-3" /> Reset to server seed
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reset diagnostics configuration?</DialogTitle>
                <DialogDescription className="leading-relaxed">
                  This re-seeds Diagnostics from the server profile environment (or Production defaults
                  if reseed is unavailable). Active sessions pick up the new settings immediately. Cannot
                  be undone without re-importing a backup.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setResetOpen(false)
                    void g.resetToServerSeed()
                  }}
                >
                  Reset to server seed
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}
