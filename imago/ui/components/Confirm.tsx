/** Deletion is irreversible, so it is always one deliberate click away, never one. */
export default function Confirm(props: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="scrim" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        <div className="modal-body">{props.body}</div>
        <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn" onClick={props.onCancel}>Cancel</button>
          <button className="btn danger" onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
