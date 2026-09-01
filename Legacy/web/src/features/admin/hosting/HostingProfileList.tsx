import { Globe, Plus, ShieldCheck, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { HostingProfile } from './HostingProfileSheet'
import { profileBadge } from '@/lib/hostingStatus'
import type { ConfigStatus } from '@/lib/api'

type ProfileStatusEntry = NonNullable<ConfigStatus['hosting']>['profiles'][number]

interface HostingProfileListProps {
  profiles: HostingProfile[]
  statusProfiles: ProfileStatusEntry[]
  onSelect: (index: number) => void
  onAdd: () => void
}

export function HostingProfileList({
  profiles,
  statusProfiles,
  onSelect,
  onAdd,
}: HostingProfileListProps) {
  if (profiles.length === 0 || (profiles.length === 1 && !profiles[0].domain)) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <Globe className="h-8 w-8 text-muted-foreground/60" />
          <div className="space-y-1">
            <h3 className="text-sm font-medium">No hosting profiles</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add a motor domain to start serving remote browser sessions over HTTPS.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add domain
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2">
        {profiles.map((profile, i) => {
          const statusEntry = statusProfiles.find((s) => s.domain === profile.domain)
          const badge = statusEntry ? profileBadge(statusEntry) : null

          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              className={cn(
                'group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors',
                'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/50">
                {profile.subdomainMirroringEnabled
                  ? <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  : <Wifi className="h-4 w-4 text-muted-foreground" />
                }
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {profile.domain || 'Untitled domain'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {profile.subdomainMirroringEnabled ? 'Wildcard mirroring' : 'Apex mode'}
                  {profile.acmeEmail ? ` · ${profile.acmeEmail}` : ''}
                </p>
              </div>

              {badge && (
                <Badge variant={badge.tone === 'success' ? 'success' : badge.tone === 'warning' ? 'warning' : 'muted'}>
                  {badge.label}
                </Badge>
              )}
            </button>
          )
        })}
      </div>

      <Button variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        Add domain
      </Button>
    </div>
  )
}
