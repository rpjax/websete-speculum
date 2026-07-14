import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ScriptMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/admin/PageHeader'
import { EmptyState } from '@/components/admin/EmptyState'
import { ConfirmDestructive } from '@/components/admin/ConfirmDestructive'
import { SaveFeedbackStrip } from '@/components/admin/SaveFeedbackStrip'

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<ScriptMeta[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function load() {
    try {
      setScripts(await api.listScripts())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function upload() {
    if (!file) return
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await api.uploadScript(file, name || undefined)
      setFile(null)
      setName('')
      setMessage('Script uploaded')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setPending(false)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await api.deleteScript(id)
      setMessage('Script deleted')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Scripts"
        description="Upload injectable .js assets, then wire them in Script injection."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/script-injection">Script injection</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>Only .js files are accepted.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="file">File</Label>
            <Input id="file" type="file" accept=".js" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">Display name (optional)</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <SaveFeedbackStrip
            pending={pending}
            message={message}
            error={error}
            onSave={() => void upload()}
            saveLabel="Upload"
          />
        </CardContent>
      </Card>

      {scripts.length === 0 ? (
        <EmptyState
          title="No scripts stored"
          description="Upload a .js file to reference it from Script injection entries."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Size</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {scripts.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.name}</TableCell>
                <TableCell className="font-mono text-xs">{s.id}</TableCell>
                <TableCell>{s.size}</TableCell>
                <TableCell>
                  <ConfirmDestructive
                    title="Delete script?"
                    description="Injection entries that reference this script id will break until updated."
                    confirmLabel="Delete"
                    onConfirm={() => void remove(s.id)}
                    trigger={<Button size="sm" variant="destructive">Delete</Button>}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
