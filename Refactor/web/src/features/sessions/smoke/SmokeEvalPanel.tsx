import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import type { EvalResult } from '@/lib/speculum'

interface SmokeEvalPanelProps {
  live: boolean
  jsBridgeEnabled: boolean | null
  onEvaluate: (code: string) => Promise<EvalResult | void>
}

/**
 * Dedicated one-shot expression evaluator (JsBridge ConsoleInput).
 * Streaming logs + REPL live in {@link SmokeConsolePanel}.
 */
export function SmokeEvalPanel({ live, jsBridgeEnabled, onEvaluate }: SmokeEvalPanelProps) {
  const [code, setCode] = useState('document.title')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<EvalResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!live || busy || !code.trim()) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await onEvaluate(code)
      if (next) {
        setResult(next)
      }
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            jsBridgeEnabled == null ? 'muted' : jsBridgeEnabled ? 'success' : 'warning'
          }
        >
          {jsBridgeEnabled == null
            ? 'JsBridge unknown'
            : jsBridgeEnabled
              ? 'JsBridge on'
              : 'JsBridge off'}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          One-shot evaluate — rejected without stopping the session when JsBridge is disabled.
        </span>
      </div>

      <Textarea
        className="font-mono text-xs"
        rows={5}
        value={code}
        spellCheck={false}
        disabled={!live || busy}
        aria-label="Evaluate expression"
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void run()
          }
        }}
      />

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!live || busy || !code.trim()} onClick={() => void run()}>
          Evaluate
        </Button>
        <span className="text-[11px] text-muted-foreground">Ctrl/⌘ + Enter</span>
      </div>

      {error && (
        <pre className="overflow-auto rounded-md border border-destructive/40 bg-muted/40 p-3 font-mono text-[11px] text-destructive">
          {error}
        </pre>
      )}

      {result && !error && (
        <div className="space-y-1 rounded-md border border-border p-3">
          <div className="flex items-center gap-2 text-[11px]">
            <Badge variant={result.ok ? 'success' : 'destructive'}>
              {result.ok ? 'ok' : 'error'}
            </Badge>
            <span className="font-mono text-muted-foreground">id {result.requestId}</span>
          </div>
          <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
            {result.ok ? (result.value ?? '') : (result.error ?? 'evaluation failed')}
          </pre>
        </div>
      )}
    </div>
  )
}
