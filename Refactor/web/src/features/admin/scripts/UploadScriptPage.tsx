import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminFetch } from '@/lib/adminFetch'
import { HelperCallout, InlineValidation, PageHeader, SaveFeedback } from '@/features/admin/components'

const maxBytes = 524288
export function UploadScriptPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const returnUrl = params.get('returnUrl')
  const selectFile = (next: File | null) => {
    setFile(next); setError('')
    if (next && !name) setName(next.name.replace(/\.js$/i, ''))
  }
  const upload = async () => {
    if (!file) return setError('Choose a .js file.')
    if (!file.name.toLowerCase().endsWith('.js')) return setError('Choose a .js file.')
    if (file.size > maxBytes) return setError('Script file exceeds 524288 bytes.')
    if (!name.trim()) return setError('Name is required.')
    setPending(true); setError('')
    try {
      const data = new FormData(); data.append('file', file); data.append('name', name.trim())
      const response = await adminFetch('/api/scripts', { method: 'POST', body: data })
      if (!response.ok) throw new Error(`Upload failed (${response.status}).`)
      navigate(returnUrl?.startsWith('/admin/') ? returnUrl : '/admin/scripts?tab=library', { replace: true })
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not upload the script.') }
    finally { setPending(false) }
  }
  return <section className="mx-auto max-w-xl space-y-6"><PageHeader title="Upload script" description="Add a stored script to the library." />
    <HelperCallout title="Stored script">Classic or module scripts are stored as text. Max size 512 KB.</HelperCallout>
    <div className="space-y-2"><Label htmlFor="script-file">Script file</Label><Input id="script-file" type="file" accept=".js,application/javascript,text/javascript" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /><p className="text-sm text-muted-foreground">.js only, maximum 512 KB.</p></div>
    <div className="space-y-2"><Label htmlFor="script-name">Name</Label><Input id="script-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Shown in library and pickers" /></div>
    {error ? <><InlineValidation message={error} /><SaveFeedback mode="inline-error" message={error} /></> : null}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => navigate(returnUrl?.startsWith('/admin/') ? returnUrl : '/admin/scripts?tab=library')}>Cancel</Button><Button disabled={pending} onClick={() => void upload()}>{pending ? 'Uploading…' : 'Upload'}</Button></div>
  </section>
}
