import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface LabConsolePromptProps {
  live: boolean
  busy: boolean
  jsBridgeEnabled: boolean | null
  onSubmit: (code: string) => Promise<void>
}

const HISTORY_LIMIT = 50

/**
 * Chrome DevTools console prompt: blue `>`, Enter to run, Shift+Enter newline, ↑/↓ history.
 */
export function LabConsolePrompt({
  live,
  busy,
  jsBridgeEnabled,
  onSubmit,
}: LabConsolePromptProps) {
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const draftRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const node = textareaRef.current
    if (!node) {
      return
    }
    node.style.height = '0px'
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`
  }, [command])

  const disabled = !live || busy || jsBridgeEnabled === false

  const run = async () => {
    const code = command.trimEnd()
    if (!code.trim() || disabled) {
      return
    }
    setHistory((previous) => {
      const next = [...previous.filter((entry) => entry !== code), code]
      return next.slice(-HISTORY_LIMIT)
    })
    setHistoryIndex(null)
    draftRef.current = ''
    setCommand('')
    await onSubmit(code)
    textareaRef.current?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void run()
      return
    }

    if (event.key === 'ArrowUp' && !event.shiftKey) {
      const node = textareaRef.current
      if (node && node.selectionStart === 0 && node.selectionEnd === 0 && history.length > 0) {
        event.preventDefault()
        if (historyIndex == null) {
          draftRef.current = command
        }
        const nextIndex =
          historyIndex == null ? history.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(nextIndex)
        setCommand(history[nextIndex] ?? '')
      }
      return
    }

    if (event.key === 'ArrowDown' && !event.shiftKey) {
      if (historyIndex == null) {
        return
      }
      event.preventDefault()
      if (historyIndex >= history.length - 1) {
        setHistoryIndex(null)
        setCommand(draftRef.current)
        return
      }
      const nextIndex = historyIndex + 1
      setHistoryIndex(nextIndex)
      setCommand(history[nextIndex] ?? '')
    }
  }

  return (
    <div
      className={cn(
        'flex items-start gap-1.5 border-t border-border px-2 py-1',
        disabled && 'opacity-55',
      )}
    >
      <span
        className="mt-[3px] w-4 shrink-0 select-none text-center font-mono text-[13px] font-semibold text-primary"
        aria-hidden
      >
        ›
      </span>
      <textarea
        ref={textareaRef}
        rows={1}
        value={command}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        disabled={disabled}
        aria-label="Console prompt"
        placeholder={
          !live
            ? 'Start a session to use the console'
            : jsBridgeEnabled === false
              ? 'JsBridge is disabled'
              : ''
        }
        className={cn(
          'max-h-[160px] min-h-[20px] flex-1 resize-none bg-transparent font-mono text-[12px] leading-[18px]',
          'text-foreground outline-none placeholder:text-muted-foreground',
        )}
        onChange={(event) => {
          setHistoryIndex(null)
          setCommand(event.target.value)
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
