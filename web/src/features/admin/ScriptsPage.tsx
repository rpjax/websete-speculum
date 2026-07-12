import { useEffect, useState } from 'react'
import { api, type ScriptMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<ScriptMeta[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setScripts(await api.listScripts())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed')
    }
  }

  useEffect(() => { void load() }, [])

  async function upload() {
    if (!file) return
    setError(null)
    try {
      await api.uploadScript(file, name || undefined)
      setFile(null)
      setName('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteScript(id)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Scripts</h1>
      <Card>
        <CardHeader><CardTitle>Upload .js script</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input type="file" accept=".js" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Input placeholder="Optional name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={() => void upload()} disabled={!file}>Upload</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Stored scripts</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">ID</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scripts.map((s) => (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{s.name}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{s.id}</td>
                    <td className="py-2 pr-4">{s.size}</td>
                    <td className="py-2">
                      <Button variant="destructive" size="sm" onClick={() => void remove(s.id)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  )
}
