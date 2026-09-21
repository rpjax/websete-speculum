import { useEffect, useState } from 'react'
import { api, type ParityReport } from '../api'

const LAYER_HINT: Record<string, string> = {
  asset: 'a byte the bundle should hold and does not — record again so the closing sweep downloads it',
  fixture: 'an API call with no recorded response — browse that part of the site before closing',
  network: 'the bundle tried to leave for the real origin',
  blocked: 'refused by the current api mode — expected in off',
  visual: 'the rendered page differs from the reference captured during the browse',
}

/**
 * The mechanical answer to "is this bundle complete?" (D-034).
 *
 * Hand-reading the request tape kept rediscovering the same gaps. This runs the
 * oracles and states a verdict, so shipping does not depend on someone noticing a
 * red line scroll past.
 */
export default function Parity(props: {
  sessionId: string
  runId: string
  onToast: (text: string, tone?: 'plain' | 'good' | 'bad') => void
}) {
  const [report, setReport] = useState<ParityReport | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.parityReport(props.sessionId, props.runId)
      .then((r) => setReport(r.report))
      .catch(() => setReport(null))
  }, [props.sessionId, props.runId])

  const run = async () => {
    setBusy(true)
    try {
      const { report } = await api.parityRun(props.sessionId, props.runId)
      setReport(report)
      props.onToast(report.pass ? 'parity passed' : `parity found ${report.gaps.length} gap(s)`,
        report.pass ? 'good' : 'bad')
    } catch (e) {
      props.onToast(e instanceof Error ? e.message : String(e), 'bad')
    } finally { setBusy(false) }
  }

  const o4 = report?.oracles.O4
  const o1 = report?.oracles.O1

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="actions">
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? 'checking…' : report ? 'Check again' : 'Check bundle'}
        </button>
        <span className="note">
          Loads the bundle in a headless Chrome, records every request it makes, and compares the render
          against the reference captured during the browse. No hand-reading of the tape.
        </span>
      </div>

      {report && (
        <>
          <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 16 }}>
            <span className={`badge ${report.pass ? 'ok' : 'bad'}`}>
              {report.pass ? 'complete' : `${report.gaps.length} gap(s)`}
            </span>
            <span className="muted-count">
              {new Date(report.at).toLocaleTimeString()} · {report.viewport.width}×{report.viewport.height}
              {report.ignored ? ` · ${report.ignored} telemetry rows ignored` : ''}
            </span>
          </div>

          <div className="tiles" style={{ marginTop: 14, marginBottom: 6 }}>
            <div className={`tile ${o4 && o4.missingAsset ? 'alert' : ''}`}>
              <div className="k">missing assets</div><div className="v">{o4?.missingAsset ?? '—'}</div>
            </div>
            <div className="tile"><div className="k">missing fixtures</div>
              <div className="v">{report.oracles.O4b.graphqlMissing.length}</div></div>
            <div className="tile"><div className="k">blocked</div><div className="v">{o4?.blocked ?? '—'}</div></div>
            <div className="tile"><div className="k">served from bundle</div><div className="v">{o4?.fixture ?? '—'}</div></div>
            <div className="tile"><div className="k">visual diff</div>
              <div className="v">{o1?.skipped ? '—' : `${(o1?.differPct ?? 0).toFixed(2)}%`}</div></div>
          </div>

          {o1?.skipped && <p className="note">visual comparison skipped — {o1.reason}</p>}

          {report.gaps.length > 0 && (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>layer</th><th>what</th><th>why it matters</th></tr></thead>
              <tbody>
                {report.gaps.slice(0, 40).map((g, i) => (
                  <tr key={i}>
                    <td><span className={`badge ${g.layer === 'asset' ? 'bad' : g.layer === 'blocked' ? '' : 'warn'}`}>{g.layer}</span></td>
                    <td className="ellipsis" title={g.url ?? g.summary}>{g.url ?? g.summary}</td>
                    <td className="muted">{g.note ?? LAYER_HINT[g.layer] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report.gaps.length > 40 && (
            <p className="note">… {report.gaps.length - 40} more in <code>parity/report.json</code></p>
          )}

          {!o1?.skipped && (
            <div className="parity-shots">
              <figure>
                <figcaption>bundle</figcaption>
                <img src={api.parityAssetUrl(props.sessionId, props.runId, 'bundle.png')} alt="bundle" />
              </figure>
              <figure>
                <figcaption>reference (during the browse)</figcaption>
                <img src={api.parityReferenceUrl(props.sessionId, report.entrySnapId)} alt="reference" />
              </figure>
            </div>
          )}
        </>
      )}
    </div>
  )
}
