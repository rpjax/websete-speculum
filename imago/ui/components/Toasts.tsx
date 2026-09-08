export interface Toast { id: string; text: string; tone: 'plain' | 'good' | 'bad' }

export default function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
    </div>
  )
}
