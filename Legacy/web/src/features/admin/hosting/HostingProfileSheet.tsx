import { Globe, Shield, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ConfirmDestructive } from '@/components/admin/ConfirmDestructive'

export interface HostingProfile {
  domain: string
  acmeEmail?: string | null
  subdomainMirroringEnabled: boolean
  edgeTls?: { provider: string; email: string; apiToken: string }
}

interface ProfileStatus {
  domain: string
  subdomainMirroringEnabled: boolean
  mirroringOperational: boolean
  missing: string[]
}

interface HostingProfileSheetProps {
  profile: HostingProfile | null
  status?: ProfileStatus
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<HostingProfile>) => void
  onRemove?: () => void
  profileIndex: number
  profileCount: number
}

export function HostingProfileSheet({
  profile,
  status,
  open,
  onOpenChange,
  onChange,
  onRemove,
  profileIndex,
  profileCount,
}: HostingProfileSheetProps) {
  if (!profile) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            {profile.domain || `Profile ${profileIndex + 1}`}
          </SheetTitle>
          <SheetDescription>
            Edit domain settings. Changes apply when you save hosting.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-1 flex-col gap-6 overflow-y-auto">
          <section className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="profile-domain">Motor domain</Label>
              <Input
                id="profile-domain"
                value={profile.domain}
                onChange={(e) => onChange({ domain: e.target.value })}
                placeholder="browse.example.com"
              />
              <p className="text-xs text-muted-foreground">
                The public hostname for this motor endpoint.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-acme">ACME email override</Label>
              <Input
                id="profile-acme"
                type="email"
                value={profile.acmeEmail ?? ''}
                onChange={(e) => onChange({ acmeEmail: e.target.value })}
                placeholder="Uses global email if blank"
              />
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Subdomain mirroring</Label>
                <p className="text-xs text-muted-foreground">
                  Wildcard TLS for subdomains via Cloudflare DNS-01.
                </p>
              </div>
              <Switch
                checked={profile.subdomainMirroringEnabled}
                onCheckedChange={(v) => onChange({ subdomainMirroringEnabled: v })}
              />
            </div>

            {profile.subdomainMirroringEnabled && (
              <Accordion type="single" collapsible defaultValue="cf">
                <AccordionItem value="cf" className="border-none">
                  <AccordionTrigger className="py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5" />
                      Cloudflare DNS-01 credentials
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-1">
                    <div className="space-y-2">
                      <Label htmlFor="cf-email">Cloudflare ACME email</Label>
                      <Input
                        id="cf-email"
                        type="email"
                        value={profile.edgeTls?.email ?? ''}
                        onChange={(e) =>
                          onChange({
                            edgeTls: {
                              provider: 'cloudflare',
                              email: e.target.value,
                              apiToken: profile.edgeTls?.apiToken ?? '',
                            },
                          })
                        }
                        placeholder="cloudflare@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cf-token">API token</Label>
                      <Input
                        id="cf-token"
                        type="password"
                        value={profile.edgeTls?.apiToken === '***' ? '' : (profile.edgeTls?.apiToken ?? '')}
                        onChange={(e) =>
                          onChange({
                            edgeTls: {
                              provider: 'cloudflare',
                              email: profile.edgeTls?.email ?? '',
                              apiToken: e.target.value,
                            },
                          })
                        }
                        placeholder="Leave blank to keep existing"
                      />
                      <p className="text-xs text-muted-foreground">
                        Scoped token with Zone:DNS:Edit permission.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </section>

          {status?.missing && status.missing.length > 0 && (
            <>
              <Separator />
              <section className="space-y-2">
                <p className="text-xs font-medium text-warning">Missing configuration</p>
                <div className="flex flex-wrap gap-1.5">
                  {status.missing.map((m) => (
                    <Badge key={m} variant="warning">{m}</Badge>
                  ))}
                </div>
              </section>
            </>
          )}

          <div className="mt-auto pt-4">
            {profileCount > 1 && onRemove && (
              <ConfirmDestructive
                title="Remove profile?"
                description={`"${profile.domain || 'Untitled'}" will be removed when you save hosting configuration.`}
                confirmLabel="Remove"
                onConfirm={() => {
                  onRemove()
                  onOpenChange(false)
                }}
                trigger={
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove profile
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
