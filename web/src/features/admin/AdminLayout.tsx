import { Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { isAuthenticated, clearApiKey } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/admin', label: 'Dashboard', exact: true },
  { to: '/admin/forwarding', label: 'Forwarding' },
  { to: '/admin/hosting', label: 'Hosting' },
  { to: '/admin/max-sessions', label: 'Max Sessions' },
  { to: '/admin/js-bridge', label: 'JsBridge' },
  { to: '/admin/session-policy', label: 'Session Policy' },
  { to: '/admin/script-injection', label: 'Script Injection' },
  { to: '/admin/scripts', label: 'Scripts' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/diagnostics', label: 'Diagnostics' },
  { to: '/admin/api-key', label: 'API Key' },
  { to: '/admin/openapi', label: 'OpenAPI' },
]

export default function AdminLayout() {
  const location = useLocation()
  if (!isAuthenticated()) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="w-full shrink-0 border-b border-border bg-card md:w-56 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between p-4 md:block">
          <div>
            <p className="text-xs tracking-widest text-muted-foreground">SPECULUM ADMIN</p>
            <Link to="/" className="text-sm text-primary hover:underline">← Motor</Link>
          </div>
          <Button variant="ghost" size="sm" className="md:mt-4" onClick={() => { clearApiKey(); window.location.href = '/admin/login' }}>
            Logout
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
          {NAV.map((item) => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-muted',
                  active && 'bg-muted text-foreground',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
