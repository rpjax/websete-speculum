import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { DataCard, HelperCallout } from '@/features/admin/components'
import type { JsonObject } from './configFieldPrimitives'

/** Scripting on the configurations route is a hub — CRUD lives under Scripts. */
export function ScriptingHubFields({ value }: { value: JsonObject }) {
  const injections = Array.isArray(value.injections) ? value.injections : []
  return (
    <div className="space-y-4">
      <HelperCallout
        title="Manage injections in Scripts"
        action={{ label: 'Open injections', href: '/w7s/admin/scripts?tab=injections' }}
      >
        Injection rules have a safer focused flow. This section currently has {injections.length} injection
        {injections.length === 1 ? '' : 's'}.
      </HelperCallout>
      <DataCard className="p-4">
        <p className="text-sm font-medium">What belongs here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use Scripts library and the injection wizard for add/edit/remove. This configuration section is a hub
          link — not a JSON editor.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild size="sm" className="w-full sm:w-auto">
            <Link to="/w7s/admin/scripts?tab=injections">Open injections</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
            <Link to="/w7s/admin/scripts?tab=library">Open library</Link>
          </Button>
        </div>
      </DataCard>
    </div>
  )
}
