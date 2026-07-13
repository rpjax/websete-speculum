import { useEffect, useState } from 'react'
import { api, ConfigSections } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ForwardingPage() {
  const [host, setHost] = useState('')
  const [domainsText, setDomainsText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSection<{ host: string; domains: string[] }>(ConfigSections.Forwarding)
      .then((v) => {
        setHost(v.host)
        setDomainsText(v.domains.join('\n'))
      })
      .catch(() => { /* not configured yet */ })
  }, [])

  async function save() {
    setMessage(null)
    setError(null)
    const domains = domainsText.split(/\r?\n/).map((d) => d.trim()).filter(Boolean)
    try {
      await api.putSection(ConfigSections.Forwarding, { host: host.trim(), domains })
      setMessage('Saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function remove() {
    try {
      await api.deleteSection(ConfigSections.Forwarding)
      setHost('')
      setDomainsText('')
      setMessage('Deleted')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Forwarding</h1>
      <Card>
        <CardHeader><CardTitle>Target site &amp; navigation allowlist</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="host">Target host (FQDN)</Label>
            <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="www.olx.com.br" />
            <p className="text-xs text-muted-foreground">
              The remote site the sidecar opens — not the motor Traefik hostname.
              Motor uses path + query from the client URL.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="domains">Domains (one per line, supports *.pattern)</Label>
            <textarea
              id="domains"
              className="min-h-32 w-full rounded-md border border-border bg-background p-3 text-sm"
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Navigation allowlist for main-frame documents (e.g. olx.com.br, *.olx.com.br).
              Wildcard is required only when Subdomain Mirroring is enabled.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void save()}>Save</Button>
            <Button variant="outline" onClick={() => void remove()}>Delete</Button>
          </div>
          {message && <p className="text-green-400">{message}</p>}
          {error && <p className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

