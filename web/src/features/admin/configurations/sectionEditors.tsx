import { type ReactNode } from 'react'
import { HostingEditor } from './HostingEditor'
import { JournalEditor } from './JournalEditor'
import { NavigationEditor } from './NavigationEditor'
import { ResourceManagementEditor } from './ResourceManagementEditor'
import { ScriptingHubFields } from './ScriptingHubFields'
import { SessionsEditor } from './SessionsEditor'
import { TelemetryEditor } from './TelemetryEditor'
import type { JsonObject } from './configFieldPrimitives'

export type { JsonObject } from './configFieldPrimitives'
export { text, nested } from './configFieldPrimitives'

export function SectionPrimaryFields({
  section,
  value,
  replace,
  update,
  onValidityChange,
}: {
  section: string
  value: JsonObject
  replace: (next: JsonObject) => void
  update: (path: string[], raw: string | boolean | number) => void
  onValidityChange?: (ok: boolean) => void
}): ReactNode {
  switch (section) {
    case 'Hosting':
      return <HostingEditor value={value} replace={replace} update={update} />
    case 'Navigation':
      return <NavigationEditor value={value} replace={replace} update={update} />
    case 'Sessions':
      return <SessionsEditor value={value} replace={replace} update={update} />
    case 'ResourceManagement':
      return <ResourceManagementEditor value={value} replace={replace} update={update} />
    case 'Scripting':
      return <ScriptingHubFields value={value} />
    case 'Journal':
      return (
        <JournalEditor value={value} replace={replace} onValidityChange={onValidityChange} />
      )
    case 'Telemetry':
      return <TelemetryEditor value={value} replace={replace} update={update} />
    default:
      return null
  }
}
