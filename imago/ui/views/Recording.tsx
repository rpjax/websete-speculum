import { useState } from 'react'
import { api, bytes, type SessionMeta, type TapeEntry } from '../api'
import Tape from '../components/Tape'

const STALL_HINT: Record<string, string> = {
  loading: 'the document is still loading',
  inflight: 'requests are still in flight — long-lived ones (streams, polls, beacons) stop counting after 5s',
  fonts: 'web fonts have not finished loading',
  mutating: 'the page keeps mutating — a safety-net snapshot is taken every 20s anyway',
}

export default function Recording(props: {
  session: SessionMeta
  inflight: number
  tape: TapeEntry[]
  browserAlive: boolean
  stall: string | null
  online: boolean
  onChanged: () => void
  onToast: (text: string, tone?: 'plain' | 'good' | 'bad') => void
}) {
  const [busy, setBusy] = useState<'mark' | 'close' | null>(null)

  const mark = async () => {
    setBusy('mark')
    try {
      const { snapshot } = await api.mark()
      props.onToast(snapshot ? `marked → ${snapshot.id}` : 'no page to capture', snapshot ? 'good' : 'bad')
    } catch (e) { props.onToast(message(e), 'bad') }
    finally { setBusy(null) }
  }

  const close = async () => {
    setBusy('close')
    try {
      const { report } = await api.close()
      props.onToast(
        report.unresolved.length
          ? `closed — ${report.snapshots} snapshots, ${report.unresolved.length} references still missing`
          : `closed — ${report.snapshots} snapshots, closed world`,
        report.unresolved.length ? 'bad' : 'good',
      )
      props.onChanged()
    } catch (e) { props.onToast(message(e), 'bad'); setBusy(null) }
  }

  const s = props.session.stats
  const stalled = props.browserAlive && s.snapshots === 0 && props.stall

  return (
    <>
      <h2>{props.session.name}</h2>
      <p className="sub">
        {props.session.origins.join(', ') || 'no origin yet'} · opened{' '}
        {new Date(props.session.openedAt).toLocaleTimeString()} · <span className="mono">{props.session.id}</span>
      </p>

      {!props.online && (
        <div className="banner bad">
          <b>The panel lost the imago process.</b> Nothing is being captured right now. Everything
          journalled up to the disconnect is on disk; restart imago and the session is recovered and
          listed as interrupted.
        </div>
      )}

      {props.online && !props.browserAlive && (
        <div className="banner bad">
          <b>Chrome is gone</b> — closed or crashed. The session is still open and everything captured so
          far is on disk. <b>Close sandbox</b> persists and finalizes it; it will be marked
          <code> failed</code> because the browse ended early.
        </div>
      )}

      <div className="tiles">
        <div className="tile"><div className="k">snapshots</div><div className="v">{s.snapshots}</div></div>
        <div className="tile"><div className="k">requests</div><div className="v">{s.requests}</div></div>
        <div className="tile"><div className="k">captured</div><div className="v">{bytes(s.bytes)}</div></div>
        <div className="tile"><div className="k">in flight</div><div className="v">{props.inflight}</div></div>
        <div className={`tile ${s.errors ? 'alert' : ''}`}><div className="k">errors</div><div className="v">{s.errors}</div></div>
      </div>

      {stalled && (
        <div className="banner warn">
          <b>No snapshot yet</b> — {STALL_HINT[props.stall as string] ?? props.stall}. <b>Mark state</b>
          {' '}captures the page regardless.
        </div>
      )}

      <div className="card">
        <div className="actions">
          <button className="btn big" onClick={mark} disabled={busy !== null || !props.browserAlive || !props.online}>
            Mark state
          </button>
          <span className="note">
            <kbd>m</kbd> here, or <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>M</kbd> inside the page.
            A mark is always captured, settled or not.
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn danger big" onClick={close} disabled={busy !== null || !props.online}>
            {busy === 'close' ? 'closing…' : 'Close sandbox'}
          </button>
        </div>
        {busy === 'close' && (
          <p className="note" style={{ marginTop: 10 }}>
            resolving references the page never requested (lazy images, unused <code>srcset</code>
            {' '}densities) — this is what closes the world.
          </p>
        )}
      </div>

      <h2>tape</h2>
      <Tape lines={props.tape} />
    </>
  )
}

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text === 'Failed to fetch'
    ? 'Could not reach the imago process — it may have stopped. Check the terminal that started it.'
    : text
}
