import { useState } from 'react'
import { ExternalLink, Globe, Plus, ShieldAlert, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ConfigSections } from '@/lib/api'
import { useConfigSection } from '@/lib/hooks/useConfigSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { PageHeader } from '@/components/admin/PageHeader'
import { SaveFeedbackStrip } from '@/components/admin/SaveFeedbackStrip'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructive'

interface ForwardingConfig {
  host: string
  domains: string[]
}

export default function ForwardingPage() {
  const [domainDraft, setDomainDraft] = useState('')
  const [domainError, setDomainError] = useState<string | null>(null)

  const cfg = useConfigSection<ForwardingConfig>({
    section: ConfigSections.Forwarding,
    initial: { host: '', domains: [] },
    mapIn: (raw) => {
      const r = raw as ForwardingConfig
      return { host: r?.host ?? '', domains: r?.domains ?? [] }
    },
    mapOut: (v) => ({ host: v.host.trim(), domains: v.domains }),
  })

  function addDomain() {
    const d = domainDraft.trim()
    if (!d) return
    if (cfg.value.domains.includes(d)) {
      setDomainError('Domain already in allowlist')
      return
    }
    setDomainError(null)
    cfg.setValue({ ...cfg.value, domains: [...cfg.value.domains, d] })
    setDomainDraft('')
  }

  function removeDomain(d: string) {
    cfg.setValue({ ...cfg.value, domains: cfg.value.domains.filter((x) => x !== d) })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Forwarding"
        description="Where the remote browser navigates and what domains it's allowed to reach."
      />

      {cfg.loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Target site</CardTitle>
              <CardDescription>
                The remote site opened when a motor session starts.
                This is not the motor hostname — configure that under{' '}
                <Link to="/admin/hosting" className="text-primary underline">Hosting</Link>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="fwd-host">Hostname (FQDN)</Label>
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    id="fwd-host"
                    value={cfg.value.host}
                    onChange={(e) => cfg.setValue({ ...cfg.value, host: e.target.value })}
                    placeholder="www.example.com"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Fully qualified domain the sidecar navigates to on session init.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Navigation allowlist</CardTitle>
              <CardDescription>
                Main-frame navigations are blocked unless the URL matches one of these patterns.
                Use <code className="rounded bg-muted px-1 text-xs">*.example.com</code> for wildcard subdomains.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fwd-domain" className="sr-only">Add domain pattern</Label>
                <div className="flex gap-2">
                  <Input
                    id="fwd-domain"
                    value={domainDraft}
                    onChange={(e) => {
                      setDomainDraft(e.target.value)
                      if (domainError) setDomainError(null)
                    }}
                    placeholder="example.com or *.example.com"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addDomain()
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={addDomain}>
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
                {domainError && (
                  <p className="text-xs text-destructive">{domainError}</p>
                )}
              </div>

              {cfg.value.domains.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                  <ExternalLink className="mx-auto mb-2 h-5 w-5 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">
                    No domains in allowlist yet.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add apex domains or wildcard patterns to allow navigation.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {cfg.value.domains.map((d) => (
                    <div
                      key={d}
                      className="group flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {d.startsWith('*') ? (
                          <span className="shrink-0 text-xs text-muted-foreground" title="Wildcard pattern">✱</span>
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground" title="Exact domain">⊙</span>
                        )}
                        <span className="truncate text-sm font-mono">{d}</span>
                      </div>
                      <button
                        type="button"
                        className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Remove ${d}`}
                        onClick={() => removeDomain(d)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <SaveFeedbackStrip
            pending={cfg.pending}
            message={cfg.message}
            error={cfg.error}
            onSave={() => void cfg.save()}
            saveLabel="Save forwarding"
          />

          <Accordion type="single" collapsible>
            <AccordionItem value="danger" className="border-none">
              <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="h-3 w-3" />
                  Danger zone
                </span>
              </AccordionTrigger>
              <AccordionContent className="pt-2">
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Deleting forwarding removes the target host and allowlist.
                    New motor sessions will fail until forwarding is reconfigured.
                  </p>
                  <ConfirmDestructiveButton
                    label="Delete forwarding"
                    size="sm"
                    title="Delete forwarding configuration?"
                    description="This removes the target host and all allowlist entries. New motor sessions will not have a target until you save a new configuration."
                    confirmLabel="Delete"
                    onConfirm={() => void cfg.remove({ host: '', domains: [] })}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </div>
  )
}
