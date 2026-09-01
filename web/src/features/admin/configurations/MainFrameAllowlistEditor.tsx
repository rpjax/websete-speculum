import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  GuidedPreset,
  HelperCallout,
  InlineValidation,
  StatusPill,
  SwitchField,
} from '@/features/admin/components'
import {
  allowHostAnyPath,
  buildUrlMatchRuleFromModes,
  createMatchAllUrlRule,
  describeUrlMatchRule,
  hostEditValue,
  hostMatchMode,
  isBareHost,
  isMatchAllUrlRules,
  normalizeUrlMatchRules,
  pathMatchMode,
  rulePathField,
  type HostMatchMode,
  type PathMatchMode,
  type UrlMatchRule,
} from './urlMatchRules'

export function MainFrameAllowlistEditor({
  defaultHost,
  rules: rawRules,
  onChange,
}: {
  defaultHost: string
  rules: unknown
  onChange: (rules: UrlMatchRule[]) => void
}) {
  const rules = normalizeUrlMatchRules(rawRules)
  const matchAll = isMatchAllUrlRules(rules)
  const canPresetDefault = isBareHost(defaultHost)
  const [draftHostMode, setDraftHostMode] = useState<HostMatchMode>('exact')
  const [draftHost, setDraftHost] = useState(canPresetDefault ? defaultHost : '')
  const [draftPathMode, setDraftPathMode] = useState<PathMatchMode>('any')
  const [draftPath, setDraftPath] = useState('/')

  const setMatchAll = (everywhere: boolean) => {
    if (everywhere) {
      onChange([createMatchAllUrlRule()])
      return
    }
    if (matchAll) {
      onChange([
        canPresetDefault
          ? allowHostAnyPath(defaultHost)
          : buildUrlMatchRuleFromModes('exact', 'example.com', 'any', '/'),
      ])
    }
  }

  const patchModes = (
    index: number,
    hostMode: HostMatchMode,
    hostValue: string,
    pathMode: PathMatchMode,
    pathValue: string,
  ) => {
    onChange(
      rules.map((rule, i) =>
        i === index ? buildUrlMatchRuleFromModes(hostMode, hostValue, pathMode, pathValue) : rule,
      ),
    )
  }

  const addDraft = () => {
    if (draftHostMode !== 'any' && !draftHost.trim()) return
    if (draftPathMode !== 'any' && !draftPath.trim()) return
    const next = buildUrlMatchRuleFromModes(draftHostMode, draftHost, draftPathMode, draftPath)
    onChange(matchAll ? [next] : [...rules, next])
    setDraftHostMode('exact')
    setDraftHost(canPresetDefault ? defaultHost : '')
    setDraftPathMode('any')
    setDraftPath('/')
  }

  const upsertUnique = (next: UrlMatchRule) => {
    const exists = rules.some((rule) => describeUrlMatchRule(rule) === describeUrlMatchRule(next))
    if (!exists) onChange(matchAll ? [next] : [...rules, next])
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Main-frame allowlist</h3>
          <p className="text-xs text-muted-foreground">
            Which hosts and paths sessions may open as the main frame. Prefer explicit modes over typing wildcards.
          </p>
        </div>
        <StatusPill
          label={matchAll ? 'Any host · any path' : rules.length ? `${rules.length} rule${rules.length === 1 ? '' : 's'}` : 'Empty'}
          tone={rules.length ? 'success' : 'warning'}
        />
      </div>

      <SwitchField
        id="allowlist-match-all"
        label="Allow any host and any path"
        helper="On = one match-all rule (open browsing). Off = limit to the rules below."
        checked={matchAll}
        onCheckedChange={setMatchAll}
      />

      {!rules.length ? (
        <HelperCallout tone="warning" title="Allowlist is empty">
          Completeness does not require rules, but real browsing should allow at least the default host — or enable
          match-all above.
        </HelperCallout>
      ) : null}

      {!matchAll ? (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Quick presets</p>
            <GuidedPreset
              presets={[
                {
                  id: 'allow-default',
                  label: 'Default host · any path',
                  apply: () => {
                    if (!canPresetDefault) return
                    upsertUnique(allowHostAnyPath(defaultHost))
                  },
                },
                {
                  id: 'allow-wildcard',
                  label: 'Subdomains of default · any path',
                  apply: () => {
                    if (!canPresetDefault) return
                    upsertUnique(allowHostAnyPath(`*.${defaultHost}`))
                  },
                },
                {
                  id: 'match-all',
                  label: 'Any host · any path',
                  apply: () => onChange([createMatchAllUrlRule()]),
                },
                {
                  id: 'clear',
                  label: 'Clear allowlist',
                  apply: () => onChange([]),
                },
              ]}
            />
            {!canPresetDefault ? (
              <InlineValidation message="Set a valid default target host before using default-host presets." />
            ) : null}
          </div>

          <HelperCallout title="How host and path modes work">
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground/90">Any host</strong> — every hostname matches.
              </li>
              <li>
                <strong className="text-foreground/90">Exact host</strong> — only that host (e.g. www.example.com).
              </li>
              <li>
                <strong className="text-foreground/90">Subdomains</strong> — hosts under an apex (e.g. *.example.com).
              </li>
              <li>
                <strong className="text-foreground/90">Any path</strong> — every path on the matched host.
              </li>
              <li>
                <strong className="text-foreground/90">Path prefix</strong> — paths starting with the value (e.g. /app…).
              </li>
              <li>
                <strong className="text-foreground/90">Exact path</strong> — that path only.
              </li>
            </ul>
          </HelperCallout>

          {rules.length ? (
            <ul className="space-y-3">
              {rules.map((rule, index) => {
                const hostMode = hostMatchMode(rule)
                const pathMode = pathMatchMode(rule)
                const hostValue = hostEditValue(rule)
                const pathValue = rulePathField(rule)
                return (
                  <li key={`${describeUrlMatchRule(rule)}-${index}`} className="rounded-lg border border-border bg-background/50 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Rule {index + 1}</p>
                        <p className="text-sm text-foreground">{describeUrlMatchRule(rule)}</p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove rule ${index + 1}`}
                        onClick={() => onChange(rules.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ModeSelect
                        id={`host-mode-${index}`}
                        label="Host match"
                        value={hostMode}
                        options={[
                          ['any', 'Any host'],
                          ['exact', 'Exact host'],
                          ['subdomains', 'Subdomains of host'],
                        ]}
                        onChange={(mode) =>
                          patchModes(index, mode as HostMatchMode, hostValue || defaultHost || 'example.com', pathMode, pathValue)
                        }
                      />
                      {hostMode === 'any' ? (
                        <p className="self-end pb-2 text-xs text-muted-foreground">Matches every hostname.</p>
                      ) : (
                        <div className="space-y-1.5">
                          <Label htmlFor={`allow-host-${index}`}>
                            {hostMode === 'subdomains' ? 'Apex host' : 'Host'}
                          </Label>
                          <Input
                            id={`allow-host-${index}`}
                            className="font-mono text-xs"
                            value={hostValue}
                            placeholder={hostMode === 'subdomains' ? 'example.com' : 'www.example.com'}
                            onChange={(event) =>
                              patchModes(index, hostMode, event.target.value, pathMode, pathValue)
                            }
                          />
                          {hostMode === 'subdomains' ? (
                            <p className="text-[11px] text-muted-foreground">
                              Stored as <code className="text-foreground/80">*.{hostValue || 'example.com'}</code>
                            </p>
                          ) : null}
                        </div>
                      )}
                      <ModeSelect
                        id={`path-mode-${index}`}
                        label="Path match"
                        value={pathMode}
                        options={[
                          ['any', 'Any path'],
                          ['prefix', 'Path prefix'],
                          ['exact', 'Exact path'],
                        ]}
                        onChange={(mode) =>
                          patchModes(
                            index,
                            hostMode,
                            hostValue,
                            mode as PathMatchMode,
                            pathValue === '/' ? '/app' : pathValue,
                          )
                        }
                      />
                      {pathMode === 'any' ? (
                        <p className="self-end pb-2 text-xs text-muted-foreground">Matches every path on the host.</p>
                      ) : (
                        <div className="space-y-1.5">
                          <Label htmlFor={`allow-path-${index}`}>
                            {pathMode === 'exact' ? 'Exact path' : 'Path prefix'}
                          </Label>
                          <Input
                            id={`allow-path-${index}`}
                            className="font-mono text-xs"
                            value={pathValue === '/' ? '' : pathValue}
                            placeholder="/app"
                            onChange={(event) =>
                              patchModes(index, hostMode, hostValue, pathMode, event.target.value || '/')
                            }
                          />
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}

          <div className="rounded-lg border border-dashed border-border p-3">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Add rule</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeSelect
                id="draft-host-mode"
                label="Host match"
                value={draftHostMode}
                options={[
                  ['any', 'Any host'],
                  ['exact', 'Exact host'],
                  ['subdomains', 'Subdomains of host'],
                ]}
                onChange={(mode) => setDraftHostMode(mode as HostMatchMode)}
              />
              {draftHostMode === 'any' ? (
                <p className="self-end pb-2 text-xs text-muted-foreground">No host value needed.</p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="allow-draft-host">{draftHostMode === 'subdomains' ? 'Apex host' : 'Host'}</Label>
                  <Input
                    id="allow-draft-host"
                    className="font-mono text-xs"
                    value={draftHost}
                    placeholder={canPresetDefault ? defaultHost : 'example.com'}
                    onChange={(event) => setDraftHost(event.target.value)}
                  />
                </div>
              )}
              <ModeSelect
                id="draft-path-mode"
                label="Path match"
                value={draftPathMode}
                options={[
                  ['any', 'Any path'],
                  ['prefix', 'Path prefix'],
                  ['exact', 'Exact path'],
                ]}
                onChange={(mode) => setDraftPathMode(mode as PathMatchMode)}
              />
              {draftPathMode === 'any' ? (
                <p className="self-end pb-2 text-xs text-muted-foreground">No path value needed.</p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="allow-draft-path">{draftPathMode === 'exact' ? 'Exact path' : 'Path prefix'}</Label>
                  <Input
                    id="allow-draft-path"
                    className="font-mono text-xs"
                    value={draftPath === '/' ? '' : draftPath}
                    placeholder="/app"
                    onChange={(event) => setDraftPath(event.target.value || '/')}
                  />
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  (draftHostMode !== 'any' && !draftHost.trim()) ||
                  (draftPathMode !== 'any' && !(draftPath.trim() && draftPath !== '/'))
                }
                onClick={addDraft}
              >
                <Plus className="h-4 w-4" />
                Add rule
              </Button>
            </div>
          </div>
        </>
      ) : (
        <HelperCallout>
          Match-all is active. Turn it off to add specific host/path rules, or keep it for unrestricted main-frame
          navigation.
        </HelperCallout>
      )}
    </div>
  )
}

function ModeSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
