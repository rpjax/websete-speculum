import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { adminJson } from '@/lib/adminFetch'
import { ConfirmDestructive, PageHeader, StepWizard } from '@/features/admin/components'
import { normaliseSection, newInjection, type Injection, type ScriptList, type ScriptingSection } from '../scriptTypes'
import { PlacementStep } from './PlacementStep'
import { ReviewApplyStep } from './ReviewApplyStep'
import { SourceStep } from './SourceStep'
import { TargetsStep } from './TargetsStep'

const steps = [{ id: 'source', title: 'Source' }, { id: 'placement', title: 'Placement' }, { id: 'targets', title: 'Targets' }, { id: 'review', title: 'Review' }]
const clone = <T,>(value: T): T => structuredClone(value)
export function InjectionFlow() {
  const navigate = useNavigate()
  const location = useLocation()
  const { index: rawIndex } = useParams()
  const editing = rawIndex !== undefined
  const index = Number(rawIndex)
  const [params, setParams] = useSearchParams()
  const stepId = steps.some((step) => step.id === params.get('step')) ? params.get('step')! : 'source'
  const step = steps.findIndex((item) => item.id === stepId)
  const key = `speculum:injection-draft:${editing ? rawIndex : 'new'}`
  const [draft, setDraft] = useState<Injection | null>(null)
  const [entry, setEntry] = useState<Injection | null>(null)
  const [scripts, setScripts] = useState<ScriptList['items']>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  useEffect(() => {
    let active = true
    const initialise = async () => {
      const saved = sessionStorage.getItem(key)
      if (saved) { try { if (active) setDraft(JSON.parse(saved) as Injection); return } catch { sessionStorage.removeItem(key) } }
      if (!editing) { if (active) { const initial = newInjection(); setDraft(initial); setEntry(clone(initial)) }; return }
      try {
        const section = normaliseSection(await adminJson('/api/configurations/Scripting'))
        const existing = section.injections[index]
        if (!existing) throw new Error('This injection no longer exists.')
        if (active) { setDraft(clone(existing)); setEntry(clone(existing)) }
      } catch (err) { if (active) { setError(err instanceof Error ? err.message : 'Could not load injection.'); navigate('/w7s/admin/scripts?tab=injections', { replace: true }) } }
    }
    void initialise(); return () => { active = false }
  }, [editing, index, key, navigate])
  useEffect(() => { void adminJson<ScriptList>('/api/scripts?take=200').then((value) => setScripts(value.items)).catch(() => {}) }, [])
  const change = (next: Injection) => { setDraft(next); sessionStorage.setItem(key, JSON.stringify(next)) }
  const dirty = useMemo(() => Boolean(draft && entry && JSON.stringify(draft) !== JSON.stringify(entry)), [draft, entry])
  const go = (target: number) => setParams({ step: steps[target]!.id })
  const valid = !draft ? false : stepId === 'source'
    ? draft.source.sourceType === 'stored' ? Boolean(draft.source.storedScriptId) : /^https?:\/\/.+/i.test(draft.source.remoteUrl ?? '')
    : stepId === 'targets' ? draft.targetRules.length > 0 : true
  const abandon = () => { if (dirty) setConfirmAbandon(true); else { sessionStorage.removeItem(key); navigate('/w7s/admin/scripts?tab=injections') } }
  const apply = async () => {
    if (!draft) return
    setPending(true); setError('')
    try {
      const current = normaliseSection(await adminJson('/api/configurations/Scripting'))
      const injections = [...current.injections]
      if (editing) { if (!injections[index]) throw new Error('This injection no longer exists.'); injections[index] = draft } else injections.push(draft)
      const body: ScriptingSection = { ...current, injections }
      await adminJson('/api/configurations/Scripting', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      sessionStorage.removeItem(key); navigate('/w7s/admin/scripts?tab=injections')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not apply Scripting configuration.') }
    finally { setPending(false) }
  }
  if (!draft) return <p className="text-sm text-muted-foreground">Loading injection draft…</p>
  return <section className="mx-auto max-w-3xl space-y-6"><PageHeader title={editing ? 'Edit injection' : 'Add injection'} description="Configure one Scripting injection at a time." />
    <StepWizard steps={steps} currentIndex={step} onBack={step > 0 ? () => go(step - 1) : undefined} onContinue={step < steps.length - 1 ? () => go(step + 1) : undefined} continueDisabled={!valid} allowAbandon onAbandon={abandon}>
      {stepId === 'source' ? <SourceStep draft={draft} onChange={change} returnUrl={`${location.pathname}?step=source`} /> : null}
      {stepId === 'placement' ? <PlacementStep draft={draft} onChange={change} /> : null}
      {stepId === 'targets' ? <TargetsStep draft={draft} onChange={change} /> : null}
      {stepId === 'review' ? <ReviewApplyStep draft={draft} scripts={scripts} pending={pending} error={error} onApply={() => void apply()} /> : null}
    </StepWizard>
    <ConfirmDestructive open={confirmAbandon} onOpenChange={setConfirmAbandon} title="Discard injection changes?" body="Your edits will be lost." confirmLabel="Discard" onConfirm={() => { sessionStorage.removeItem(key); navigate('/w7s/admin/scripts?tab=injections') }} />
  </section>
}
