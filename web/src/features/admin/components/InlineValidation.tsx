export function InlineValidation({ id, message, tone = 'error' }: { id?: string; message?: string; tone?: 'error' | 'hint' }) {
  if (!message) return null
  return <p id={id} className={`mt-1 text-xs ${tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>
}
