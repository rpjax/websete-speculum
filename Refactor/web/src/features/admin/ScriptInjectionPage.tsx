import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ExternalLink,
  FileCode,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { api, ConfigSections, type ScriptMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { PageHeader } from '@/components/admin/PageHeader'
import { EmptyState } from '@/components/admin/EmptyState'
import { SaveFeedbackStrip } from '@/components/admin/SaveFeedbackStrip'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructive'
import { cn } from '@/lib/utils'

interface InjectionEntry {
  scriptId?: string | null
  url?: string | null
  position: string
  type: string
}

const POSITIONS = ['HeaderTop', 'HeaderBottom', 'BodyTop', 'BodyBottom'] as const
const TYPES = ['Classic', 'Module'] as const

const POSITION_LABELS: Record<string, string> = {
  HeaderTop: 'Head (top)',
  HeaderBottom: 'Head (bottom)',
  BodyTop: 'Body (top)',
  BodyBottom: 'Body (bottom)',
}

export default function ScriptInjectionPage() {
  const [entries, setEntries] = useState<InjectionEntry[]>([])
  const [scripts, setScripts] = useState<ScriptMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [scriptsList, section] = await Promise.all([
        api.listScripts().catch(() => [] as ScriptMeta[]),
        api.getSection<InjectionEntry[]>(ConfigSections.ScriptInjection).catch(() => []),
      ])
      setScripts(scriptsList)
      setEntries(Array.isArray(section) ? section : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function update(index: number, patch: Partial<InjectionEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  function moveEntry(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= entries.length) return
    setEntries((prev) => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    if (expandedEntry === index) setExpandedEntry(target)
    else if (expandedEntry === target) setExpandedEntry(index)
  }

  function addEntry() {
    const newEntry: InjectionEntry = {
      scriptId: scripts[0]?.id ?? null,
      url: null,
      position: 'HeaderTop',
      type: 'Classic',
    }
    setEntries((prev) => [...prev, newEntry])
    setExpandedEntry(entries.length)
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index))
    setExpandedEntry(null)
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
      setMessage('Script injection saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setPending(false)
    }
  }

  async function clearAll() {
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      await api.deleteSection(ConfigSections.ScriptInjection)
      setEntries([])
      setExpandedEntry(null)
      setMessage('Script injection cleared')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setPending(false)
    }
  }

  function getEntryLabel(entry: InjectionEntry): string {
    if (entry.url) return entry.url
    if (entry.scriptId) {
      const s = scripts.find((x) => x.id === entry.scriptId)
      return s?.name ?? entry.scriptId
    }
    return 'No source configured'
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Script injection"
        description="Inject scripts into motor pages. Each entry adds a stored asset or remote URL at a chosen position in the document."
        actions={
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/admin/scripts">
              <FileCode className="h-3.5 w-3.5" />
              Manage scripts
            </Link>
          </Button>
        }
      />

      {/* Position diagram */}
      <InjectionPositionDiagram entries={entries} getLabel={getEntryLabel} />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="No injection entries"
          description="Add scripts or remote URLs to inject into every motor page. Use the diagram above to understand where scripts appear."
          action={
            <Button size="sm" className="gap-1.5" onClick={addEntry}>
              <Plus className="h-3.5 w-3.5" />
              Add first entry
            </Button>
          }
        />
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-sm font-medium">Entries</h2>
              <p className="text-xs text-muted-foreground">
                Within the same position, entries run top to bottom. Use arrows to reorder.
              </p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
            </span>
          </div>

          <div className="space-y-1.5">
            {entries.map((entry, index) => {
              const isExpanded = expandedEntry === index
              const isUrl = !!entry.url
              const label = getEntryLabel(entry)

              return (
                <div
                  key={index}
                  className={cn(
                    'rounded-lg border border-border bg-card transition-colors',
                    isExpanded && 'ring-1 ring-ring',
                  )}
                >
                  {/* Summary row */}
                  <div className="flex items-center">
                    {/* Reorder controls */}
                    <div className="flex flex-col border-r border-border">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveEntry(index, -1)}
                        className="flex h-6 w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent rounded-tl-lg"
                        aria-label="Move up"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={index === entries.length - 1}
                        onClick={() => moveEntry(index, 1)}
                        className="flex h-6 w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent rounded-bl-lg"
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Clickable summary */}
                    <button
                      type="button"
                      onClick={() => setExpandedEntry(isExpanded ? null : index)}
                      className="flex flex-1 items-center gap-3 px-3 py-3 text-left min-w-0"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>

                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {isUrl
                          ? <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          : <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        }
                        <span className="truncate text-sm font-medium">{label}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="muted" className="text-[10px]">
                          {POSITION_LABELS[entry.position] ?? entry.position}
                        </Badge>
                        <Badge variant="muted" className="text-[10px]">
                          {entry.type}
                        </Badge>
                      </div>

                      <ChevronDown className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                        isExpanded && 'rotate-180',
                      )} />
                    </button>
                  </div>

                  {/* Expanded editor */}
                  {isExpanded && (
                    <div className="border-t border-border px-4 py-4 space-y-4">
                      <div className="space-y-2">
                        <Label>Source type</Label>
                        <Select
                          value={entry.url != null ? 'url' : 'script'}
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
                        <div className="space-y-2">
                          <Label htmlFor={`url-${index}`}>URL</Label>
                          <Input
                            id={`url-${index}`}
                            value={entry.url}
                            onChange={(e) => update(index, { url: e.target.value, scriptId: null })}
                            placeholder="https://cdn.example.com/script.js"
                          />
                          <p className="text-xs text-muted-foreground">
                            Loaded at runtime — ensure the URL is stable and trusted.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label>Script</Label>
                          <Select
                            value={entry.scriptId ?? ''}
                            onValueChange={(scriptId) => update(index, { scriptId, url: null })}
                          >
                            <SelectTrigger><SelectValue placeholder="Select script" /></SelectTrigger>
                            <SelectContent>
                              {scripts.length === 0 ? (
                                <SelectItem value="" disabled>No scripts uploaded</SelectItem>
                              ) : (
                                scripts.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                          {scripts.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              <Link to="/admin/scripts" className="text-primary underline">Upload a script</Link> first.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Position</Label>
                          <Select value={entry.position} onValueChange={(position) => update(index, { position })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {POSITIONS.map((p) => (
                                <SelectItem key={p} value={p}>{POSITION_LABELS[p]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Type</Label>
                          <Select value={entry.type} onValueChange={(type) => update(index, { type })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TYPES.map((t) => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeEntry(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => setExpandedEntry(null)}
                        >
                          Collapse
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <Button variant="outline" size="sm" className="gap-1.5" onClick={addEntry}>
            <Plus className="h-3.5 w-3.5" />
            Add entry
          </Button>
        </section>
      )}

      {!loading && entries.length > 0 && (
        <>
          <SaveFeedbackStrip
            pending={pending}
            message={message}
            error={error}
            onSave={() => void save()}
            saveLabel="Save injection"
          />

          <Separator />

          <Accordion type="single" collapsible>
            <AccordionItem value="danger" className="border-none">
              <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="h-3 w-3" />
                  Danger zone
                </span>
              </AccordionTrigger>
              <AccordionContent className="pt-2">
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Clears all injection entries. Motor pages will load without any injected scripts.
                  </p>
                  <ConfirmDestructiveButton
                    label="Clear all entries"
                    size="sm"
                    title="Clear script injection?"
                    description="Removes all injection entries. Motor pages will no longer include any injected scripts until new entries are saved."
                    confirmLabel="Clear all"
                    onConfirm={() => void clearAll()}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}

      {!loading && entries.length === 0 && (message || error) && (
        <div className="space-y-2">
          {message && <p className="text-sm text-success" role="status">{message}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}

/** Visual diagram showing injection positions in an HTML document. */
function InjectionPositionDiagram({
  entries,
  getLabel,
}: {
  entries: InjectionEntry[]
  getLabel: (e: InjectionEntry) => string
}) {
  const byPosition: Record<string, { label: string; index: number }[]> = {
    HeaderTop: [],
    HeaderBottom: [],
    BodyTop: [],
    BodyBottom: [],
  }

  entries.forEach((e, i) => {
    if (byPosition[e.position]) {
      byPosition[e.position].push({ label: getLabel(e), index: i })
    }
  })

  const hasEntries = entries.length > 0

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/60 bg-muted/20">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Document injection map
        </p>
      </div>

      <div className="p-4 font-mono text-xs leading-relaxed">
        {/* <html> */}
        <div className="text-muted-foreground/50">&lt;html&gt;</div>

        {/* <head> */}
        <div className="ml-4">
          <div className="text-muted-foreground/50">&lt;head&gt;</div>

          {/* HeaderTop slot */}
          <PositionSlot
            position="HeaderTop"
            entries={byPosition.HeaderTop}
            hasEntries={hasEntries}
          />

          <div className="ml-4 text-muted-foreground/30">… meta, title, styles …</div>

          {/* HeaderBottom slot */}
          <PositionSlot
            position="HeaderBottom"
            entries={byPosition.HeaderBottom}
            hasEntries={hasEntries}
          />

          <div className="text-muted-foreground/50">&lt;/head&gt;</div>
        </div>

        {/* <body> */}
        <div className="ml-4">
          <div className="text-muted-foreground/50">&lt;body&gt;</div>

          {/* BodyTop slot */}
          <PositionSlot
            position="BodyTop"
            entries={byPosition.BodyTop}
            hasEntries={hasEntries}
          />

          <div className="ml-4 text-muted-foreground/30">… page content …</div>

          {/* BodyBottom slot */}
          <PositionSlot
            position="BodyBottom"
            entries={byPosition.BodyBottom}
            hasEntries={hasEntries}
          />

          <div className="text-muted-foreground/50">&lt;/body&gt;</div>
        </div>

        <div className="text-muted-foreground/50">&lt;/html&gt;</div>
      </div>
    </div>
  )
}

function PositionSlot({
  position,
  entries,
  hasEntries,
}: {
  position: string
  entries: { label: string; index: number }[]
  hasEntries: boolean
}) {
  const label = POSITION_LABELS[position] ?? position

  if (entries.length === 0) {
    if (!hasEntries) return null
    return (
      <div className="ml-4 my-0.5 flex items-center gap-2 rounded border border-dashed border-border/40 px-2 py-1">
        <span className="text-muted-foreground/40">{label}</span>
        <span className="text-muted-foreground/30">— empty</span>
      </div>
    )
  }

  return (
    <div className="ml-4 my-0.5 space-y-0.5">
      {entries.map((e) => (
        <div key={e.index} className="flex items-center gap-2 rounded border border-primary/20 bg-primary/5 px-2 py-1">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary tabular-nums">
            {e.index + 1}
          </span>
          <span className="text-primary/80 truncate">{e.label}</span>
          <Badge variant="muted" className="ml-auto text-[9px] shrink-0">{label}</Badge>
        </div>
      ))}
    </div>
  )
}
