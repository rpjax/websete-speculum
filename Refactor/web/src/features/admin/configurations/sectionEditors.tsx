import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DataCard,
  HelperCallout,
  InlineValidation,
  RevealPanel,
  StatusPill,
  SwitchField,
} from '@/features/admin/components'
import { JournalEditor } from './JournalEditor'
import { MainFrameAllowlistEditor } from './MainFrameAllowlistEditor'
import { ResourceManagementEditor } from './ResourceManagementEditor'
import { SessionsEditor } from './SessionsEditor'
import { TelemetryEditor } from './TelemetryEditor'
import { isBareHost } from './urlMatchRules'

export type JsonObject = Record<string, unknown>

export const text = (value: unknown) =>
  typeof value === 'string' ? value : value == null ? '' : String(value)

export const nested = (section: JsonObject, parent: string, key: string) => {
  const child = section[parent]
  return child && typeof child === 'object' ? (child as JsonObject)[key] : undefined
}

const asObject = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}

const asDomains = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.filter((item): item is JsonObject => !!item && typeof item === 'object') : []

function Field({
  id,
  label,
  helper,
  value,
  onChange,
  type = 'text',
  min,
  step,
  placeholder,
  error,
}: {
  id: string
  label: string
  helper?: string
  value: string
  onChange: (value: string) => void
  type?: string
  min?: number
  step?: number
  placeholder?: string
  error?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        min={min}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
      <InlineValidation message={error} />
    </div>
  )
}

export function SectionPrimaryFields({
  section,
  value,
  replace,
  update,
}: {
  section: string
  value: JsonObject
  replace: (next: JsonObject) => void
  update: (path: string[], raw: string | boolean | number) => void
}): ReactNode {
  switch (section) {
    case 'Hosting':
      return <HostingFields value={value} replace={replace} update={update} />
    case 'Navigation':
      return <NavigationFields value={value} replace={replace} update={update} />
    case 'Sessions':
      return <SessionsEditor value={value} replace={replace} update={update} />
    case 'ResourceManagement':
      return <ResourceManagementEditor value={value} replace={replace} update={update} />
    case 'Scripting':
      return <ScriptingFields value={value} />
    case 'Journal':
      return <JournalEditor value={value} replace={replace} />
    case 'Telemetry':
      return <TelemetryEditor value={value} replace={replace} update={update} />
    default:
      return null
  }
}

function HostingFields({
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
    <div className="space-y-5">
      <Field
        id="defaultCertificateEmail"
        label="Default certificate email"
        helper="Used when a domain does not set its own certificate email."
        type="email"
        placeholder="ops@example.com"
        value={text(value.defaultCertificateEmail)}
        onChange={(v) => update(['defaultCertificateEmail'], v)}
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Domains</h3>
            <p className="text-xs text-muted-foreground">
              Apex hosts Speculum terminates. Leave empty if Hosting is unused.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
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
            <ul className="space-y-3">
            {domains.map((domain, index) => {
              const host = text(domain.domain)
              const challenge = asObject(domain.dnsChallenge)
              const cloudflare = asObject(challenge.cloudflare)
              const hasChallenge = Boolean(domain.dnsChallenge)
              return (
                <li key={index} className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">Domain {index + 1}</p>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove domain ${index + 1}`}
                      onClick={() => setDomains(domains.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Field
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
                  <Field
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
                        <>
                          <Field
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
                                  cloudflare: { ...cloudflare, email: v, apiToken: text(cloudflare.apiToken) },
                                },
                              }
                              setDomains(next)
                            }}
                          />
                          <Field
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
                                  cloudflare: { ...cloudflare, email: text(cloudflare.email), apiToken: v },
                                },
                              }
                              setDomains(next)
                            }}
                          />
                        </>
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

function NavigationFields({
  value,
  replace,
  update,
}: {
  value: JsonObject
  replace: (next: JsonObject) => void
  update: (path: string[], raw: string | boolean | number) => void
}) {
  const host = text(value.defaultTargetHost)
  const rules = Array.isArray(value.allowedMainFrameUrls) ? value.allowedMainFrameUrls : []
  const hostOk = isBareHost(host)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusPill label={hostOk ? `Target · ${host}` : 'Target host incomplete'} tone={hostOk ? 'success' : 'warning'} />
        <StatusPill
          label={rules.length ? `Allowlist · ${rules.length}` : 'Allowlist empty'}
          tone={rules.length ? 'success' : 'warning'}
        />
      </div>

      <Field
        id="defaultTargetHost"
        label="Default target host"
        helper="First page sessions open. Host only — no scheme or path."
        placeholder="example.com"
        value={host}
        error={host && !hostOk ? 'Enter a bare host without a scheme or path.' : undefined}
        onChange={(v) => update(['defaultTargetHost'], v)}
      />

      <div className="border-t border-border pt-5">
        <MainFrameAllowlistEditor
          defaultHost={host}
          rules={rules}
          onChange={(next) => replace({ ...value, allowedMainFrameUrls: next })}
        />
      </div>
    </div>
  )
}

function ScriptingFields({ value }: { value: JsonObject }) {
  const injections = Array.isArray(value.injections) ? value.injections : []
  return (
    <div className="space-y-4">
      <HelperCallout
        title="Manage injections in Scripts"
        action={{ label: 'Open injections', href: '/w7s/admin/scripts?tab=injections' }}
      >
        Injection rules have a safer focused flow. This section currently has {injections.length} injection
        {injections.length === 1 ? '' : 's'}.
      </HelperCallout>
      <DataCard className="p-4">
        <p className="text-sm font-medium">What belongs here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use Scripts library and the injection wizard for add/edit/remove. This configuration section is a hub link —
          not a JSON editor.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to="/w7s/admin/scripts?tab=injections">Open injections</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/w7s/admin/scripts?tab=library">Open library</Link>
          </Button>
        </div>
      </DataCard>
    </div>
  )
}
