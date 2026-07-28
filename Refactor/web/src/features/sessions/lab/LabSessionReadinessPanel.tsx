import { CheckCircle2, Circle, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { LAB_CONFIG_SECTION_LABELS } from './labEngineConfig'
import type { LabResourceManagementConfig, LabSessionsConfig } from './labEngineConfig'

interface LabSessionReadinessPanelProps {
  operational: boolean
  missing: string[]
  busy: boolean
  sessionLive: boolean
  defaultTargetHost: string
  allowAny: boolean
  allowlistText: string
  hostingText: string
  certificateEmail: string
  sessions: LabSessionsConfig
  resourceManagement: LabResourceManagementConfig
  onDefaultTargetHostChange: (value: string) => void
  onAllowAnyChange: (value: boolean) => void
  onAllowlistTextChange: (value: string) => void
  onHostingTextChange: (value: string) => void
  onCertificateEmailChange: (value: string) => void
  onSessionsChange: (next: LabSessionsConfig) => void
  onResourceManagementChange: (next: LabResourceManagementConfig) => void
  onApplyLabDefaults: () => void
}

function sectionLabel(key: string): string {
  return LAB_CONFIG_SECTION_LABELS[key] ?? key
}

/**
 * Navigation / capacity / hosting — what StartSession needs before browsing.
 */
export function LabSessionReadinessPanel({
  operational,
  missing,
  busy,
  sessionLive,
  defaultTargetHost,
  allowAny,
  allowlistText,
  hostingText,
  certificateEmail,
  sessions,
  resourceManagement,
  onDefaultTargetHostChange,
  onAllowAnyChange,
  onAllowlistTextChange,
  onHostingTextChange,
  onCertificateEmailChange,
  onSessionsChange,
  onResourceManagementChange,
  onApplyLabDefaults,
}: LabSessionReadinessPanelProps) {
  const defaultViewport = sessions.viewportPolicy.default

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-muted-foreground">
        Navigation allowlist, capacity / viewport, and optional hosting — what Start needs.
      </p>

      {!operational && (
        <div className="space-y-3 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="text-xs font-medium text-warning">Still needed before Start</p>
          <ul className="space-y-1.5">
            {(['Navigation', 'Sessions', 'ResourceManagement'] as const).map((key) => {
              const done = !missing.includes(key)
              return (
                <li key={key} className="flex items-start gap-2 text-xs">
                  {done ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  )}
                  <span className={done ? 'text-muted-foreground' : 'text-foreground'}>
                    {sectionLabel(key)}
                  </span>
                </li>
              )
            })}
          </ul>
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={onApplyLabDefaults}
          >
            <Rocket className="h-3.5 w-3.5" />
            Apply lab defaults &amp; save
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Sets browse-anywhere on your default host (or www.google.com), session capacity, and
            1280×720 viewport. Telemetry Events stay off.
          </p>
        </div>
      )}

      {sessionLive && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          A session is already live. Allowlist changes affect URL resolve immediately; the browser
          main-frame guard updates only after you stop and start again.
        </p>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Where sessions may browse</h3>
          <p className="text-[11px] text-muted-foreground">
            Default site when a session starts, plus which hosts the remote browser may open as the
            main page.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="lab-default-host">Default target host</Label>
          <Input
            id="lab-default-host"
            className="font-mono text-xs"
            value={defaultTargetHost}
            spellCheck={false}
            placeholder="www.google.com"
            onChange={(event) => onDefaultTargetHostChange(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Hostname only — no <code>https://</code> or path.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="lab-allow-any">Allow any website</Label>
            <p className="text-[11px] text-muted-foreground">
              Open lab mode — any main-frame host is allowed. Turn off to restrict.
            </p>
          </div>
          <Switch id="lab-allow-any" checked={allowAny} onCheckedChange={onAllowAnyChange} />
        </div>

        {!allowAny && (
          <div className="space-y-2">
            <Label htmlFor="lab-allowlist">Allowed hosts (one per line)</Label>
            <Textarea
              id="lab-allowlist"
              className="min-h-[96px] font-mono text-xs"
              value={allowlistText}
              spellCheck={false}
              placeholder={'www.google.com\n*.example.com'}
              onChange={(event) => onAllowlistTextChange(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Exact host or <code>*.apex.com</code> for subdomains. Include your default host.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border p-3">
        <div>
          <h3 className="text-sm font-medium">Capacity &amp; viewport</h3>
          <p className="text-[11px] text-muted-foreground">
            How many sessions can run and the default remote screen size.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="lab-max-sessions">Max concurrent sessions</Label>
            <Input
              id="lab-max-sessions"
              type="number"
              min={1}
              className="font-mono text-xs"
              value={resourceManagement.sessions.maxConcurrentSessions || ''}
              onChange={(event) => {
                const value = Number(event.target.value)
                onResourceManagementChange({
                  ...resourceManagement,
                  sessions: {
                    ...resourceManagement.sessions,
                    maxConcurrentSessions: Number.isFinite(value) ? value : 0,
                  },
                })
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-detached">Detached timeout</Label>
            <Input
              id="lab-detached"
              className="font-mono text-xs"
              value={sessions.detachedSessionTimeout}
              spellCheck={false}
              placeholder="00:05:00"
              onChange={(event) =>
                onSessionsChange({
                  ...sessions,
                  detachedSessionTimeout: event.target.value,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-vp-w">Viewport width</Label>
            <Input
              id="lab-vp-w"
              type="number"
              min={1}
              className="font-mono text-xs"
              value={defaultViewport.width || ''}
              onChange={(event) => {
                const width = Number(event.target.value)
                onSessionsChange({
                  ...sessions,
                  viewportPolicy: {
                    ...sessions.viewportPolicy,
                    default: {
                      ...sessions.viewportPolicy.default,
                      width: Number.isFinite(width) ? width : 0,
                    },
                  },
                })
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-vp-h">Viewport height</Label>
            <Input
              id="lab-vp-h"
              type="number"
              min={1}
              className="font-mono text-xs"
              value={defaultViewport.height || ''}
              onChange={(event) => {
                const height = Number(event.target.value)
                onSessionsChange({
                  ...sessions,
                  viewportPolicy: {
                    ...sessions.viewportPolicy,
                    default: {
                      ...sessions.viewportPolicy.default,
                      height: Number.isFinite(height) ? height : 0,
                    },
                  },
                })
              }}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Public session domains (optional)</h3>
          <p className="text-[11px] text-muted-foreground">
            Domains Speculum presents to users (certificates / mirroring). Leave empty for plain lab
            browsing through the default target host.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lab-hosting">Domains (one per line)</Label>
          <Textarea
            id="lab-hosting"
            className="min-h-[72px] font-mono text-xs"
            value={hostingText}
            spellCheck={false}
            placeholder={'lab.example.com\nlab.example.com +mirror'}
            onChange={(event) => onHostingTextChange(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Append <code>+mirror</code> to mirror subdomains for that entry.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lab-cert-email">Certificate contact email</Label>
          <Input
            id="lab-cert-email"
            className="font-mono text-xs"
            value={certificateEmail}
            spellCheck={false}
            placeholder="optional"
            onChange={(event) => onCertificateEmailChange(event.target.value)}
          />
        </div>
      </section>
    </div>
  )
}
