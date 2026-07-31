import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { adminJson } from '@/lib/adminFetch'
import { HelperCallout, InlineValidation } from '@/features/admin/components'
import type { Injection, ScriptList } from '../scriptTypes'

export function SourceStep({ draft, onChange, returnUrl }: { draft: Injection; onChange: (next: Injection) => void; returnUrl: string }) {
  const [scripts, setScripts] = useState<ScriptList['items']>([])
  useEffect(() => { void adminJson<ScriptList>('/api/scripts?take=200').then((result) => setScripts(result.items)).catch(() => setScripts([])) }, [])
  const source = draft.source
  const validUrl = source.sourceType !== 'remote' || /^https?:\/\/.+/i.test(source.remoteUrl ?? '')
  return <div className="space-y-5"><div><h2 className="text-lg font-semibold">Source</h2><p className="text-sm text-muted-foreground">Choose the script to attach at session start.</p></div>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">Source type</legend><label className="mr-5 inline-flex items-center gap-2"><input type="radio" checked={source.sourceType === 'stored'} onChange={() => onChange({ ...draft, source: { sourceType: 'stored', storedScriptId: null, remoteUrl: null } })} />Stored</label><label className="inline-flex items-center gap-2"><input type="radio" checked={source.sourceType === 'remote'} onChange={() => onChange({ ...draft, source: { sourceType: 'remote', storedScriptId: null, remoteUrl: null } })} />Remote</label></fieldset>
    {source.sourceType === 'stored' ? <div className="space-y-2"><Label>Stored script</Label>{scripts.length ? <Select value={source.storedScriptId ?? ''} onValueChange={(storedScriptId) => onChange({ ...draft, source: { ...source, storedScriptId } })}><SelectTrigger><SelectValue placeholder="Pick from library" /></SelectTrigger><SelectContent>{scripts.map((script) => <SelectItem key={script.id} value={script.id}>{script.name}</SelectItem>)}</SelectContent></Select> : <HelperCallout title="Library is empty" action={{ label: 'Upload first', href: `/admin/scripts/upload?returnUrl=${encodeURIComponent(returnUrl)}` }}>Upload a .js file before using it as a stored source.</HelperCallout>}<p className="text-sm text-muted-foreground">Content is snapshotted from the library at session start.</p></div>
      : <div className="space-y-2"><Label htmlFor="remote-url">URL</Label><Input id="remote-url" type="url" value={source.remoteUrl ?? ''} placeholder="https://…" onChange={(event) => onChange({ ...draft, source: { ...source, remoteUrl: event.target.value } })} /><InlineValidation message={validUrl ? undefined : 'Enter an absolute http(s) URL.'} /><HelperCallout> The browser loads this URL as script src. Private/loopback hosts are rejected on apply.</HelperCallout></div>}
  </div>
}
