import { useEffect, useState } from 'react'
import { api, type ParityReport, type PreviewMode, type PreviewSummary } from '../api'
import Tape from '../components/Tape'

const MODES: { id: PreviewMode; label: string; hint: string }[] = [
  { id: 'off', label: 'off', hint: 'API calls fail — you see the empty and error states nobody captured' },
  { id: 'fixtures', label: 'fixtures', hint: 'recorded responses replayed: the site looks alive, and the mock lies (a recorded POST always succeeds)' },
  { id: 'proxy', label: 'proxy', hint: 'forwarded to the backend under construction — the front end drives your half-built server' },
]

export default function Preview(props: {
  previews: PreviewSummary[]
  onToast: (text: string, tone?: 'plain' | 'good' | 'bad') => void
  onChanged: () => void
  onOpenSession: (id: string) => void
}) {
  const [selected, setSelected] = useState(0)
  const preview = props.previews[Math.min(selected, props.previews.length - 1)]

  if (!preview) {
    return (
      <>
        <h2>previews</h2>
        <div className="card"><div className="empty">
          no preview running — generate a bundle from a session, then press Preview
        </div></div>
      </>
    )
  }

  return <One key={preview.runId} preview={preview} count={props.previews.length}
              onPick={setSelected} previews={props.previews}
              onToast={props.onToast} onChanged={props.onChanged}
              onOpenSession={props.onOpenSession} />
}

