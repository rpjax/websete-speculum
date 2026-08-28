import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SearchFilter({ value, onChange, placeholder, debounceMs = 200 }: { value: string; onChange: (value: string) => void; placeholder: string; debounceMs?: number }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => { const timer = window.setTimeout(() => onChange(draft), debounceMs); return () => window.clearTimeout(timer) }, [draft, debounceMs, onChange])
  return <div role="search" className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={placeholder} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} className="pl-9 pr-9" />{draft ? <Button type="button" variant="ghost" size="icon" aria-label="Clear filter" className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2" onClick={() => setDraft('')}><X className="h-4 w-4" /></Button> : null}</div>
}
