import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RevealPanel, SaveFeedback } from '@/features/admin/components'
import { rulesSummary, sourceSummary, type Injection, type ScriptMeta } from '../scriptTypes'

export function ReviewApplyStep({ draft, scripts, pending, error, onApply }: { draft: Injection; scripts: ScriptMeta[]; pending: boolean; error: string; onApply: () => void }) {
  return <div className="space-y-5"><div><h2 className="text-lg font-semibold">Review</h2><p className="text-sm text-muted-foreground">Confirm the injection before applying the Scripting configuration.</p></div>
    <Card><CardHeader><CardTitle className="text-base">Injection summary</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm"><div><p className="text-muted-foreground">Source</p><p>{sourceSummary(draft, scripts)}</p></div><div><p className="text-muted-foreground">Placement</p><p>{draft.position} · {draft.executionType}</p></div><div><p className="text-muted-foreground">Rules</p><p>{rulesSummary(draft.targetRules)}</p></div></CardContent></Card>
    {error ? <SaveFeedback mode="inline-error" message={error} /> : null}
    <RevealPanel title="View JSON"><pre className="overflow-auto text-xs">{JSON.stringify(draft, null, 2)}</pre></RevealPanel>
    <div className="flex justify-end"><Button disabled={pending} onClick={onApply}>{pending ? 'Applying…' : 'Apply injection'}</Button></div>
  </div>
}
