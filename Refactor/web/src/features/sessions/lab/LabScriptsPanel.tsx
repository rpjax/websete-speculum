import { useCallback, useEffect, useRef, useState } from 'react'
import { FileCode, Plus, Trash2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScriptTargetRulesEditor } from '@/features/sessions/lab/scripting/ScriptTargetRulesEditor'
import {
  deleteLabScript,
  listLabScripts,
  uploadLabScript,
  type LabScriptInjection,
  type LabScriptMeta,
  type LabScriptingConfig,
} from './labEngineConfig'

const POSITIONS = ['HeadStart', 'HeadEnd', 'BodyStart', 'BodyEnd'] as const
const EXECUTION_TYPES = ['Classic', 'Module'] as const

const POSITION_LABELS: Record<(typeof POSITIONS)[number], string> = {
  HeadStart: 'Head · top',
  HeadEnd: 'Head · bottom',
  BodyStart: 'Body · top',
  BodyEnd: 'Body · bottom',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function createMatchAllInjection(
  partial: Partial<LabScriptInjection> & Pick<LabScriptInjection, 'source'>,
): LabScriptInjection {
  return {
    position: 'HeadStart',
    executionType: 'Classic',
    targetRules: [
      {
        domain: { scope: 'Any', labels: [] },
        path: { scope: 'Any', matchType: 'Prefix', segments: [] },
      },
    ],
    ...partial,
  }
}

interface LabScriptsPanelProps {
  hubOrigin: string
  scripting: LabScriptingConfig
  busy: boolean
  onChange: (next: LabScriptingConfig) => void
}

/**
 * Lab Scripts — library CRUD via /api/scripts + injection editor (Save & apply).
 */
export function LabScriptsPanel({
  hubOrigin,
  scripting,
  busy,
  onChange,
}: LabScriptsPanelProps) {
  const [scripts, setScripts] = useState<LabScriptMeta[]>([])
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [addStoredId, setAddStoredId] = useState<string>('')
  const [addRemoteUrl, setAddRemoteUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)

  const loadLibrary = useCallback(async () => {
    const seq = ++loadSeq.current
    setLibraryBusy(true)
    setLibraryError(null)
    try {
      const page = await listLabScripts(hubOrigin)
      if (seq !== loadSeq.current) return
      setScripts(page.items)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setLibraryError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === loadSeq.current) setLibraryBusy(false)
    }
  }, [hubOrigin])

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  const scriptName = (id: string | null | undefined) => {
    if (!id) return 'missing script'
    return scripts.find((s) => s.id === id)?.name ?? `${id.slice(0, 8)}…`
  }

  const setInjections = (injections: LabScriptInjection[]) => {
    onChange({ injections })
  }

  const patchInjection = (index: number, next: LabScriptInjection) => {
    setInjections(scripting.injections.map((entry, i) => (i === index ? next : entry)))
  }

  const removeInjection = (index: number) => {
    setInjections(scripting.injections.filter((_, i) => i !== index))
    if (expanded === index) setExpanded(null)
  }

  const addStored = () => {
    if (!addStoredId) return
    setInjections([
      ...scripting.injections,
      createMatchAllInjection({
        source: {
          sourceType: 'Stored',
          storedScriptId: addStoredId,
          remoteUrl: null,
        },
      }),
    ])
    setAddStoredId('')
    setExpanded(scripting.injections.length)
  }

  const addRemote = () => {
    const url = addRemoteUrl.trim()
    if (!url) return
    setInjections([
      ...scripting.injections,
      createMatchAllInjection({
        source: {
          sourceType: 'Remote',
          storedScriptId: null,
          remoteUrl: url,
        },
      }),
    ])
    setAddRemoteUrl('')
    setExpanded(scripting.injections.length)
  }

  const upload = async () => {
    if (!file) {
      setLibraryError('Select a .js file to upload')
      return
    }
    setLibraryBusy(true)
    setLibraryError(null)
    try {
      const created = await uploadLabScript(hubOrigin, file, uploadName || undefined)
      setFile(null)
      setUploadName('')
      if (fileRef.current) fileRef.current.value = ''
      await loadLibrary()
      setAddStoredId(created.id)
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err))
    } finally {
      setLibraryBusy(false)
    }
  }

  const removeScript = async (id: string) => {
    setLibraryBusy(true)
    setLibraryError(null)
    try {
      await deleteLabScript(hubOrigin, id)
      if (addStoredId === id) setAddStoredId('')
      await loadLibrary()
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err))
    } finally {
      setLibraryBusy(false)
    }
  }

  const locked = libraryBusy || busy

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Upload a <code className="text-foreground">.js</code>, add an injection, then{' '}
        <span className="text-foreground">Save &amp; apply</span>. New sessions pick it up at launch.
      </p>

      <section className="space-y-2">
        <Label className="text-xs">Library</Label>

        <div className="space-y-2 rounded-md border border-border p-3">
          <Input
            ref={fileRef}
            type="file"
            accept=".js,text/javascript,application/javascript"
            disabled={locked}
            className="h-auto cursor-pointer py-1.5 file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null
              setFile(next)
              if (next) setUploadName((name) => name || next.name)
            }}
          />
          {file ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                className="h-8 min-w-0 flex-1 text-xs"
                placeholder="Name (optional)"
                value={uploadName}
                disabled={locked}
                onChange={(e) => setUploadName(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={locked}
                onClick={() => void upload()}
              >
                <Upload className="h-3.5 w-3.5" />
                Add to library
              </Button>
            </div>
          ) : null}
        </div>

        {scripts.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {libraryBusy ? 'Loading library…' : 'No stored scripts yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {scripts.map((script) => (
              <li key={script.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{script.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatSize(script.size)} · {script.id.slice(0, 8)}…
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={locked}
                  onClick={() => void removeScript(script.id)}
                  aria-label={`Delete ${script.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs">Injections</Label>
          <Badge variant={scripting.injections.length > 0 ? 'warning' : 'muted'} className="font-normal">
            {scripting.injections.length}
          </Badge>
        </div>

        {scripting.injections.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            None yet. Defaults to match-all <code className="text-foreground">* /</code>.
          </p>
        ) : (
          <ul className="space-y-2">
            {scripting.injections.map((injection, index) => {
              const open = expanded === index
              const label =
                injection.source.sourceType === 'Remote'
                  ? injection.source.remoteUrl || 'remote URL'
                  : scriptName(injection.source.storedScriptId)
              return (
                <li key={index} className="rounded-md border border-border">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40"
                    onClick={() => setExpanded(open ? null : index)}
                  >
                    <Badge variant="muted" className="font-normal">
                      {injection.source.sourceType}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {POSITION_LABELS[injection.position]}
                    </span>
                  </button>
                  {open ? (
                    <div className="space-y-3 border-t border-border px-3 py-3">
                      {injection.source.sourceType === 'Stored' ? (
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Stored script</Label>
                          {scripts.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                              Upload a script to the library to pick one.
                            </p>
                          ) : (
                            <Select
                              value={injection.source.storedScriptId || undefined}
                              onValueChange={(value) =>
                                patchInjection(index, {
                                  ...injection,
                                  source: {
                                    sourceType: 'Stored',
                                    storedScriptId: value,
                                    remoteUrl: null,
                                  },
                                })
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Select script" />
                              </SelectTrigger>
                              <SelectContent>
                                {scripts.map((script) => (
                                  <SelectItem key={script.id} value={script.id}>
                                    {script.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Remote URL</Label>
                          <Input
                            className="h-8 text-xs"
                            value={injection.source.remoteUrl ?? ''}
                            disabled={busy}
                            onChange={(e) =>
                              patchInjection(index, {
                                ...injection,
                                source: {
                                  sourceType: 'Remote',
                                  storedScriptId: null,
                                  remoteUrl: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Position</Label>
                          <Select
                            value={injection.position}
                            onValueChange={(value) =>
                              patchInjection(index, {
                                ...injection,
                                position: value as LabScriptInjection['position'],
                              })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {POSITIONS.map((position) => (
                                <SelectItem key={position} value={position}>
                                  {POSITION_LABELS[position]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Type</Label>
                          <Select
                            value={injection.executionType}
                            onValueChange={(value) =>
                              patchInjection(index, {
                                ...injection,
                                executionType: value as LabScriptInjection['executionType'],
                              })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {EXECUTION_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {type}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Where to inject</Label>
                        <ScriptTargetRulesEditor
                          idPrefix={`lab-inj-${index}`}
                          rules={injection.targetRules}
                          disabled={busy}
                          onChange={(targetRules) =>
                            patchInjection(index, { ...injection, targetRules })
                          }
                        />
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => removeInjection(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove injection
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        <div className="space-y-2 rounded-md border border-border p-3">
          {scripts.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-[11px]">Add stored</Label>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <Select value={addStoredId || undefined} onValueChange={setAddStoredId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Choose script…" />
                    </SelectTrigger>
                    <SelectContent>
                      {scripts.map((script) => (
                        <SelectItem key={script.id} value={script.id}>
                          {script.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  disabled={busy || !addStoredId}
                  onClick={addStored}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Upload a script above to add a stored injection.
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-[11px]">Add remote</Label>
            <div className="flex gap-2">
              <Input
                className="h-8 min-w-0 flex-1 text-xs"
                placeholder="https://…"
                value={addRemoteUrl}
                disabled={busy}
                onChange={(e) => setAddRemoteUrl(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                disabled={busy || !addRemoteUrl.trim()}
                onClick={addRemote}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </section>

      {libraryError ? (
        <p className="rounded-md border border-destructive/50 p-2 text-xs text-destructive">
          {libraryError}
        </p>
      ) : null}
    </div>
  )
}
