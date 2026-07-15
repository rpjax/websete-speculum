import { NavLink, Outlet } from 'react-router-dom'
import { PageHeader } from '@/components/admin/PageHeader'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/admin/diagnostics', label: 'Overview', end: true },
  { to: '/admin/diagnostics/health', label: 'Health' },
  { to: '/admin/diagnostics/resources', label: 'Resources' },
  { to: '/admin/diagnostics/activity', label: 'Activity' },
  { to: '/admin/diagnostics/investigate', label: 'Investigate' },
  { to: '/admin/diagnostics/governance', label: 'Governance' },
]

export default function DiagnosticsLayout() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnostics"
        description="Observe motor health, session activity, correlation stories, browser probes, and diagnostics governance."
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
