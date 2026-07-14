import { NavLink, Outlet } from 'react-router-dom'
import { PageHeader } from '@/components/admin/PageHeader'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/admin/diagnostics', label: 'Overview', end: true },
  { to: '/admin/diagnostics/events', label: 'Events' },
  { to: '/admin/diagnostics/live', label: 'Live sessions' },
  { to: '/admin/diagnostics/probes', label: 'Probes' },
  { to: '/admin/diagnostics/config', label: 'Config' },
]

export default function DiagnosticsLayout() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnostics"
        description="Observe motor health, timelines, live sessions, and browser probes. Detail reveals as you drill in."
      />
      <nav className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/40 p-1">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'rounded-sm px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                isActive && 'bg-card text-foreground shadow-sm',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
