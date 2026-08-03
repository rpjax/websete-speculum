import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/features/admin/components'

export function ScriptsLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = new URLSearchParams(location.search).get('tab') === 'injections' ? 'injections' : 'library'
  if (location.pathname !== '/w7s/admin/scripts') return <Outlet />
  return <div className="space-y-6">
    <PageHeader title="Scripts" description="Manage stored scripts and where they are injected." />
    <Tabs value={active} onValueChange={(tab) => navigate(`/w7s/admin/scripts?tab=${tab}`)}>
      <TabsList aria-label="Scripts sections">
        <TabsTrigger value="library">Library</TabsTrigger>
        <TabsTrigger value="injections">Injections</TabsTrigger>
      </TabsList>
    </Tabs>
    <Outlet />
    <noscript><Link to="/w7s/admin/scripts?tab=library">Library</Link></noscript>
  </div>
}
