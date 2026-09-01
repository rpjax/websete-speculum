import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export type EmptyStateCta = { label: string; href?: string; onClick?: () => void }
export function EmptyState({ title, body, cta, tone = 'neutral' }: { title: string; body: string; cta?: EmptyStateCta; tone?: 'neutral' | 'reassure' }) {
  const action = cta ? cta.href ? <Button asChild><Link to={cta.href}>{cta.label}</Link></Button> : <Button onClick={cta.onClick}>{cta.label}</Button> : null
  return <section className={tone === 'reassure' ? 'rounded-lg border border-border bg-muted/30 p-8 text-center' : 'rounded-lg border border-dashed border-border p-8 text-center'}><h2 className="font-medium">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>{action ? <div className="mt-4">{action}</div> : null}</section>
}
