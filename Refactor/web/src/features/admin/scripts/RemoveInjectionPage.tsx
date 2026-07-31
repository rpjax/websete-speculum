import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { adminJson } from '@/lib/adminFetch'
import { ConfirmDestructive, PageHeader, SaveFeedback } from '@/features/admin/components'
import { normaliseSection, rulesSummary, sourceSummary, type Injection, type ScriptingSection } from './scriptTypes'

export function RemoveInjectionPage() {
  const navigate = useNavigate()
  const { index: rawIndex } = useParams()
  const index = Number(rawIndex)
  const [section, setSection] = useState<ScriptingSection | null>(null)
  const [injection, setInjection] = useState<Injection | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => { void adminJson('/api/configurations/Scripting').then((value) => { const loaded = normaliseSection(value); const item = loaded.injections[index]; if (!item) { setError('This injection no longer exists.'); return } setSection(loaded); setInjection(item) }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load Scripting configuration.')) }, [index])
  const remove = async () => {
    if (!section || !injection) return
    setPending(true); setError('')
    try {
      await adminJson('/api/configurations/Scripting', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...section, injections: section.injections.filter((_, itemIndex) => itemIndex !== index) }) })
      navigate('/admin/scripts?tab=injections')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not apply Scripting configuration.') }
    finally { setPending(false) }
  }
  if (error && !injection) return <section className="space-y-4"><SaveFeedback mode="banner-error" message={error} /><Button onClick={() => navigate('/admin/scripts?tab=injections')}>Back to injections</Button></section>
  if (!injection) return <p className="text-sm text-muted-foreground">Loading injection…</p>
  return <section className="mx-auto max-w-2xl space-y-6"><PageHeader title="Remove injection" description="This updates Scripting configuration. Matching pages will no longer receive this script." />
    <Card><CardHeader><CardTitle className="text-base">Injection summary</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{sourceSummary(injection)}</p><p>{injection.position} · {injection.executionType}</p><p className="text-muted-foreground">{rulesSummary(injection.targetRules)}</p></CardContent></Card>
    {error ? <SaveFeedback mode="inline-error" message={error} /> : null}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => navigate('/admin/scripts?tab=injections')}>Cancel</Button><Button variant="destructive" onClick={() => setOpen(true)}>Remove and apply</Button></div>
    <ConfirmDestructive open={open} onOpenChange={setOpen} title="Remove injection?" body="This updates Scripting configuration. Matching pages will no longer receive this script." confirmLabel="Remove and apply" onConfirm={() => void remove()} submitting={pending} />
  </section>
}
