import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ScriptTargetRule } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  buildTargetRuleFromFields,
  createMatchAllTargetRule,
  describeTargetRule,
  formatTargetRules,
  isMatchAllTargetRules,
  parseTargetRules,
  targetRuleHostField,
  targetRulePathExact,
  targetRulePathField,
} from './scriptingConfig'

interface ScriptTargetRulesEditorProps {
  rules: ScriptTargetRule[]
  disabled?: boolean
  idPrefix?: string
  onChange: (rules: ScriptTargetRule[]) => void
}

/**
 * Facilitated target-rule editor — match-all by default; structured host/path rows;
 * raw DSL behind Advanced.
 */
export function ScriptTargetRulesEditor({
  rules,
  disabled = false,
  idPrefix = 'target-rules',
  onChange,
}: ScriptTargetRulesEditorProps) {
  const matchAll = isMatchAllTargetRules(rules)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [draftHost, setDraftHost] = useState('')
  const [draftPath, setDraftPath] = useState('/')
  const [draftExact, setDraftExact] = useState(false)

  const setMatchAll = (everywhere: boolean) => {
    if (everywhere) {
      onChange([createMatchAllTargetRule()])
      return
    }
    if (matchAll) {
      onChange([
        buildTargetRuleFromFields('example.com', '/', false),
      ])
    }
  }

  const patchRule = (index: number, host: string, path: string, exact: boolean) => {
    onChange(rules.map((rule, i) => (
      i === index ? buildTargetRuleFromFields(host, path, exact) : rule
    )))
  }

  const removeRule = (index: number) => {
    const next = rules.filter((_, i) => i !== index)
    onChange(next.length > 0 ? next : [createMatchAllTargetRule()])
  }

  const addDraftRule = () => {
    const host = draftHost.trim() || '*'
    const path = draftPath.trim() || '/'
    const nextRule = buildTargetRuleFromFields(host, path, draftExact)
    if (matchAll) {
      onChange([nextRule])
    } else {
      onChange([...rules, nextRule])
    }
    setDraftHost('')
    setDraftPath('/')
    setDraftExact(false)
  }

  const applyPreset = (host: string, path: string, exact = false) => {
    setDraftHost(host === '*' ? '' : host)
    setDraftPath(path)
    setDraftExact(exact)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={`${idPrefix}-everywhere`} className="text-xs">
            Inject on every page
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Off = limit to specific hosts and/or paths below.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-everywhere`}
          checked={matchAll}
          disabled={disabled}
          onCheckedChange={setMatchAll}
        />
      </div>

      {!matchAll ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={disabled}
              onClick={() => applyPreset('*.example.com', '/', false)}
            >
              Fill · *.example.com
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={disabled}
              onClick={() => applyPreset('*', '/app', false)}
            >
              Fill · /app…
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={disabled}
              onClick={() => applyPreset('www.example.com', '/', false)}
            >
              Fill · exact host
            </Button>
          </div>

          <ul className="space-y-2">
            {rules.map((rule, index) => {
              const host = targetRuleHostField(rule)
              const path = targetRulePathField(rule)
              const exact = targetRulePathExact(rule)
              return (
                <li key={index} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="muted" className="font-normal">
                      {describeTargetRule(rule)}
                    </Badge>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="ml-auto h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={disabled || rules.length <= 1}
                      aria-label={`Remove rule ${index + 1}`}
                      onClick={() => removeRule(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]" htmlFor={`${idPrefix}-host-${index}`}>
                        Host
                      </Label>
                      <Input
                        id={`${idPrefix}-host-${index}`}
                        className="h-8 font-mono text-xs"
                        value={host}
                        disabled={disabled}
                        placeholder="example.com or *.example.com"
                        spellCheck={false}
                        onChange={(e) => patchRule(index, e.target.value, path, exact)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]" htmlFor={`${idPrefix}-path-${index}`}>
                        Path
                      </Label>
                      <Input
                        id={`${idPrefix}-path-${index}`}
                        className="h-8 font-mono text-xs"
                        value={path}
                        disabled={disabled}
                        placeholder="/ or /checkout"
                        spellCheck={false}
                        onChange={(e) => patchRule(index, host, e.target.value, exact)}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Checkbox
                      checked={exact}
                      disabled={disabled || path === '/'}
                      onCheckedChange={(checked) =>
                        patchRule(index, host, path, checked === true)
                      }
                    />
                    Exact path only (no deeper URLs)
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="space-y-2 rounded-md border border-dashed border-border p-2.5">
            <p className="text-[11px] font-medium text-foreground">Add another rule</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                className="h-8 font-mono text-xs"
                value={draftHost}
                disabled={disabled}
                placeholder="Host — * or *.shop.com"
                spellCheck={false}
                onChange={(e) => setDraftHost(e.target.value)}
              />
              <Input
                className="h-8 font-mono text-xs"
                value={draftPath}
                disabled={disabled}
                placeholder="Path — / or /cart"
                spellCheck={false}
                onChange={(e) => setDraftPath(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Checkbox
                  checked={draftExact}
                  disabled={disabled || (draftPath.trim() || '/') === '/'}
                  onCheckedChange={(checked) => setDraftExact(checked === true)}
                />
                Exact path
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-8"
                disabled={disabled}
                onClick={addDraftRule}
              >
                <Plus className="h-3.5 w-3.5" />
                Add rule
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Matches every main-frame URL. Turn off above to scope by host or path.
        </p>
      )}

      <div>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? 'Hide advanced DSL' : 'Advanced DSL'}
        </button>
        {showAdvanced ? (
          <div className="mt-2 space-y-1.5">
            <Textarea
              className="min-h-[64px] font-mono text-[11px]"
              value={formatTargetRules(rules)}
              disabled={disabled}
              spellCheck={false}
              onChange={(e) => onChange(parseTargetRules(e.target.value))}
            />
            <p className="text-[10px] text-muted-foreground">
              One rule per line: <code className="text-foreground">domain path</code>. Path ending in{' '}
              <code className="text-foreground">$</code> = exact.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
