import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GuidedPreset, HelperCallout, InlineValidation, StatusPill } from '@/features/admin/components'
import {
  buildUrlMatchRule,
  describeUrlMatchRule,
  ruleHostField,
  rulePathExact,
  rulePathField,
} from '@/features/admin/configurations/urlMatchRules'
import { matchAllRule, type Injection, type TargetRule } from '../scriptTypes'

export function TargetsStep({ draft, onChange }: { draft: Injection; onChange: (next: Injection) => void }) {
  const rules = draft.targetRules
  const change = (next: TargetRule[]) => onChange({ ...draft, targetRules: next })
  const [draftHost, setDraftHost] = useState('')
  const [draftPath, setDraftPath] = useState('/')
  const [draftExact, setDraftExact] = useState(false)
  const patch = (index: number, host: string, path: string, exact: boolean) =>
    change(rules.map((rule, itemIndex) => itemIndex === index ? buildUrlMatchRule(host, path, exact) : rule))
  const addDraft = () => {
    if (!draftHost.trim()) return
    change([...rules, buildUrlMatchRule(draftHost, draftPath, draftExact)])
    setDraftHost('')
    setDraftPath('/')
    setDraftExact(false)
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-lg font-semibold">Targets</h2><p className="text-sm text-muted-foreground">Choose the hosts and paths that receive this injection.</p></div>
      <StatusPill label={rules.length ? `${rules.length} rule${rules.length === 1 ? '' : 's'}` : 'Rules required'} tone={rules.length ? 'success' : 'warning'} />
    </div>
    <GuidedPreset presets={[
      { id: 'all', label: 'Match all pages', apply: () => change([matchAllRule()]) },
      { id: 'clear', label: 'Clear rules', apply: () => change([]) },
    ]} />
    <HelperCallout tone={rules.length ? 'info' : 'warning'} title="How targeting works">
      Leave Path as <code>/</code> to match every path on a host. Enable Exact path only when subpaths must not match.
    </HelperCallout>
    {!rules.length ? <InlineValidation message="Add at least one target rule before continuing." /> : null}
    {rules.length ? <ul className="space-y-2">{rules.map((rule, index) => {
      const host = ruleHostField(rule)
      const path = rulePathField(rule)
      const exact = rulePathExact(rule)
      return <li key={`${host}-${path}-${index}`} className="rounded-lg border border-border bg-background/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">Rule {index + 1}<span className="ml-2 font-normal text-foreground/80">{describeUrlMatchRule(rule)}</span></p>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Remove rule ${index + 1}`} onClick={() => change(rules.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_auto]">
          <div className="space-y-1.5"><Label htmlFor={`target-host-${index}`}>Host</Label><Input id={`target-host-${index}`} className="font-mono text-xs" value={host === '*' ? '' : host} placeholder="example.com or *.example.com" onChange={(event) => patch(index, event.target.value || '*', path, exact)} /></div>
          <div className="space-y-1.5"><Label htmlFor={`target-path-${index}`}>Path</Label><Input id={`target-path-${index}`} className="font-mono text-xs" value={path} placeholder="/" onChange={(event) => patch(index, host, event.target.value || '/', exact)} /></div>
          <label className="flex items-center gap-2 self-end pb-2 text-xs text-muted-foreground"><Checkbox checked={exact} onCheckedChange={(checked) => patch(index, host, path, checked === true)} />Exact path</label>
        </div>
      </li>
    })}</ul> : null}
    <div className="rounded-lg border border-dashed border-border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Add target rule</p>
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_auto_auto]">
        <div className="space-y-1.5"><Label htmlFor="target-draft-host">Host</Label><Input id="target-draft-host" className="font-mono text-xs" value={draftHost} placeholder="example.com or *.example.com" onChange={(event) => setDraftHost(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="target-draft-path">Path</Label><Input id="target-draft-path" className="font-mono text-xs" value={draftPath} placeholder="/" onChange={(event) => setDraftPath(event.target.value)} /></div>
        <label className="flex items-center gap-2 self-end pb-2 text-xs text-muted-foreground"><Checkbox checked={draftExact} onCheckedChange={(checked) => setDraftExact(checked === true)} />Exact path</label>
        <Button type="button" size="sm" variant="outline" className="self-end" disabled={!draftHost.trim()} onClick={addDraft}><Plus className="h-4 w-4" />Add</Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Host accepts <code>example.com</code> or <code>*.example.com</code>; <code>/</code> matches any path.</p>
    </div>
  </div>
}
