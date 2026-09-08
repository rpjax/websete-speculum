import { useEffect, useMemo, useRef, useState } from 'react'

export interface TapeLine { seq: number; at: string; kind: string; text: string; tone: string; status?: number }

/**
 * The tape, with the controls that make a long one usable: filter, pause, and a
 * count. A live log you cannot stop scrolling is a log you cannot read.
 */
export default function Tape({ lines, height = 340 }: { lines: TapeLine[]; height?: number }) {
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return lines
    return lines.filter((l) => l.kind.toLowerCase().includes(q) || l.text.toLowerCase().includes(q))
  }, [lines, filter])

  useEffect(() => {
    if (!paused) end.current?.scrollIntoView({ block: 'end' })
  }, [shown.length, paused])

  return (
    <>
      <div className="tape-bar">
        <input className="filter" value={filter} placeholder="filter…"
               onChange={(e) => setFilter(e.target.value)} />
        <button className="link" onClick={() => setPaused((p) => !p)}>
          {paused ? '▷ follow' : '❚❚ pause'}
        </button>
        <span className="spacer" />
        <span className="muted-count">
          {shown.length}{filter && ` / ${lines.length}`} line{shown.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="tape" style={{ height }}>
        {shown.length === 0 && <div className="empty">{lines.length ? 'nothing matches the filter' : 'nothing yet…'}</div>}
        {shown.map((l) => (
          <div key={l.seq} className={`line tone-${l.tone}`}>
            <span className="t">{new Date(l.at).toLocaleTimeString()}</span>
            <span className="k">{l.kind}{l.status ? ` ${l.status}` : ''}</span>
            <span className="x" title={l.text}>{l.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </>
  )
}
