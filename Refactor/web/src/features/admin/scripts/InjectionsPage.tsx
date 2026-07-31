import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { adminJson } from '@/lib/adminFetch'
import { DataCard, EmptyState, MetaRow, SaveFeedback, StatusPill } from '@/features/admin/components'
import { normaliseSection, rulesSummary, sourceSummary, type ScriptingSection } from './scriptTypes'

const pretty = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
export function InjectionsPage() {
  const [section, setSection] = useState<ScriptingSection | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try { setSection(normaliseSection(await adminJson('/api/configurations/Scripting'))) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load Scripting configuration.') }
  }, [])
  useEffect(() => { void load() }, [load])
  if (error) return <section className="space-y-4"><SaveFeedback mode="banner-error" message={error} /><Button variant="outline" onClick={() => void load()}>Reload section</Button></section>
  if (!section) return <p className="text-sm text-muted-foreground">Loading Scripting configuration…</p>
  return <section className="space-y-4"><div className="flex justify-end"><Button asChild><Link to="/admin/scripts/injections/new"><Plus className="h-4 w-4" />Add injection</Link></Button></div>
    {section.injections.length === 0 ? <EmptyState title="No injections configured" body="Injections attach stored or remote scripts to matching pages at session launch." cta={{ label: 'Add injection', href: '/admin/scripts/injections/new' }} />
      : <div className="grid gap-3">{section.injections.map((injection, index) => <DataCard key={index} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-medium">{sourceSummary(injection)}</p><MetaRow className="mt-1 text-xs text-muted-foreground"><span>{pretty(injection.position)}</span><span>•</span><span>{pretty(injection.executionType)}</span><StatusPill label={rulesSummary(injection.targetRules)} tone="info" /></MetaRow></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" asChild><Link to={`/admin/scripts/injections/${index}/edit?step=source`}>Edit</Link></Button><Button size="sm" variant="outline" asChild><Link to={`/admin/scripts/injections/${index}/remove`}>Remove</Link></Button></div></div></DataCard>)}</div>}
  </section>
}
