import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  FileCode,
  Hash,
  Plus,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { api, type ScriptMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageHeader } from '@/components/admin/PageHeader'
import { EmptyState } from '@/components/admin/EmptyState'
import { ConfirmDestructive } from '@/components/admin/ConfirmDestructive'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<ScriptMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setScripts(await api.listScripts())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load scripts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function upload() {
    if (!file) {
      setError('Select a .js file to upload')
      return
    }
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await api.uploadScript(file, name || undefined)
      setFile(null)
      setName('')
      if (fileRef.current) fileRef.current.value = ''
      setMessage('Script uploaded successfully')
      setShowUpload(false)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setPending(false)
    }
  }

  async function remove(id: string, scriptName: string) {
    setError(null)
    setMessage(null)
    try {
      await api.deleteScript(id)
      setMessage(`"${scriptName}" deleted`)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Scripts"
        description="Injectable .js assets for motor sessions. Upload here, then wire them in Script injection."
        actions={
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/admin/script-injection">
              <Settings2 className="h-3.5 w-3.5" />
              Script injection
            </Link>
          </Button>
        }
      />

      {/* Feedback strip */}
      {message && (
        <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2">
          <p className="text-sm text-success" role="status">{message}</p>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive" role="alert">{error}</p>
        </div>
      )}

      {/* Upload section */}
      {showUpload ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-muted-foreground" />
              Upload script
            </CardTitle>
            <CardDescription>
              Only <code className="rounded bg-muted px-1 text-xs">.js</code> files are accepted. Max size depends on server config.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="script-file">JavaScript file</Label>
              <Input
                ref={fileRef}
                id="script-file"
                type="file"
                accept=".js"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs file:font-medium file:text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="script-name">Display name</Label>
              <Input
                id="script-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional — defaults to filename"
              />
              <p className="text-xs text-muted-foreground">
                A human-friendly label shown in the library and injection config.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void upload()} disabled={pending || !file} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                {pending ? 'Uploading…' : 'Upload script'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowUpload(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => { setShowUpload(true); setMessage(null) }}
        >
          <Plus className="h-3.5 w-3.5" />
          Upload new script
        </Button>
      )}

      <Separator />

      {/* Script library */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Script library</h2>
          <span className="text-xs text-muted-foreground">
            {scripts.length} script{scripts.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : scripts.length === 0 ? (
          <EmptyState
            title="No scripts uploaded"
            description="Upload a .js file to make it available for injection into motor sessions."
            action={
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowUpload(true)}>
                <Plus className="h-3.5 w-3.5" />
                Upload first script
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {scripts.map((s) => (
              <div
                key={s.id}
                className="group rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/50">
                      <FileCode className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Badge variant="muted" className="font-mono text-[10px]">{s.id}</Badge>
                        </span>
                        <span>{formatSize(s.size)}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(s.uploadedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="rounded-sm p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label="Copy SHA-256"
                          onClick={() => void navigator.clipboard.writeText(s.sha256)}
                        >
                          <Hash className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        Copy SHA-256: {s.sha256.slice(0, 16)}…
                      </TooltipContent>
                    </Tooltip>

                    <ConfirmDestructive
                      title={`Delete "${s.name}"?`}
                      description="Injection entries referencing this script ID will break until reconfigured."
                      confirmLabel="Delete"
                      onConfirm={() => void remove(s.id, s.name)}
                      trigger={
                        <button
                          type="button"
                          className="rounded-sm p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Delete ${s.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
