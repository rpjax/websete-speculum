import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  loadLabInputPathClientTrace,
  saveLabInputPathClientTrace,
} from '@/features/sessions/live/sessionConfig'
import type { LabOrigins } from './labConfig'

interface LabWireSettingsProps {
  origins: LabOrigins
  connectionId: string | null
  profileId: string | null
  sessionId: string | null
  disabled: boolean
  onApply: (origins: LabOrigins) => void
  onForgetProfile: () => void
}

/**
 * Wire endpoints and identity. WebTransport is HTTP/3-only, so the data plane
 * often lives on a different origin than the hub during local development.
 */
export function LabWireSettings({
  origins,
  connectionId,
  profileId,
  sessionId,
  disabled,
  onApply,
  onForgetProfile,
}: LabWireSettingsProps) {
  const [hubOrigin, setHubOrigin] = useState(origins.hubOrigin)
  const [transportOrigin, setTransportOrigin] = useState(origins.transportOrigin)
  const [inputPathClient, setInputPathClient] = useState(loadLabInputPathClientTrace)
  const dirty =
    hubOrigin.trim() !== origins.hubOrigin || transportOrigin.trim() !== origins.transportOrigin

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="lab-hub-origin">Hub origin (SignalR /vhub)</Label>
        <Input
          id="lab-hub-origin"
          className="font-mono text-xs"
          value={hubOrigin}
          spellCheck={false}
          placeholder="same origin (dev proxy / Traefik)"
          onChange={(event) => setHubOrigin(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to use this page's origin — the Vite proxy forwards <code>/vhub</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="lab-transport-origin">Transport origin (WebTransport /vtransport)</Label>
        <Input
          id="lab-transport-origin"
          className="font-mono text-xs"
          value={transportOrigin}
          spellCheck={false}
          placeholder="https://localhost:8443"
          onChange={(event) => setTransportOrigin(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Must be HTTPS + HTTP/3. Dockup lab publishes the API at{' '}
          <code>https://localhost:8443</code>; leave hub empty (Traefik) and set that transport
          origin. The client pins the API cert via <code>/health/webtransport-cert</code>.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
        <div className="space-y-0.5">
          <Label htmlFor="lab-input-path-client">Input path · client_sent</Label>
          <p className="text-[11px] text-muted-foreground">
            Log every <code>sendInput</code> as hop 0 in this feed. Pair with Config → Telemetry ·
            Events → Trace input path (server hops 1–3).
          </p>
        </div>
        <Switch
          id="lab-input-path-client"
          checked={inputPathClient}
          onCheckedChange={(checked) => {
            setInputPathClient(checked)
            saveLabInputPathClientTrace(checked)
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || disabled}
          onClick={() => onApply({ hubOrigin, transportOrigin })}
        >
          Apply endpoints
        </Button>
        <Button size="sm" variant="outline" onClick={onForgetProfile} disabled={disabled}>
          Forget profile
        </Button>
        {disabled && (
          <span className="text-xs text-muted-foreground">Stop the session to change endpoints.</span>
        )}
      </div>

      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 border-t border-border pt-3 text-xs">
        <dt className="text-muted-foreground">Connection</dt>
        <dd className="truncate font-mono">{connectionId ?? '—'}</dd>
        <dt className="text-muted-foreground">Profile</dt>
        <dd className="truncate font-mono">{profileId ?? 'created on first start'}</dd>
        <dt className="text-muted-foreground">Session</dt>
        <dd className="truncate font-mono">{sessionId ?? '—'}</dd>
      </dl>
    </div>
  )
}
