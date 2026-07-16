import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { NarrativeGranularity } from '../model/narrativeTypes'

const OPTIONS: { value: NarrativeGranularity; label: string; tip: string }[] = [
  { value: 'chapters', label: 'Chapters', tip: 'Chapter blocks only' },
  { value: 'chapters+spans', label: 'Chapters + spans', tip: 'Show span durations inside chapters' },
  { value: 'full', label: 'Full beats', tip: 'Show every beat on the ribbon' },
]

interface GranularityControlProps {
  value: NarrativeGranularity
  onChange: (value: NarrativeGranularity) => void
  compact?: boolean
}

export function GranularityControl({ value, onChange, compact }: GranularityControlProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as NarrativeGranularity)}>
      <SelectTrigger
        className={compact ? 'h-7 w-[118px] shrink-0 text-[11px]' : 'h-8 w-[160px] text-xs'}
        aria-label="Detail granularity"
      >
        {!compact && <span className="mr-1 text-muted-foreground">Detail:</span>}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
