import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ConfigSections, type ScriptMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/admin/PageHeader'
import { SaveFeedbackStrip } from '@/components/admin/SaveFeedbackStrip'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructive'
import { JsonTechnicalDetails } from '@/components/admin/JsonTechnicalDetails'
import { EmptyState } from '@/components/admin/EmptyState'

interface InjectionEntry {
  scriptId?: string | null
  url?: string | null
  position: string
  type: string
}

const POSITIONS = ['HeaderTop', 'HeaderBottom', 'BodyTop', 'BodyBottom']
const TYPES = ['Classic', 'Module']

export default function ScriptInjectionPage() {
  const [entries, setEntries] = useState<InjectionEntry[]>([])
  const [scripts, setScripts] = useState<ScriptMeta[]>([])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.listScripts().then(setScripts).catch(() => {})
    void api.getSection<InjectionEntry[]>(ConfigSections.ScriptInjection)
      .then((v) => setEntries(Array.isArray(v) ? v : []))
      .catch(() => setEntries([]))
  }, [])

  function update(index: number, patch: Partial<InjectionEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      { scriptId: scripts[0]?.id ?? null, url: null, position: 'HeaderTop', type: 'Classic' },
    ])
  }

  async function save() {
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      const body = entries.map((e) => ({
        scriptId: e.url ? null : e.scriptId || null,
        url: e.scriptId ? null : e.url || null,
        position: e.position,
        type: e.type,
      }))
      await api.putSection(ConfigSections.ScriptInjection, body)
      setMessage('Saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setPending(false)
    }
  }

  async function removeSection() {
    setPending(true)
    try {
      await api.deleteSection(ConfigSections.ScriptInjection)
      setEntries([])
      setMessage('Deleted')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Script injection"
        description="Add stored scripts or remote URLs into the remote page. Exactly one of script id or URL per entry."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/scripts">Manage scripts</Link>
          </Button>
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          title="No injection entries"
          description="Add an entry to inject a stored script or URL into motor pages."
          action={<Button onClick={addEntry}>Add entry</Button>}
        />
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <Card key={index}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Entry {index + 1}</CardTitle>
                <CardDescription>Choose a stored script or a URL — not both.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>Source</Label>
                  <Select
                    value={entry.url ? 'url' : 'script'}
                    onValueChange={(mode) =>
                      update(index, mode === 'url'
                        ? { url: entry.url || 'https://', scriptId: null }
                        : { scriptId: scripts[0]?.id ?? '', url: null })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="script">Stored script</SelectItem>
                      <SelectItem value="url">Remote URL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {entry.url != null ? (
                  <div className="space-y-1">
                    <Label>URL</Label>
                    <Input value={entry.url} onChange={(e) => update(index, { url: e.target.value, scriptId: null })} />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label>Script</Label>
                    <Select
                      value={entry.scriptId ?? ''}
                      onValueChange={(scriptId) => update(index, { scriptId, url: null })}
                    >
                      <SelectTrigger><SelectValue placeholder="Select script" /></SelectTrigger>
                      <SelectContent>
                        {scripts.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Position</Label>
                    <Select value={entry.position} onValueChange={(position) => update(index, { position })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Type</Label>
                    <Select value={entry.type} onValueChange={(type) => update(index, { type })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEntries((prev) => prev.filter((_, i) => i !== index))}>
                  Remove entry
                </Button>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" onClick={addEntry}>Add entry</Button>
        </div>
      )}

      <SaveFeedbackStrip
        pending={pending}
        message={message}
        error={error}
        onSave={() => void save()}
        secondary={
          <ConfirmDestructiveButton
            label="Clear all"
            size="sm"
            title="Clear script injection?"
            description="Deletes the entire ScriptInjection section."
            confirmLabel="Clear"
            onConfirm={() => void removeSection()}
          />
        }
      />

      <JsonTechnicalDetails data={entries} title="Technical details (JSON preview)" />
    </div>
  )
}
