import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface SmokeConsolePanelProps {
  live: boolean
  onEvaluate: (code: string) => void
  onSendText: (text: string) => void
}

/** JsBridge eval plus a bulk text input, the two client-driven console pipes. */
export function SmokeConsolePanel({ live, onEvaluate, onSendText }: SmokeConsolePanelProps) {
  const [code, setCode] = useState('document.title')
  const [text, setText] = useState('speculum smoke')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          className="font-mono text-xs"
          rows={3}
          value={code}
          spellCheck={false}
          aria-label="Evaluate expression"
          onChange={(event) => setCode(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!live} onClick={() => onEvaluate(code)}>
            Evaluate
          </Button>
          <span className="text-xs text-muted-foreground">
            Rejected without killing the session when JsBridge is disabled.
          </span>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <Textarea
          className="font-mono text-xs"
          rows={2}
          value={text}
          spellCheck={false}
          aria-label="Text to insert"
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!live} onClick={() => onSendText(text)}>
            Send text input
          </Button>
          <span className="text-xs text-muted-foreground">
            IME-style bulk insert into the focused remote field.
          </span>
        </div>
      </div>
    </div>
  )
}
