import { useCallback, useEffect, useState } from 'react'
import { ago, api, bytes, type PreviewSummary, type SessionDetail as Detail } from '../api'
import Closure from './Closure'
import Confirm from '../components/Confirm'
import Parity from './Parity'

export default function SessionDetail(props: {
  id: string
  previews: PreviewSummary[]
  onBack: () => void
  onToast: (text: string, tone?: 'plain' | 'good' | 'bad') => void
  onPreviews: () => void
  onDeleted: () => void
  onOpenPreviews: () => void
}) {
  const [data, setData] = useState<Detail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<null | { kind: 'session' } | { kind: 'run'; runId: string }>(null)
  const [emitter, setEmitter] = useState<'flat' | 'rehost'>('flat')

  const load = useCallback(() => {
    api.session(props.id)
      .then((d) => { setData(d); setName(d.meta.name) })
      .catch((e) => props.onToast(String(e.message ?? e), 'bad'))
  }, [props.id, props.onToast])

  useEffect(load, [load])

  const generate = async () => {
    setBusy('generate')
    try {
      const { manifest } = await api.generate(props.id, emitter)
      props.onToast(`generated ${manifest.runId} — ${manifest.files} files, ${bytes(manifest.bytes)}`, 'good')
      load()
    } catch (e) { props.onToast(e instanceof Error ? e.message : String(e), 'bad') }
    finally { setBusy(null) }
  }

  const preview = async (runId: string) => {
    setBusy(runId)
    try {
      const { preview } = await api.previewStart(props.id, runId, 'fixtures')
      props.onToast(`preview on ${preview.url}`, 'good')
      props.onPreviews()
      props.onOpenPreviews()
    } catch (e) { props.onToast(e instanceof Error ? e.message : String(e), 'bad') }
    finally { setBusy(null) }
  }

  const rename = async () => {
    if (!data || name.trim() === data.meta.name) return
    try { await api.rename(props.id, name); props.onToast('renamed', 'good'); load() }
    catch (e) { props.onToast(e instanceof Error ? e.message : String(e), 'bad') }
  }

  const removeSession = async () => {
    setConfirm(null)
    try {
      const res = await api.remove([props.id])
      if (res.refused.length) return props.onToast(res.refused[0]!.reason, 'bad')
      props.onToast('session deleted', 'good')
      props.onDeleted()
    } catch (e) { props.onToast(e instanceof Error ? e.message : String(e), 'bad') }
  }

  const removeRun = async (runId: string) => {
    setConfirm(null)
    try { await api.removeRun(props.id, runId); props.onToast('bundle deleted', 'good'); load() }
    catch (e) { props.onToast(e instanceof Error ? e.message : String(e), 'bad') }
  }

  if (!data) return <div className="empty">loading…</div>
  const closable = data.meta.status !== 'recording' && data.meta.status !== 'closing'

  return (
    <>
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        <button className="link" onClick={props.onBack}>← sessions</button>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="link" onClick={() => { void navigator.clipboard?.writeText(data.dir); props.onToast('path copied') }}>
          copy path
        </button>
        <button className="link" onClick={() => api.reveal(data.dir).catch((e) => props.onToast(String(e.message ?? e), 'bad'))}>
          open folder
        </button>
      </div>

      <div className="row" style={{ alignItems: 'flex-end', gap: 12, marginBottom: 4 }}>
        <div className="field" style={{ flex: '1 1 320px' }}>
          <label>name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename}
                 onKeyDown={(e) => { if (e.key === 'Enter') void rename() }} />
        </div>
        <button className="btn danger" onClick={() => setConfirm({ kind: 'session' })}>Delete session</button>
      </div>
      <p className="sub mono">
        {data.dir} · {bytes(data.disk.bytes)} in {data.disk.files} files
      </p>

      {data.closure
        ? <div className="card"><Closure report={data.closure} /></div>
        : <div className="card"><div className="empty">no closure report — this session never finished closing</div></div>}

      <h2>bundle</h2>
      <div className="card">
        <div className="actions">
          <label className="note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            emitter
            <select
              value={emitter}
              onChange={(e) => setEmitter(e.target.value as 'flat' | 'rehost')}
              disabled={busy !== null}
            >
              <option value="flat">flat — our markup, their CSS, no script</option>
              <option value="rehost">rehost — their bytes, their JavaScript, running</option>
            </select>
          </label>
          <button className="btn primary" onClick={generate} disabled={busy !== null || !closable}>
            {busy === 'generate' ? 'generating…' : 'Generate bundle'}
          </button>
          {!closable && <span className="note">close the sandbox first — generation reads a closed session</span>}
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          {emitter === 'flat'
            ? <>Rebuilds each marked page from the captured DOM and the authored stylesheets, as
                <b> our own</b> HTML and CSS. It ships <b>no JavaScript</b>, so nothing can fail the way a
                running application fails — no hydration, no lazy chunk, no third-party SDK. Everything
                CSS drives still works: hover, focus, transitions, keyframes, breakpoints. What needed
                script is frozen at the state you captured — mark another state to get another page.</>
            : <>Serves the origin's own bytes from our origin: it does not reproduce the application,
                it <b>is</b> the application, missing only its server. The only output where a carousel
                advances and a route changes — and the one that inherits every way someone else's
                JavaScript can break.</>}
        </p>
        {closable && <p className="note">Reads the session, writes a run beside it. The session is never touched, so generate as many times as you like.</p>}

        {data.runs.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <thead><tr><th>bundle</th><th>emitter</th><th>files</th><th>size</th><th>missing</th><th>when</th><th /></tr></thead>
            <tbody>
              {data.runs.map((r) => {
                const live = props.previews.find((p) => p.runId === r.runId)
                return (
                  <tr key={r.runId}>
                    <td>{r.runId}</td>
                    <td><span className="badge">{r.emitter}</span></td>
                    <td>{r.files}</td>
                    <td>{bytes(r.bytes)}</td>
                    <td className={r.missing.length ? 'warn-text' : ''}>{r.missing.length}</td>
                    <td className="muted">{ago(r.createdAt)}</td>
                    <td className="right">
                      {live
                        ? <button className="btn small" onClick={props.onOpenPreviews}>open preview →</button>
                        : <button className="btn small" onClick={() => preview(r.runId)} disabled={busy !== null}>
                            {busy === r.runId ? 'starting…' : 'Preview'}
                          </button>}
                      <button className="btn small danger" style={{ marginLeft: 6 }}
                              onClick={() => setConfirm({ kind: 'run', runId: r.runId })}>
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {data.runs.length > 0 && (
        <>
          <h2>is the bundle complete?</h2>
          <p className="sub">
            Runs the oracles against the newest bundle: every request it makes, and the render compared
            to the reference captured during the browse.
          </p>
          <Parity sessionId={props.id} runId={data.runs[0]!.runId} onToast={props.onToast} />
        </>
      )}

      <h2>snapshots</h2>
      {data.snapshots.length === 0
        ? <div className="card"><div className="empty">no snapshots</div></div>
        : (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>id</th><th>trigger</th><th>viewport</th><th>styles</th><th>refs</th><th>url</th></tr></thead>
              <tbody>
                {data.snapshots.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>
                      <span className={`badge ${s.trigger === 'mark' ? 'ok' : ''}`}>{s.trigger}</span>
                      {s.unsettled && <span className="badge warn" title="captured while the page was still moving">unsettled</span>}
                    </td>
                    <td>{s.viewport.width}×{s.viewport.height}@{s.viewport.dpr}</td>
                    <td>{s.styles.length}</td>
                    <td>{s.refs.length}</td>
                    <td className="muted ellipsis" title={s.url}>{s.url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {confirm?.kind === 'session' && (
        <Confirm title="Delete session" confirmLabel="Delete session"
                 onCancel={() => setConfirm(null)} onConfirm={removeSession}
                 body={<>
                   <p>
                     This removes <span className="mono">{props.id}</span> and everything inside — the
                     timeline, the captured bytes, the snapshots and every bundle generated from it.
                   </p>
                   <p className="note">
                     {bytes(data.disk.bytes)} on disk. A browse cannot be replayed: this throws away work
                     a human did by hand.
                   </p>
                 </>} />
      )}
      {confirm?.kind === 'run' && (
        <Confirm title="Delete bundle" confirmLabel="Delete bundle"
                 onCancel={() => setConfirm(null)} onConfirm={() => removeRun(confirm.runId)}
                 body={<p>
                   Removes the generated bundle <span className="mono">{confirm.runId}</span>. The session
                   is untouched, so you can generate it again at any time — a bundle is cheap, the browse
                   behind it is not.
                 </p>} />
      )}

      {data.errors.length > 0 && (
        <>
          <h2>errors</h2>
          <div className="card"><ul className="plain scroll">
            {data.errors.slice(0, 40).map((e, i) => <li key={i}>{JSON.stringify(e)}</li>)}
          </ul></div>
        </>
      )}
    </>
  )
}