function One(props: {
  preview: PreviewSummary
  previews: PreviewSummary[]
  count: number
  onPick: (i: number) => void
  onToast: (text: string, tone?: 'plain' | 'good' | 'bad') => void
  onChanged: () => void
  onOpenSession: (id: string) => void
}) {
  const p = props.preview
  const [proxyBase, setProxyBase] = useState(p.proxyBase ?? 'http://localhost:3000')
  const [frame, setFrame] = useState(0)
  const [parity, setParity] = useState<ParityReport | null>(null)
  const [parityBusy, setParityBusy] = useState(false)

  useEffect(() => {
    let dead = false
    void api.parityReport(p.sessionId, p.runId)
      .then((r) => { if (!dead) setParity(r.report) })
      .catch(() => { if (!dead) setParity(null) })
    return () => { dead = true }
  }, [p.sessionId, p.runId])

  const runParity = async () => {
    setParityBusy(true)
    try {
      const r = await api.parityRun(p.sessionId, p.runId)
      setParity(r.report)
      props.onToast(r.report.pass ? 'parity pass' : 'parity fail — see gaps', r.report.pass ? 'good' : 'bad')
    } catch (e) {
      props.onToast(e instanceof Error ? e.message : String(e), 'bad')
    } finally { setParityBusy(false) }
  }

  const setMode = async (mode: PreviewMode) => {
    try {
      await api.previewMode(p.runId, mode, mode === 'proxy' ? proxyBase : null)
      props.onChanged()
      props.onToast(`api mode → ${mode}`)
    } catch (e) { props.onToast(e instanceof Error ? e.message : String(e), 'bad') }
  }

  const stop = async () => {
    try { await api.previewStop(p.runId); props.onChanged(); props.onToast('preview stopped') }
    catch (e) { props.onToast(e instanceof Error ? e.message : String(e), 'bad') }
  }

  const counts = p.tape.reduce<Record<string, number>>((acc, l) => {
    acc[l.kind] = (acc[l.kind] ?? 0) + 1
    return acc
  }, {})

  return (
    <>
      {props.count > 1 && (
        <div className="tape-bar" style={{ marginBottom: 12 }}>
          {props.previews.map((x, i) => (
            <button key={x.runId} className={`btn small ${x.runId === p.runId ? 'primary' : ''}`}
                    onClick={() => props.onPick(i)}>{x.runId}</button>
          ))}
        </div>
      )}

      <h2>{p.runId}</h2>
      <p className="sub">
        <a href={p.url} target="_blank" rel="noreferrer" className="mono">{p.url}</a>
        {' · '}its own origin, root-mounted, isolated from this panel
        {' · '}<button className="link" onClick={() => props.onOpenSession(p.sessionId)}>{p.sessionId}</button>
      </p>

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
          <div className="field" style={{ flex: '0 0 auto' }}>
            <label>api mode</label>
            <div className="seg">
              {MODES.map((m) => (
                <button key={m.id} className={p.mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {p.mode === 'proxy' && (
            <div className="field" style={{ flex: '1 1 260px' }}>
              <label>backend</label>
              <input value={proxyBase} onChange={(e) => setProxyBase(e.target.value)}
                     onBlur={() => void setMode('proxy')} placeholder="http://localhost:3000" />
            </div>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn" disabled={parityBusy} onClick={runParity}>
            {parityBusy ? 'Running parity…' : 'Run parity'}
          </button>
          <a className="btn" href={p.url} target="_blank" rel="noreferrer">Open in browser</a>
          <button className="btn danger" onClick={stop}>Stop preview</button>
        </div>
        <p className="note" style={{ marginTop: 12 }}>{MODES.find((m) => m.id === p.mode)?.hint}</p>
      </div>

      <h2>parity</h2>
      <p className="sub">
        Offline compare: session oracle reference vs bundle in <code>fixtures</code> mode (O4/O4b/O1-lite).
      </p>
      <div className="card">
        {parity ? (
          <>
            <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
              <span className={`chip ${parity.pass ? 'good' : 'bad'}`}>
                {parity.pass ? 'PASS' : 'FAIL'}
              </span>
              <span className="muted mono">{parity.at}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <span className="chip">O4 {parity.oracles.O4.pass ? 'ok' : 'fail'}</span>
              <span className="chip">O4b {parity.oracles.O4b.pass ? 'ok' : 'fail'}</span>
              <span className="chip">
                O1 {parity.oracles.O1.skipped ? 'skipped' : parity.oracles.O1.pass ? 'ok' : 'fail'}
              </span>
            </div>
            {parity.gaps.length > 0 && (
              <ul className="gap-list">
                {parity.gaps.map((g, i) => (
                  <li key={i} className={`gap-item ${g.layer === 'visual' ? 'warn' : 'bad'}`}>
                    <b>{g.layer}</b> — {g.summary}
                    {g.url && <div className="mono muted">{g.url}</div>}
                  </li>
                ))}
              </ul>
            )}
            {parity.gaps.length === 0 && parity.pass && (
              <p className="note">No gaps — MVP oracles pass for entry snapshot.</p>
            )}
            {(parity.ignored ?? parity.oracles.O4.ignored ?? 0) > 0 && (
              <p className="note muted">
                {(parity.ignored ?? parity.oracles.O4.ignored)} telemetry / extension / metrics
                request{(parity.ignored ?? parity.oracles.O4.ignored) === 1 ? '' : 's'} ignored
                (not product gaps).
              </p>
            )}
            {!parity.oracles.O1.skipped && (
              <div className="parity-shots">
                <figure>
                  <figcaption>reference</figcaption>
                  <img alt="reference"
                       src={api.parityReferenceUrl(p.sessionId, parity.entrySnapId)} />
                </figure>
                <figure>
                  <figcaption>candidate</figcaption>
                  <img alt="candidate"
                       src={api.parityAssetUrl(p.sessionId, p.runId, `candidate/${parity.entrySnapId}.png`)} />
                </figure>
                <figure>
                  <figcaption>diff</figcaption>
                  <img alt="diff"
                       src={api.parityAssetUrl(p.sessionId, p.runId, `diff/${parity.entrySnapId}.png`)} />
                </figure>
              </div>
            )}
            {parity.oracles.O1.skipped && (
              <p className="note warn-text">
                {parity.oracles.O1.reason ?? 'No oracle reference — re-close the session after upgrade.'}
              </p>
            )}
            {!parity.oracles.O1.skipped && parity.oracles.O1.differPct !== undefined && (
              <p className="note">
                Visual diff: {parity.oracles.O1.differPct.toFixed(2)}% pixels
                {parity.oracles.O1.maxRegion && (
                  <> · max region {parity.oracles.O1.maxRegion.w}×{parity.oracles.O1.maxRegion.h}</>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="empty">No parity report yet — press Run parity (needs Chrome installed).</p>
        )}
      </div>

      <h2>requests</h2>
      <p className="sub">
        Everything the bundle asks for passes through here — which is what makes the closed world (E2)
        enforced rather than claimed, and what O4 will assert.
        {Object.entries(counts).map(([k, n]) => (
          <span key={k} className={`chip ${k === 'missing-asset' ? 'bad' : ''}`}>{k} {n}</span>
        ))}
      </p>
      {(counts['missing-asset'] ?? 0) > 0 && (
        <div className="banner bad">
          <b>{counts['missing-asset']} asset{counts['missing-asset'] === 1 ? '' : 's'} is not in the bundle.</b>
          {' '}That is a capture gap, not a policy decision — the bundle refuses to fetch it from the real
          origin. Record the session again so the closing sweep can download it, or check the session's
          closure report for what came back as an error.
        </div>
      )}
      {(counts['blocked'] ?? 0) > 0 && (
        <p className="note" style={{ marginBottom: 10 }}>
          <b>{counts['blocked']} blocked</b> — API calls and third-party beacons refused by the current
          api mode. Expected in <code>off</code>; switch to <code>fixtures</code> to replay what was
          recorded.
        </p>
      )}
      <Tape lines={p.tape.map((l) => ({
        seq: l.seq, at: l.at, kind: `${l.kind}`, status: l.status,
        text: l.note ? `${l.url}  — ${l.note}` : l.url,
        tone: l.kind === 'missing-asset' ? 'bad'
          : l.kind === 'blocked' ? 'warn'
          : l.kind === 'missing' ? 'warn'
          : l.kind === 'fixture' || l.kind === 'proxy' ? 'good' : 'plain',
      }))} height={300} />

      <h2>rendered</h2>
      <p className="sub">
        Convenience only — some pages behave differently inside a frame. The truthful view is
        <b> Open in browser</b>.
      </p>
      <div className="card frame-card">
        <div className="tape-bar">
          <button className="link" onClick={() => setFrame((f) => f + 1)}>reload frame</button>
        </div>
        <iframe key={frame} src={p.url} title="preview" className="preview-frame" />
      </div>
    </>
  )
}
