import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { adminFetch, adminJson } from '@/lib/adminFetch'
import { ConfirmDestructive, DataCard, EmptyState, MetaRow, SaveFeedback, SearchFilter } from '@/features/admin/components'
import type { ScriptList, ScriptMeta } from './scriptTypes'

const date = (value?: string) => value ? new Date(value).toLocaleString() : '—'
const bytes = (value: number) => `${new Intl.NumberFormat().format(value)} bytes`

export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('query') ?? ''
  const [scripts, setScripts] = useState<ScriptMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<ScriptMeta | null>(null)
  const [pending, setPending] = useState(false)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const search = new URLSearchParams({ take: '50' })
      if (query) search.set('query', query)
      const result = await adminJson<ScriptList>(`/api/scripts?${search}`)
      setScripts(result.items)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the script library.') }
    finally { setLoading(false) }
  }, [query])
  useEffect(() => { void load() }, [load])
  const setQuery = (value: string) => setParams(value ? { tab: 'library', query: value } : { tab: 'library' })
  const deleteScript = async () => {
    if (!deleting) return
    setPending(true); setError('')
    try {
      const response = await adminFetch(`/api/scripts/${deleting.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`Could not delete the script (${response.status}).`)
      setDeleting(null); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete the script.') }
    finally { setPending(false) }
  }
  return <section className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button asChild><Link to="/admin/scripts/upload"><Upload className="h-4 w-4" />Upload script</Link></Button>
      <SearchFilter value={query} onChange={setQuery} placeholder="Search scripts" />
    </div>
    {error ? <SaveFeedback mode="inline-error" message={error} /> : null}
    {loading ? <p className="text-sm text-muted-foreground">Loading script library…</p> : scripts.length === 0
      ? <EmptyState title="No scripts in the library" body="Upload a .js file to use as a stored injection source." cta={{ label: 'Upload script', href: '/admin/scripts/upload' }} />
      : <DataCard><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Size</TableHead><TableHead>Updated</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{scripts.map((script) => <TableRow key={script.id}><TableCell><p className="font-medium">{script.name}</p><MetaRow className="mt-1 text-xs text-muted-foreground"><span>SHA-256</span><code className="font-mono">{script.sha256}</code></MetaRow></TableCell><TableCell className="whitespace-nowrap text-sm text-muted-foreground">{bytes(script.size)}</TableCell><TableCell className="whitespace-nowrap text-sm text-muted-foreground">{date(script.updatedAt ?? script.uploadedAt)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setDeleting(script)}><Trash2 className="h-4 w-4" />Delete</Button></TableCell></TableRow>)}</TableBody></Table></DataCard>}
    <ConfirmDestructive open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title={deleting ? `Delete “${deleting.name}”?` : 'Delete script?'} body="Injections that reference it will fail apply until updated." confirmLabel="Delete" onConfirm={() => void deleteScript()} submitting={pending} />
  </section>
}
