type HostingProfile = {
  domain: string
  subdomainMirroringEnabled: boolean
  mirroringOperational?: boolean
  missing?: string[]
}

export function profileBadge(p: HostingProfile): {
  label: string
  tone: 'success' | 'warning' | 'muted'
} {
  if (!p.subdomainMirroringEnabled) return { label: 'Apex mode', tone: 'muted' }
  // mirroringOperational is 1.1 — treat enabled-but-unknown as pending until then.
  if (p.mirroringOperational) return { label: 'Mirroring OK', tone: 'success' }
  return { label: 'Mirroring pending (1.1)', tone: 'warning' }
}

export const SECTION_HELP: Record<string, { title: string; href: string }> = {
  Navigation: { title: 'Configure navigation', href: '/admin' },
  Sessions: { title: 'Configure sessions', href: '/admin' },
  ResourceManagement: { title: 'Set session capacity', href: '/admin' },
  Forwarding: { title: 'Configure forwarding', href: '/admin' },
  Hosting: { title: 'Configure hosting', href: '/admin' },
  MaxSessions: { title: 'Set session capacity', href: '/admin' },
  SessionPolicy: { title: 'Set session policy', href: '/admin' },
  JsBridge: { title: 'Configure JsBridge', href: '/admin' },
  Diagnostics: { title: 'Configure diagnostics', href: '/admin/diagnostics/config' },
  ScriptInjection: { title: 'Configure script injection', href: '/admin/script-injection' },
}
