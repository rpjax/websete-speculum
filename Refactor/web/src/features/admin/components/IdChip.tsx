import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id)

export function IdChip({
  id,
  href,
  className,
  alwaysShort,
}: {
  id: string
  href?: string
  className?: string
  alwaysShort?: boolean
}) {
  const body = (
    <>
      <span className={alwaysShort ? undefined : 'sm:hidden'}>{shortId(id)}</span>
      {!alwaysShort ? <span className="hidden sm:inline">{id}</span> : null}
    </>
  )
  const classes = cn(
    'inline-flex max-w-full items-center rounded-md bg-muted/60 px-2 py-1 font-mono text-xs text-foreground transition-colors hover:bg-muted',
    className,
  )
  if (href) {
    return (
      <Link to={href} className={classes} title={id}>
        {body}
      </Link>
    )
  }
  return (
    <span className={classes} title={id}>
      {body}
    </span>
  )
}

export { shortId as formatShortId }
