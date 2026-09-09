import { useState } from 'react'
import type { CloseReport } from '../api'

/** C-4 in the UI: a closed world is stated, and a hole is named — grouped, not dumped. */
export default function Closure({ report }: { report: CloseReport }) {
  const [open, setOpen] = useState(false)
  const closed = report.unresolved.length === 0
  return (
    <>
      <div className="row" style={{ gap: 14, alignItems: 'baseline', marginBottom: 12 }}>
        <span className="mono">{report.sessionId}</span>
        <span className={`badge ${report.status === 'failed' ? 'bad' : 'ok'}`}>{report.status}</span>
      </div>
      <div className="tiles" style={{ marginBottom: 14 }}>
        <div className="tile"><div className="k">snapshots</div><div className="v">{report.snapshots}</div></div>
        <div className="tile"><div className="k">requests</div><div className="v">{report.requests}</div></div>
        <div className="tile"><div className="k">trees</div><div className="v">{report.trees}</div></div>
        <div className="tile"><div className="k">styles</div><div className="v">{report.styles}</div></div>
        <div className="tile"><div className="k">assets</div><div className="v">{report.assets}</div></div>
        <div className="tile"><div className="k">resolved at close</div><div className="v">{report.resolved}</div></div>
        <div className={`tile ${report.errors ? 'alert' : ''}`}><div className="k">errors</div><div className="v">{report.errors}</div></div>
      </div>

      {closed ? (
        <div className="banner ok">
          <b>closure check (C-4): closed.</b> Every reference resolved
          {report.resolved > 0 && <> — {report.resolved} of them fetched by the resolver at close, because the
          page referenced them without ever requesting them (lazy images, unused <code>srcset</code> densities)</>}.
        </div>
      ) : (
        <div className="banner bad">
          <b>closure check (C-4): {report.unresolved.length} reference(s) still missing</b> after the resolver
          fetched {report.resolved}. A generator refuses to run on a non-closed session (E5).
          <table className="mini">
            <tbody>
              {report.unresolvedByHost.slice(0, 8).map((h) => (
                <tr key={h.host}><td className="mono">{h.host}</td><td className="mono right">{h.count}</td></tr>
              ))}
            </tbody>
          </table>
          <button className="link" onClick={() => setOpen((o) => !o)}>
            {open ? 'hide urls' : `show urls (${report.unresolved.length})`}
          </button>
          {open && (
            <ul className="plain scroll">
              {report.unresolved.slice(0, 300).map((u) => (
                <li key={u.url}><span className="muted">[{u.reason}]</span> {u.url}</li>
              ))}
              {report.unresolved.length > 300 && <li>… {report.unresolved.length - 300} more</li>}
            </ul>
          )}
        </div>
      )}
    </>
  )
}
