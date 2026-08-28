import { Badge } from '@/components/ui/badge'
export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }) {
  const variant = tone === 'danger' ? 'destructive' : tone === 'neutral' ? 'muted' : tone === 'info' ? 'default' : tone
  return <Badge variant={variant}>{label}</Badge>
}
