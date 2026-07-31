import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function NextBestAction({ title, body, ctaLabel, href, onClick, tone = 'info', disabled }: { title: string; body: string; ctaLabel: string; href?: string; onClick?: () => void; tone?: 'info' | 'warning'; disabled?: boolean }) {
  const cta = href ? <Button asChild disabled={disabled}><Link to={href}>{ctaLabel}<ArrowRight className="h-4 w-4" /></Link></Button> : <Button onClick={onClick} disabled={disabled}>{ctaLabel}<ArrowRight className="h-4 w-4" /></Button>
  return <section aria-label="Next step" className={`rounded-lg border p-5 ${tone === 'warning' ? 'border-warning/30 bg-warning/5' : 'border-primary/30 bg-primary/5'}`}><h2 className="font-medium">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{body}</p><div className="mt-4">{cta}</div></section>
}
