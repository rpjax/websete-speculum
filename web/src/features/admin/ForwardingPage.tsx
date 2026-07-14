import { useState } from 'react'
import { X } from 'lucide-react'
import { ConfigSections } from '@/lib/api'
import { useConfigSection } from '@/lib/hooks/useConfigSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/admin/PageHeader'
import { ConfigSectionCard } from '@/components/admin/ConfigSectionCard'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructive'

interface ForwardingConfig {
  host: string
  domains: string[]
}

export default function ForwardingPage() {
  const [domainDraft, setDomainDraft] = useState('')
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
    if (!d || cfg.value.domains.includes(d)) return
    cfg.setValue({ ...cfg.value, domains: [...cfg.value.domains, d] })
    setDomainDraft('')
  }

  function removeDomain(d: string) {
    cfg.setValue({ ...cfg.value, domains: cfg.value.domains.filter((x) => x !== d) })
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        title="Forwarding"
        description="Target site the remote browser opens, plus the navigation allowlist for main-frame documents."
      />
      <ConfigSectionCard
        title="Target site & allowlist"
        description="Motor hostname is separate — configure that under Hosting."
        loading={cfg.loading}
        pending={cfg.pending}
        message={cfg.message}
        error={cfg.error}
        onSave={() => void cfg.save()}
        secondary={
          <ConfirmDestructiveButton
            label="Delete section"
            size="sm"
            title="Delete forwarding?"
            description="Removes the forwarding section. New sessions will not have a target host until you save again."
            confirmLabel="Delete"
            onConfirm={() => void cfg.remove({ host: '', domains: [] })}
          />
        }
      >
        <div className="space-y-2">
          <Label htmlFor="host">Target host (FQDN)</Label>
          <Input
            id="host"
            value={cfg.value.host}
            onChange={(e) => cfg.setValue({ ...cfg.value, host: e.target.value })}
            placeholder="www.example.com"
          />
          <p className="text-xs text-muted-foreground">
            The remote site the sidecar opens — not the motor Traefik hostname.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="domain">Allowlist domains</Label>
          <div className="flex gap-2">
            <Input
              id="domain"
              value={domainDraft}
              onChange={(e) => setDomainDraft(e.target.value)}
              placeholder="*.example.com"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addDomain()
                }
              }}
            />
            <Button type="button" variant="outline" onClick={addDomain}>
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {cfg.value.domains.length === 0 && (
              <p className="text-xs text-muted-foreground">No domains yet — add apex or *.pattern entries.</p>
            )}
            {cfg.value.domains.map((d) => (
              <Badge key={d} className="gap-1 pr-1">
                {d}
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-muted"
                  aria-label={`Remove ${d}`}
                  onClick={() => removeDomain(d)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      </ConfigSectionCard>
    </div>
  )
}
