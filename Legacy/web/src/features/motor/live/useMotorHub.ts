import { useEffect, useRef, useState } from 'react'
import { MotorEngine, type MotorUiState } from './MotorEngine'

export function useMotorHub() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const urlBarRef = useRef<HTMLInputElement>(null)
  const imeRef = useRef<HTMLTextAreaElement>(null)
  const engineRef = useRef<MotorEngine | null>(null)
  const [ui, setUi] = useState<MotorUiState>({
    status: 'idle',
    statusText: 'Connecting...',
    showOverlay: true,
    url: '',
    fps: null,
    navDisabled: true,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    const urlBar = urlBarRef.current
    if (!canvas || !viewport || !urlBar) return

    const engine = new MotorEngine()
    engineRef.current = engine
    const unsub = engine.subscribe(setUi)
    engine.mount({ canvas, viewport, urlBar, ime: imeRef.current })

    return () => {
      unsub()
      engine.unmount()
      engineRef.current = null
    }
  }, [])

  return {
    canvasRef,
    viewportRef,
    urlBarRef,
    imeRef,
    ui,
    connect: () => engineRef.current?.connect(),
    goBack: () => engineRef.current?.goBack(),
    goForward: () => engineRef.current?.goForward(),
    openVirtualKeyboard: () => engineRef.current?.openVirtualKeyboard(),
    closeVirtualKeyboard: () => engineRef.current?.closeVirtualKeyboard(),
  }
}
