import type { ReactNode } from 'react'
import { Info, TriangleAlert, OctagonAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

const styles = {
  info: 'border-primary/30 bg-primary/5',
  warning: 'border-warning/30 bg-warning/5',
  danger: 'border-destructive/30 bg-destructive/5',
}
const icons = { info: Info, warning: TriangleAlert, danger: OctagonAlert }

export function HelperCallout({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger'
  title?: string
  children: ReactNode
  action?: { label: string; href: string }
}) {
  const Icon = icons[tone]
  return (
    <aside
      role={tone === 'danger' ? 'alert' : 'note'}
      className={`flex gap-3 rounded-lg border p-4 text-sm ${styles[tone]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={title ? 'mt-1 text-muted-foreground' : 'text-muted-foreground'}>{children}</div>
        {action ? (
          <Link className="mt-2 inline-block font-medium underline" to={action.href}>
            {action.label}
          </Link>
        ) : null}
      </div>
    </aside>
  )
}
