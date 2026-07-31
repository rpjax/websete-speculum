import type { LucideIcon } from 'lucide-react'
import { Activity, Boxes, FileCode2, House, Server, Settings2, UsersRound } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  end?: boolean
  helper: string
}

type NavSection = {
  id: string
  label: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { label: 'Home', href: '/admin', icon: House, end: true, helper: 'Operator overview' },
      { label: 'Sessions', href: '/admin/sessions', icon: Activity, helper: 'Live sessions' },
      { label: 'Profiles', href: '/admin/profiles', icon: UsersRound, helper: 'Persisted identities' },
      { label: 'Scripts', href: '/admin/scripts', icon: FileCode2, helper: 'Library and injections' },
    ],
  },
  {
    id: 'configure',
    label: 'Configure',
    items: [
      {
        label: 'Configurations',
        href: '/admin/configurations',
        icon: Settings2,
        helper: 'Engine sections',
      },
      {
        label: 'Host resources',
        href: '/admin/host-resources',
        icon: Server,
        helper: 'Capacity / shm',
      },
    ],
  },
  {
    id: 'observe',
    label: 'Observe',
    items: [
      {
        label: 'Diagnostics',
        href: '/admin/diagnostics',
        icon: Boxes,
        helper: 'Observe and govern',
      },
    ],
  },
]

type AdminNavProps = {
  onNavigate?: () => void
  /** Compact sheet layout omits the desktop footer wordmark. */
  variant?: 'rail' | 'sheet'
}

export function AdminNav({ onNavigate, variant = 'rail' }: AdminNavProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        variant === 'rail' ? 'px-2.5 py-3' : 'px-2 py-2',
      )}
    >
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" aria-label="Admin navigation">
        {NAV_SECTIONS.map((section) => (
          <div
            key={section.id}
            role="group"
            aria-labelledby={`admin-nav-${section.id}`}
            className="flex flex-col gap-0.5"
          >
            <p
              id={`admin-nav-${section.id}`}
              className="px-2.5 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80"
            >
              {section.label}
            </p>
            {section.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end={item.end}
                  title={item.helper}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-offset-2 transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                      isActive
                        ? 'bg-primary/10 font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/55 hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden
                        className={cn(
                          'absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary transition-opacity',
                          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
                        )}
                      />
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-opacity',
                          isActive ? 'text-primary opacity-100' : 'opacity-75 group-hover:opacity-95',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      {variant === 'rail' ? (
        <div className="mt-3 shrink-0 border-t border-border/70 px-2.5 pt-3">
          <p className="text-[0.7rem] font-medium tracking-[0.04em] text-muted-foreground/90">
            Speculum
          </p>
          <p className="mt-0.5 text-[0.65rem] text-muted-foreground/70">Operator console</p>
        </div>
      ) : null}
    </div>
  )
}

/** Desktop left rail — sticky, full-height under the top bar. */
export function AdminSidebar() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 border-r border-border/80 bg-sidebar md:block">
      <AdminNav variant="rail" />
    </aside>
  )
}
