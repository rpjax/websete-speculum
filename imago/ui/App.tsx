import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api, connect, remembered,
  type CloseReport, type PanelState, type PreviewSummary, type PreviewTapeEntry,
  type SessionMeta, type Stats, type TapeEntry,
} from './api'
import Toasts, { type Toast } from './components/Toasts'
import Record from './views/Record'
import Recording from './views/Recording'
import Sessions from './views/Sessions'
import SessionDetail from './views/SessionDetail'
import Preview from './views/Preview'
import Help from './views/Help'

const EMPTY: PanelState = {
  recording: false, session: null, inflight: 0, browserAlive: false, stall: null,
  tape: [], lastReport: null, sessions: [], incompatible: [], previews: [],
}

type View =
  | { name: 'record' } | { name: 'sessions' }
  | { name: 'session'; id: string } | { name: 'previews' } | { name: 'help' }

export default function App() {
  const [state, setState] = useState<PanelState>(EMPTY)
  const [view, setView] = useState<View>(() => ({ name: remembered.read<'record' | 'sessions'>('view', 'record') }) as View)
  const [ready, setReady] = useState(false)
  const [online, setOnline] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((text: string, tone: Toast['tone'] = 'plain') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setState(await api.state())
      setReady(true)
      setOnline(true)
    } catch { setOnline(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => connect((msg) => {
    if (msg.type === 'hello') { setState(msg.state as PanelState); setReady(true) }
    else if (msg.type === 'tape') setState((s) => ({ ...s, tape: [...s.tape, msg.entry as TapeEntry].slice(-600) }))
    else if (msg.type === 'stats') setState((s) => ({
      ...s,
      inflight: msg.inflight as number,
      browserAlive: msg.browserAlive as boolean,
      stall: (msg.stall ?? null) as string | null,
      session: s.session ? { ...s.session, stats: msg.stats as Stats } : s.session,
    }))
    else if (msg.type === 'previews') setState((s) => ({ ...s, previews: msg.previews as PreviewSummary[] }))
    else if (msg.type === 'preview-tape') setState((s) => ({
      ...s,
      previews: s.previews.map((p) => p.runId === msg.runId
        ? { ...p, tape: [...p.tape, msg.entry as PreviewTapeEntry].slice(-600) }
        : p),
    }))
    else if (msg.type === 'status' || msg.type === 'runs') void refresh()
  }, setOnline), [refresh])

  const recording = state.recording && state.session !== null
  useEffect(() => { if (recording) setView({ name: 'record' }) }, [recording])

  const go = useCallback((next: View) => {
    setView(next)
    if (next.name === 'record' || next.name === 'sessions') remembered.write('view', next.name)
  }, [])

  // keyboard shortcuts — a tool used with one hand on the browser
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '1') go({ name: 'record' })
      else if (e.key === '2') go({ name: 'sessions' })
      else if (e.key === '3') go({ name: 'previews' })
      else if (e.key === '4') go({ name: 'help' })
      else if (e.key === '?') go({ name: 'help' })
      else if (e.key === 'm' && recording && state.browserAlive) {
        void api.mark().then((r) => toast(r.snapshot ? `marked → ${r.snapshot.id}` : 'nothing to capture', 'good'))
          .catch((err) => toast(String(err.message ?? err), 'bad'))
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [go, recording, state.browserAlive, toast])

  const previewCount = state.previews.length
  const crumb = useMemo(() => {
    if (recording) return (state.session as SessionMeta).id
    if (view.name === 'session') return view.id
    if (view.name === 'previews') return previewCount ? `${previewCount} running` : 'no preview running'
    if (view.name === 'help') return 'how it works'
    return 'record · generate · preview'
  }, [recording, state.session, view, previewCount])

  return (
    <div className="app">
      <aside className="rail">
        <div className="logo">IMAGO</div>
        <nav>
          <button className={`nav ${view.name === 'record' ? 'on' : ''}`} onClick={() => go({ name: 'record' })}>
            <span>Record</span>{recording && <i className="dot small" />}<kbd>1</kbd>
          </button>
          <button className={`nav ${view.name === 'sessions' || view.name === 'session' ? 'on' : ''}`}
                  onClick={() => go({ name: 'sessions' })}>
            <span>Sessions</span><em>{state.sessions.length}</em><kbd>2</kbd>
          </button>
          <button className={`nav ${view.name === 'previews' ? 'on' : ''}`} onClick={() => go({ name: 'previews' })}>
            <span>Previews</span>{previewCount > 0 && <em>{previewCount}</em>}<kbd>3</kbd>
          </button>
          <button className={`nav ${view.name === 'help' ? 'on' : ''}`} onClick={() => go({ name: 'help' })}>
            <span>How it works</span><kbd>4</kbd>
          </button>
        </nav>
        <div className="rail-foot">
          {!online
            ? <span className="badge bad">panel offline</span>
            : recording
              ? (state.browserAlive
                  ? <span className="rec"><span className="dot" /> recording</span>
                  : <span className="badge bad">chrome gone</span>)
              : <span className="badge">idle</span>}
        </div>
      </aside>

      <div className="main-col">
        <header className="top"><span className="crumb">{crumb}</span></header>
        <main>
          <div className="wrap">
            {!ready && <div className="empty">connecting…</div>}
            {ready && recording && (
              <Recording
                session={state.session as SessionMeta}
                inflight={state.inflight}
                tape={state.tape}
                browserAlive={state.browserAlive}
                stall={state.stall}
                online={online}
                onChanged={refresh}
                onToast={toast}
              />
            )}
            {ready && !recording && view.name === 'record' && (
              <Record lastReport={state.lastReport as CloseReport | null}
                      onStarted={refresh} onToast={toast}
                      onOpen={(id) => go({ name: 'session', id })} />
            )}
            {ready && !recording && view.name === 'sessions' && (
              <Sessions sessions={state.sessions} incompatible={state.incompatible}
                        onOpen={(id) => go({ name: 'session', id })}
                        onChanged={refresh} onToast={toast} />
            )}
            {ready && !recording && view.name === 'session' && (
              <SessionDetail id={view.id} previews={state.previews}
                             onBack={() => go({ name: 'sessions' })}
                             onToast={toast} onPreviews={refresh}
                             onDeleted={() => go({ name: 'sessions' })}
                             onOpenPreviews={() => go({ name: 'previews' })} />
            )}
            {ready && !recording && view.name === 'help' && <Help />}
            {ready && !recording && view.name === 'previews' && (
              <Preview previews={state.previews} onToast={toast} onChanged={refresh}
                       onOpenSession={(id) => go({ name: 'session', id })} />
            )}
          </div>
        </main>
      </div>

      <Toasts toasts={toasts} />
    </div>
  )
}
