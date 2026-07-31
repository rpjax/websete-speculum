import { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { adminJson } from '@/lib/adminFetch'
import { clearAdminAuth, getAdminAuth } from '@/lib/adminAuth'
import { Button } from '@/components/ui/button'
import { AdminToastProvider } from './AdminToastContext'
import { AdminTopBar } from './AdminTopBar'
import { AdminNav, AdminSidebar } from './AdminSidebar'
import { CommandPalette } from './CommandPalette'

type Status = { operational?: boolean }

export function AdminShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [operational, setOperational] = useState<boolean | null>(null)
  const navigate = useNavigate()
  const username = getAdminAuth()?.username || 'Operator'

  useEffect(() => {
    const controller = new AbortController()
    adminJson<Status>('/api/configurations/status', { signal: controller.signal })
      .then((status) => setOperational(status.operational !== false))
      .catch(() => setOperational(null))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const signOut = () => {
    clearAdminAuth()
    navigate('/admin/login', { replace: true })
  }

  return (
    <AdminToastProvider>
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-background focus:p-2"
      >
        Skip to content
      </a>
      <div className="min-h-screen bg-background">
        <AdminTopBar
          username={username}
          navOpen={navOpen}
          onNavOpenChange={setNavOpen}
          onOpenPalette={() => setPaletteOpen(true)}
          onSignOut={signOut}
          nav={<AdminNav variant="sheet" onNavigate={() => setNavOpen(false)} />}
        />

        {operational === false ? (
          <div className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/5 px-4 py-2 text-sm">
            <span>This environment is not ready to start sessions.</span>
            <Button asChild size="sm" variant="outline">
              <Link to="/setup">Continue setup</Link>
            </Button>
          </div>
        ) : null}

        <div className="flex min-h-[calc(100vh-3.5rem)]">
          <AdminSidebar />
          <main id="admin-content" className="min-w-0 flex-1 p-4 md:px-6 md:py-5">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onSignOut={signOut} />
    </AdminToastProvider>
  )
}
