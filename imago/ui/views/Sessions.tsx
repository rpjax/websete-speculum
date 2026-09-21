import { useEffect, useMemo, useRef, useState } from 'react'
import { ago, api, bytes, type Incompatible, type SessionMeta } from '../api'
import Confirm from '../components/Confirm'

type Sort = 'when' | 'size' | 'snapshots' | 'name'

export default function Sessions(props: {
  sessions: SessionMeta[]
  incompatible: Incompatible[]
  onOpen: (id: string) => void
  onChanged: () => void
  onToast: (text: string, tone?: 'plain' | 'good' | 'bad') => void
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('when')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => { api.sizes().then(setSizes).catch(() => undefined) }, [props.sessions.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement)?.matches('input,textarea')) {
        e.preventDefault(); search.current?.focus()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? props.sessions.filter((s) =>
          s.id.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle) ||
          s.origins.join(' ').toLowerCase().includes(needle) || s.status.includes(needle))
      : props.sessions
    const sorted = [...list]
    if (sort === 'size') sorted.sort((a, b) => (sizes[b.id] ?? 0) - (sizes[a.id] ?? 0))
    else if (sort === 'snapshots') sorted.sort((a, b) => b.stats.snapshots - a.stats.snapshots)
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    return sorted
  }, [props.sessions, q, sort, sizes])

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const allShownPicked = shown.length > 0 && shown.every((s) => picked.has(s.id))

  const remove = async (ids: string[]) => {
    setConfirm(null)
    try {
      const res = await api.remove(ids)
      setPicked(new Set())
      props.onChanged()
      if (res.refused.length) {
        props.onToast(`${res.deleted.length} deleted · ${res.refused[0]?.reason ?? 'some refused'}`, 'bad')
      } else {
        props.onToast(`deleted ${res.deleted.length} session${res.deleted.length === 1 ? '' : 's'}`, 'good')
      }
    } catch (e) { props.onToast(e instanceof Error ? e.message : String(e), 'bad') }
  }

  const pickedBytes = [...picked].reduce((n, id) => n + (sizes[id] ?? 0), 0)
  const totalBytes = Object.values(sizes).reduce((a, b) => a + b, 0)

  return (
    <>
      <h2>sessions</h2>
      <p className="sub">
        A closed session is never modified — generating and previewing read it. Nothing is deleted
        unless you delete it. {props.sessions.length} session{props.sessions.length === 1 ? '' : 's'},
        {' '}{bytes(totalBytes)} on disk.
      </p>

      {props.incompatible.length > 0 && (
        <div className="banner bad">
          <b>{props.incompatible.length} session{props.incompatible.length === 1 ? '' : 's'} cannot be read by this build.</b>
          {' '}They were written by an earlier version of Imago. There is no conversion — the data is
          simply no longer readable, so the only thing to do with it is remove it.
          <table className="mini">
            <tbody>
              {props.incompatible.slice(0, 8).map((x) => (
                <tr key={x.id}><td className="mono">{x.id}</td><td className="muted">{x.reason}</td></tr>
              ))}
              {props.incompatible.length > 8 && (
                <tr><td className="muted" colSpan={2}>… {props.incompatible.length - 8} more</td></tr>
              )}
            </tbody>
          </table>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn danger small"
                    onClick={() => setConfirm({
                      ids: props.incompatible.map((x) => x.id),
                      label: `Delete all ${props.incompatible.length} unreadable`,
                    })}>
              Delete all unreadable
            </button>
          </div>
        </div>
      )}

      <div className="tape-bar" style={{ marginBottom: 12 }}>
        <input ref={search} className="filter" value={q}
               placeholder="filter by name, id, origin or status…   ( / )"
               onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {(['when', 'size', 'snapshots', 'name'] as Sort[]).map((k) => (
            <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{k}</button>
          ))}
        </div>
        <span className="spacer" />
        <span className="muted-count">{shown.length} of {props.sessions.length}</span>
      </div>

      {picked.size > 0 && (
        <div className="banner">
          <b>{picked.size} selected</b> · {bytes(pickedBytes)}
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn danger small"
                    onClick={() => setConfirm({ ids: [...picked], label: `Delete ${picked.size} session${picked.size === 1 ? '' : 's'}` })}>
              Delete selected
            </button>
            <button className="btn small" onClick={() => setPicked(new Set())}>Clear selection</button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card"><div className="empty">
          {props.sessions.length ? 'nothing matches the filter' : 'no sessions yet — record one from the Record view'}
        </div></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input type="checkbox" checked={allShownPicked}
                         onChange={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((s) => s.id)))} />
                </th>
                <th>session</th><th>status</th><th>snaps</th><th>reqs</th>
                <th>on disk</th><th>when</th><th>origins</th><th>name</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  </td>
                  <td className="click-cell" onClick={() => props.onOpen(s.id)}>{s.id}</td>
                  <td><span className={`badge ${s.status === 'closed' ? 'ok' : s.status === 'failed' ? 'bad' : ''}`}>{s.status}</span></td>
                  <td>{s.stats.snapshots}</td>
                  <td>{s.stats.requests}</td>
                  <td>{sizes[s.id] === undefined ? '—' : bytes(sizes[s.id] as number)}</td>
                  <td className="muted">{ago(s.openedAt)}</td>
                  <td className="muted ellipsis">{s.origins.join(', ') || '—'}</td>
                  <td className="muted ellipsis">{s.name}</td>
                  <td className="right">
                    <button className="btn small" onClick={() => props.onOpen(s.id)}>Open</button>
                    <button className="btn small danger" style={{ marginLeft: 6 }}
                            onClick={() => setConfirm({ ids: [s.id], label: 'Delete session' })}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <Confirm
          title={confirm.label}
          confirmLabel={confirm.label}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void remove(confirm.ids)}
          body={
            <>
              <p>
                This removes {confirm.ids.length === 1 ? 'the session' : `${confirm.ids.length} sessions`} and
                everything inside — the timeline, the captured bytes, the snapshots, and any bundle
                generated from {confirm.ids.length === 1 ? 'it' : 'them'}.
              </p>
              <p className="note">
                {bytes(confirm.ids.reduce((n, id) => n + (sizes[id] ?? 0), 0))} on disk.
                A browse cannot be replayed — deleting a session throws away work that took a human to
                produce.
              </p>
              <ul className="plain scroll" style={{ maxHeight: 140 }}>
                {confirm.ids.slice(0, 30).map((id) => <li key={id}>{id}</li>)}
                {confirm.ids.length > 30 && <li>… {confirm.ids.length - 30} more</li>}
              </ul>
            </>
          }
        />
      )}
    </>
  )
}
