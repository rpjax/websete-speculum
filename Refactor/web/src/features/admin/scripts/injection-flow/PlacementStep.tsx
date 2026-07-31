import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GuidedPreset, HelperCallout } from '@/features/admin/components'
import { cn } from '@/lib/utils'
import type { Injection } from '../scriptTypes'

const positions: Array<[Injection['position'], string, string]> = [
  ['headStart', 'Head start', 'Top of <head>'],
  ['headEnd', 'Before </head>', 'End of <head>'],
  ['bodyStart', 'Body start', 'Top of <body>'],
  ['bodyEnd', 'Body end', 'End of <body>'],
]

export function PlacementStep({ draft, onChange }: { draft: Injection; onChange: (next: Injection) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Placement</h2>
        <p className="text-sm text-muted-foreground">Choose where and how the script tag is added.</p>
      </div>

      <PlacementDiagram selected={draft.position} onSelect={(position) => onChange({ ...draft, position })} />

      <div className="space-y-2">
        <Label>Quick picks</Label>
        <GuidedPreset
          presets={positions.map(([value, label]) => ({
            id: value,
            label,
            apply: () => onChange({ ...draft, position: value }),
          }))}
        />
      </div>

      <div className="space-y-2">
        <Label>Position</Label>
        <Select
          value={draft.position}
          onValueChange={(position) => onChange({ ...draft, position: position as Injection['position'] })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {positions.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Execution</legend>
        <label className="mr-5 inline-flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={draft.executionType === 'classic'}
            onChange={() => onChange({ ...draft, executionType: 'classic' })}
          />
          Classic
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={draft.executionType === 'module'}
            onChange={() => onChange({ ...draft, executionType: 'module' })}
          />
          Module
        </label>
      </fieldset>
      <HelperCallout>Module scripts use type=&quot;module&quot;.</HelperCallout>
    </div>
  )
}

function PlacementDiagram({
  selected,
  onSelect,
}: {
  selected: Injection['position']
  onSelect: (position: Injection['position']) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card font-mono text-xs" aria-label="Injection position diagram">
      <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        Document sketch
      </div>
      <div className="space-y-1 p-3 text-muted-foreground">
        <p>&lt;html&gt;</p>
        <p className="pl-3">&lt;head&gt;</p>
        <SlotButton active={selected === 'headStart'} label="Head start" hint="Top of head" onClick={() => onSelect('headStart')} />
        <p className="pl-6 text-[10px] text-muted-foreground/70">… meta, title, styles …</p>
        <SlotButton active={selected === 'headEnd'} label="Before &lt;/head&gt;" hint="End of head" onClick={() => onSelect('headEnd')} />
        <p className="pl-3">&lt;/head&gt;</p>
        <p className="pl-3">&lt;body&gt;</p>
        <SlotButton active={selected === 'bodyStart'} label="Body start" hint="Top of body" onClick={() => onSelect('bodyStart')} />
        <p className="pl-6 text-[10px] text-muted-foreground/70">… page content …</p>
        <SlotButton active={selected === 'bodyEnd'} label="Body end" hint="End of body" onClick={() => onSelect('bodyEnd')} />
        <p className="pl-3">&lt;/body&gt;</p>
        <p>&lt;/html&gt;</p>
      </div>
    </div>
  )
}

function SlotButton({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'ml-6 flex w-[calc(100%-1.5rem)] items-center justify-between rounded-md border px-2.5 py-2 text-left transition-colors',
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-dashed border-border bg-background/50 text-muted-foreground hover:border-primary/50 hover:text-foreground',
      )}
    >
      <span className="font-sans text-xs font-medium">{label}</span>
      <span className="font-sans text-[10px] text-muted-foreground">{hint}</span>
    </button>
  )
}
