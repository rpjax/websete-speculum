import { useState } from 'react'
import { Navigate, Outlet, Link, useLocation, NavLink } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { isAuthenticated, clearApiKey } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  end?: boolean
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', end: true },
      { to: '/admin/diagnostics', label: 'Diagnostics' },
    ],
  },
  {
    title: 'Sessions',
    items: [{ to: '/admin/sessions', label: 'Browser sessions' }],
  },
  {
    title: 'Edge & site',
    items: [
      { to: '/admin/hosting', label: 'Hosting' },
      { to: '/admin/forwarding', label: 'Forwarding' },
    ],
  },
  {
    title: 'Capacity',
    items: [{ to: '/admin/capacity', label: 'Capacity & bridges' }],
  },
  {
    title: 'Automation',
    items: [
      { to: '/admin/scripts', label: 'Scripts' },
      { to: '/admin/script-injection', label: 'Script injection' },
    ],
  },
  {
    title: 'Advanced',
    items: [
      { to: '/admin/api-key', label: 'API key' },
      { to: '/admin/openapi', label: 'OpenAPI' },
    ],
  },
]

function NavBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-4">
        <p className="text-xs tracking-widest text-muted-foreground">SPECULUM ADMIN</p>
        <Link to="/" className="text-sm text-primary hover:underline" onClick={onNavigate}>
          ← Motor
        </Link>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-3 py-2 text-sm hover:bg-muted',
                      isActive && 'bg-muted text-foreground',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <Separator />
      <div className="p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            clearApiKey()
            window.location.href = '/admin/login'
          }}
        >
          Log out
        </Button>
      </div>
    </div>
  )
}

export default function AdminLayout() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!isAuthenticated()) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar md:block">
        <NavBody />
      </aside>

      <div className="flex items-center justify-between border-b border-border bg-card p-3 md:hidden">
        <p className="text-xs tracking-widest text-muted-foreground">SPECULUM ADMIN</p>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open navigation">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Admin navigation</SheetTitle>
            </SheetHeader>
            <NavBody onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
