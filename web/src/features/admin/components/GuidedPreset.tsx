import { Button } from '@/components/ui/button'
export function GuidedPreset({ presets }: { presets: { id: string; label: string; apply: () => void }[] }) { return <div role="group" aria-label="Presets" className="flex flex-wrap gap-2">{presets.map((preset) => <Button key={preset.id} type="button" variant="outline" size="sm" onClick={preset.apply}>{preset.label}</Button>)}</div> }
