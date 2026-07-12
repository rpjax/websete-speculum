import { useMotorHub } from './useMotorHub'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export default function MotorPage() {
  const { canvasRef, viewportRef, urlBarRef, ui, connect, goBack, goForward } = useMotorHub()
  const showFps = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.endsWith('.localhost')

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0d0d0d] text-[#e0e0e0]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2">
        <span className="text-xs font-semibold tracking-widest text-[#888]">SPECULUM</span>
        <Button variant="outline" size="sm" disabled={ui.navDisabled} onClick={goBack} title="Back">←</Button>
        <Button variant="outline" size="sm" disabled={ui.navDisabled} onClick={goForward} title="Forward">→</Button>
        <Input
          ref={urlBarRef}
          className="flex-1 border-[#333] bg-[#0d0d0d] text-[#888] focus:text-[#e0e0e0]"
          placeholder="—"
          spellCheck={false}
          disabled={ui.navDisabled}
        />
        <span className={cn('text-xs whitespace-nowrap', {
          'text-[#4caf50]': ui.status === 'connected',
          'text-[#ff9800]': ui.status === 'connecting',
          'text-[#f44336]': ui.status === 'error' || ui.status === 'idle',
        })}>
          {ui.statusText}
        </span>
        {showFps && ui.fps !== null && (
          <span className="min-w-[52px] text-right text-xs text-[#555] tabular-nums">{ui.fps} fps</span>
        )}
      </div>

      <div ref={viewportRef} className="relative min-h-0 flex-1 touch-none">
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full cursor-default touch-none" />
        {ui.showOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[rgba(13,13,13,0.85)]">
            <p className="text-sm text-[#888]">Remote browser not connected</p>
            <Button onClick={() => void connect()}>Connect</Button>
          </div>
        )}
      </div>
    </div>
  )
}
