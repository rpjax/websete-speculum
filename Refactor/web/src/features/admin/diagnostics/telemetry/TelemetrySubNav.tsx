import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Activity, LineChart } from 'lucide-react'

const LINKS = [
  { to: '/admin/diagnostics/telemetry', label: 'Monitor', icon: LineChart, end: true },
  { to: '/admin/diagnostics/telemetry/analysis', label: 'Telemetry analysis', icon: Activity, end: false },
]

/** Secondary nav — Monitor and Analysis are independent tools. */
export function TelemetrySubNav() {
  return (
    <nav className="flex gap-1 rounded-md border border-border bg-muted/30 p-0.5 w-fit">
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-sm px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground',
              isActive && 'bg-card text-foreground shadow-sm',
            )
          }
        >
          <l.icon className="h-3 w-3" />
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}
