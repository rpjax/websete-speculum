import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DataCard,
  FieldGrid,
  HelperCallout,
  RevealPanel,
  SwitchField,
} from '@/features/admin/components'
import {
  ConfigField,
  asObject,
  text,
  type JsonObject,
} from './configFieldPrimitives'
import { isBareHost } from './urlMatchRules'

function asDomains(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => !!item && typeof item === 'object')
    : []
}

function domainRowKey(index: number): string {
  // Index-stable while typing — host-based keys remount and steal focus.
  return `domain-row-${index}`
}

export function HostingEditor({
  value,
  replace,
  update,
}: {
  value: JsonObject
  replace: (next: JsonObject) => void
  update: (path: string[], raw: string | boolean | number) => void
}) {
  const domains = asDomains(value.domains)
  const setDomains = (next: JsonObject[]) => replace({ ...value, domains: next })

  return (
    <div className="space-y-6">
      <ConfigField
        id="defaultCertificateEmail"
        label="Default certificate email"
        helper="Used when a domain does not set its own certificate email."
        type="email"
        placeholder="ops@example.com"
        value={text(value.defaultCertificateEmail)}
        onChange={(v) => update(['defaultCertificateEmail'], v)}
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Domains</h3>
            <p className="text-xs text-muted-foreground">
              Apex hosts Speculum terminates. Leave empty if Hosting is unused.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full shrink-0 sm:w-auto"
            onClick={() =>
              setDomains([
                ...domains,
                {
                  domain: '',
                  certificateEmail: null,
                  isSubdomainMirroringEnabled: false,
                  dnsChallenge: null,
                },
              ])
            }
          >
            <Plus className="h-4 w-4" />
            Add domain
          </Button>
        </div>

        <DataCard className="p-3">
          {!domains.length ? (
            <HelperCallout title="No domains configured">
              Hosting can stay empty until you materialize edge certificates for a public host.
            </HelperCallout>
          ) : (
            <ul className="space-y-4">
              {domains.map((domain, index) => {
                const host = text(domain.domain)
                const challenge = asObject(domain.dnsChallenge)
                const cloudflare = asObject(challenge.cloudflare)
                const hasChallenge = Boolean(domain.dnsChallenge)
                return (
                  <li
                    key={domainRowKey(index)}
                    className="space-y-3 rounded-lg border border-border bg-background/40 p-3 sm:p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">
                        {host || `Domain ${index + 1}`}
                      </p>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${host || `domain ${index + 1}`}`}
                        onClick={() => setDomains(domains.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <FieldGrid>
                      <ConfigField
                        id={`domain-${index}`}
                        label="Host"
                        helper="Bare host only, e.g. example.com"
                        placeholder="example.com"
                        value={host}
                        error={host && !isBareHost(host) ? 'Enter a bare host without a scheme or path.' : undefined}
                        onChange={(v) => {
                          const next = [...domains]
                          next[index] = { ...domain, domain: v }
                          setDomains(next)
                        }}
                      />
                      <ConfigField
                        id={`domain-email-${index}`}
                        label="Certificate email (optional)"
                        type="email"
                        value={text(domain.certificateEmail)}
                        onChange={(v) => {
                          const next = [...domains]
                          next[index] = { ...domain, certificateEmail: v || null }
                          setDomains(next)
                        }}
                      />
                    </FieldGrid>

                    <SwitchField
                      id={`domain-mirror-${index}`}
                      label="Subdomain mirroring"
                      helper="Mirror apex traffic onto subdomains when edge materialization supports it."
                      checked={Boolean(domain.isSubdomainMirroringEnabled)}
                      onCheckedChange={(checked) => {
                        const next = [...domains]
                        next[index] = { ...domain, isSubdomainMirroringEnabled: checked }
                        setDomains(next)
                      }}
                    />

                    <RevealPanel title="DNS challenge (optional)">
                      <div className="space-y-3">
                        <SwitchField
                          id={`domain-dns-${index}`}
                          label="Enable DNS challenge"
                          helper="Required for automatic certificate issuance on some providers."
                          checked={hasChallenge}
                          onCheckedChange={(checked) => {
                            const next = [...domains]
                            next[index] = {
                              ...domain,
                              dnsChallenge: checked
                                ? {
                                    provider: 'cloudflare',
                                    cloudflare: {
                                      email: text(cloudflare.email) || text(value.defaultCertificateEmail),
                                      apiToken: text(cloudflare.apiToken),
                                    },
                                  }
                                : null,
                            }
                            setDomains(next)
                          }}
                        />
                        {hasChallenge ? (
                          <FieldGrid>
                            <ConfigField
                              id={`cf-email-${index}`}
                              label="Cloudflare account email"
                              type="email"
                              value={text(cloudflare.email)}
                              onChange={(v) => {
                                const next = [...domains]
                                next[index] = {
                                  ...domain,
                                  dnsChallenge: {
                                    provider: 'cloudflare',
                                    cloudflare: {
                                      ...cloudflare,
                                      email: v,
                                      apiToken: text(cloudflare.apiToken),
                                    },
                                  },
                                }
                                setDomains(next)
                              }}
                            />
                            <ConfigField
                              id={`cf-token-${index}`}
                              label="Cloudflare API token"
                              helper="Stored with Hosting configuration. Rotate if exposed."
                              value={text(cloudflare.apiToken)}
                              onChange={(v) => {
                                const next = [...domains]
                                next[index] = {
                                  ...domain,
                                  dnsChallenge: {
                                    provider: 'cloudflare',
                                    cloudflare: {
                                      ...cloudflare,
                                      email: text(cloudflare.email),
                                      apiToken: v,
                                    },
                                  },
                                }
                                setDomains(next)
                              }}
                            />
                          </FieldGrid>
                        ) : null}
                      </div>
                    </RevealPanel>
                  </li>
                )
              })}
            </ul>
          )}
        </DataCard>
      </div>
    </div>
  )
}
