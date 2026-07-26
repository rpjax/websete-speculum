import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SmokeConsoleMessages } from './SmokeConsoleMessages'
import { SmokeConsolePrompt } from './SmokeConsolePrompt'
import {
  DEFAULT_CONSOLE_LEVELS,
  isDefaultConsoleLevels,
  lineMatchesFilter,
  type ConsoleLevelFilter,
  type SmokeConsoleLine,
} from './smokeConsole'

interface SmokeConsolePanelProps {
  live: boolean
  jsBridgeEnabled: boolean | null
  lines: SmokeConsoleLine[]
  onClear: () => void
  /** Runs a JsBridge command; the console feed also receives wire output. */
  onRunCommand: (code: string) => Promise<void>
}

type LevelKey = keyof ConsoleLevelFilter

const LEVEL_OPTIONS: Array<{ key: LevelKey; label: string }> = [
  { key: 'verbose', label: 'Verbose' },
  { key: 'info', label: 'Info' },
  { key: 'warning', label: 'Warnings' },
  { key: 'error', label: 'Errors' },
]

/**
 * Browser DevTools Console replica: filter bar, Default levels, message stream, `>` prompt.
 * One-shot Eval stays in {@link SmokeEvalPanel}.
 */
export function SmokeConsolePanel({
  live,
  jsBridgeEnabled,
  lines,
  onClear,
  onRunCommand,
}: SmokeConsolePanelProps) {
  const [levels, setLevels] = useState<ConsoleLevelFilter>(DEFAULT_CONSOLE_LEVELS)
  const [textFilter, setTextFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const visible = useMemo(
    () => lines.filter((line) => lineMatchesFilter(line, levels, textFilter)),
    [levels, lines, textFilter],
  )

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [visible])

  const run = async (code: string) => {
    setBusy(true)
    try {
      await onRunCommand(code)
    } finally {
      setBusy(false)
    }
  }

  const levelsLabel = isDefaultConsoleLevels(levels) ? 'Default levels' : 'Custom levels'

  return (
    <div className="flex h-full min-h-[220px] min-w-0 flex-col overflow-hidden border border-border bg-background">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-card px-1.5">
        <Input
          value={textFilter}
          onChange={(event) => setTextFilter(event.target.value)}
          placeholder="Filter"
          aria-label="Filter"
          className="h-5 min-w-0 flex-1 rounded-sm border-border/80 bg-background px-1.5 text-[11px] shadow-none"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 gap-0.5 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
              aria-label="Log levels"
            >
              {levelsLabel}
              <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 space-y-2 p-2">
            <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Levels
            </p>
            {LEVEL_OPTIONS.map((option) => (
              <Label
                key={option.key}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-[12px] font-normal hover:bg-muted/50"
              >
                <Checkbox
                  checked={levels[option.key]}
                  onCheckedChange={(checked) => {
                    setLevels((previous) => ({
                      ...previous,
                      [option.key]: checked === true,
                    }))
                  }}
                />
                {option.label}
              </Label>
            ))}
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          title="Clear console"
          aria-label="Clear console"
          disabled={lines.length === 0}
          onClick={onClear}
        >
          <Ban className="h-3.5 w-3.5" />
        </Button>
      </div>

      <SmokeConsoleMessages lines={visible} scrollerRef={scrollerRef} />

      <SmokeConsolePrompt
        live={live}
        busy={busy}
        jsBridgeEnabled={jsBridgeEnabled}
        onSubmit={run}
      />
    </div>
  )
}
