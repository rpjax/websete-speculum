import type { ConfigStatus } from '@/lib/api'

export function profileBadge(p: NonNullable<ConfigStatus['hosting']>['profiles'][number]): {
  label: string
  tone: 'success' | 'warning' | 'muted'
} {
  if (!p.subdomainMirroringEnabled) return { label: 'Apex mode', tone: 'muted' }
  if (p.mirroringOperational) return { label: 'Mirroring OK', tone: 'success' }
  return { label: 'Mirroring pending', tone: 'warning' }
}

export const SECTION_HELP: Record<string, { title: string; href: string }> = {
  Forwarding: { title: 'Configure forwarding', href: '/admin/forwarding' },
  Hosting: { title: 'Configure hosting', href: '/admin/hosting' },
  MaxSessions: { title: 'Set session capacity', href: '/admin/capacity' },
  SessionPolicy: { title: 'Set session policy', href: '/admin/capacity' },
  JsBridge: { title: 'Configure JsBridge', href: '/admin/capacity' },
  Diagnostics: { title: 'Configure diagnostics', href: '/admin/diagnostics/config' },
  ScriptInjection: { title: 'Configure script injection', href: '/admin/script-injection' },
}
