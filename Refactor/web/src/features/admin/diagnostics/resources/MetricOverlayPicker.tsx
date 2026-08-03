import { metricsBySection } from '@/lib/resourceChartCompute'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

type Props = {
  selected: string[]
  onChange: (keys: string[]) => void
}

export function MetricOverlayPicker({ selected, onChange }: Props) {
  const sections = metricsBySection()

  function toggle(key: string) {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key))
    else onChange([...selected, key])
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          + Metric
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-96 overflow-y-auto" align="start">
        <p className="mb-2 text-xs text-muted-foreground">Filter metrics…</p>
        <div className="space-y-4">
          {sections.map(({ section, metrics }) => (
            <div key={section.key}>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {section.label}
              </div>
              <ul className="space-y-1.5">
                {metrics.map((m) => (
                  <li key={m.key} className="flex items-start gap-2">
                    <Checkbox
                      id={`metric-${m.key}`}
                      checked={selected.includes(m.key)}
                      onCheckedChange={() => toggle(m.key)}
                    />
                    <Label htmlFor={`metric-${m.key}`} className="text-sm font-normal leading-tight">
                      {m.label}
                      <span className="block text-xs text-muted-foreground">{m.key}</span>
                    </Label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
