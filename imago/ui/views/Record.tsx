import { useState } from 'react'
import { api, remembered, type CloseReport } from '../api'
import Closure from './Closure'

export default function Record(props: {
  lastReport: CloseReport | null
  onStarted: () => void
  onToast: (text: string, tone?: 'plain' | 'good' | 'bad') => void
  onOpen: (id: string) => void
}) {
  const saved = remembered.read('recordForm', { name: '', url: '', settleMs: 500 })
  const [name, setName] = useState(saved.name)
  const [url, setUrl] = useState(saved.url)
  const [settleMs, setSettleMs] = useState(saved.settleMs)
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    remembered.write('recordForm', { name, url, settleMs })
    try {
      const { session } = await api.start({ name: name || 'session', url: url || undefined, settleMs })
      props.onToast(`recording ${session.id}`, 'good')
      props.onStarted()
    } catch (e) {
      props.onToast(e instanceof Error ? e.message : String(e), 'bad')
    } finally { setBusy(false) }
  }

  return (
    <>
      <h2>new recording</h2>
      <p className="sub">
        Chrome opens and you browse normally. The recorder is passive — it never navigates, clicks or
        pauses the page.
      </p>
      <div className="card">
        <div className="row">
          <div className="field" style={{ flex: '2 1 260px' }}>
            <label>name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="storefront browse"
                   onKeyDown={(e) => { if (e.key === 'Enter') void start() }} />
          </div>
          <div className="field" style={{ flex: '3 1 320px' }}>
            <label>start url (optional)</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
                   onKeyDown={(e) => { if (e.key === 'Enter') void start() }} />
          </div>
          <div className="field" style={{ flex: '0 0 130px' }}>
            <label>settle ms</label>
            <input type="number" value={settleMs} min={100} step={100}
                   onChange={(e) => setSettleMs(Number(e.target.value))} />
          </div>
        </div>
        <div className="actions">
          <button className="btn primary big" onClick={start} disabled={busy}>
            {busy ? 'launching Chrome…' : 'Start recording'}
          </button>
          <span className="note">Requires Google Chrome installed. Nothing is downloaded.</span>
        </div>
      </div>

      {props.lastReport && (
        <>
          <h2>last close</h2>
          <div className="card">
            <Closure report={props.lastReport} />
            <div className="actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => props.onOpen((props.lastReport as CloseReport).sessionId)}>
                Open session →
              </button>
            </div>
          </div>
        </>
      )}

      <h2>what happens when you press start</h2>
      <div className="card help">
        <div className="step">
          <b>Chrome opens — you drive</b>
          <p>
            A separate Chrome window, with its own profile, so your own browser and logins are not
            touched. Browse the site normally: Imago watches and never interferes with the page.
          </p>
        </div>
        <div className="step">
          <b>It captures on its own</b>
          <p>
            Every request is recorded, and the page is snapshotted each time it stops moving — plus once
            every 20 seconds on a page that never stops (a carousel, a ticker). You do not have to do
            anything for this.
          </p>
        </div>
        <div className="step">
          <b>Mark the states it cannot guess</b>
          <p>
            An open menu, a modal, a hover — states that exist only while you hold them. Use the
            <b> Mark state</b> button, or <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>M</kbd> without leaving the
            site. A mark is always captured.
          </p>
        </div>
        <div className="step">
          <b>Close sandbox when you are done</b>
          <p>
            The session is written to disk, references the page never actually asked for are fetched, and
            the result is checked. From there you can generate a bundle and preview it.
          </p>
        </div>
        <p className="note"><b>How it works</b> in the sidebar has the whole picture.</p>
      </div>
    </>
  )
}
