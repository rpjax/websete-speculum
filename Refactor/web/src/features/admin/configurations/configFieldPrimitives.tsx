import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { InlineValidation } from '@/features/admin/components'

export type JsonObject = Record<string, unknown>

export const text = (value: unknown) =>
  typeof value === 'string' ? value : value == null ? '' : String(value)

export const nested = (section: JsonObject, parent: string, key: string) => {
  const child = section[parent]
  return child && typeof child === 'object' ? (child as JsonObject)[key] : undefined
}

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

export function ConfigField({
  id,
  label,
  helper,
  value,
  onChange,
  type = 'text',
  min,
  max,
  step,
  placeholder,
  error,
  className,
}: {
  id: string
  label: string
  helper?: string
  value: string
  onChange: (value: string) => void
  type?: string
  min?: number
  max?: number
  step?: number
  placeholder?: string
  error?: string
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
      <InlineValidation message={error} />
    </div>
  )
}

export function ConfigEnumSelect({
  id,
  label,
  helper,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  helper?: string
  value: string
  options: Array<[string, string, string?]>
  onChange: (value: string) => void
}) {
  const selected = options.find(([key]) => key === value)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, optionLabel]) => (
            <SelectItem key={key} value={key}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {helper ? (
        <p className="text-xs text-muted-foreground">{helper}</p>
      ) : selected?.[2] ? (
        <p className="text-xs text-muted-foreground">{selected[2]}</p>
      ) : null}
    </div>
  )
}

export function ConfigChipRow({
  children,
  label,
  className,
}: {
  children: ReactNode
  label?: string
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)} role="group" aria-label={label}>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

export function ConfigChip({
  active,
  label,
  onClick,
  disabled,
}: {
  active?: boolean
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      disabled={disabled}
      onClick={onClick}
      className={cn(active && 'ring-1 ring-ring')}
    >
      {label}
    </Button>
  )
}

/** Honest step label — pass totalSteps so copy matches the real flow. */
export function ConfigControlStep({
  step,
  totalSteps,
  title,
  helper,
  children,
}: {
  step: number
  totalSteps: number
  title: string
  helper?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-3 sm:p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {step} of {totalSteps}
        </p>
        <h3 className="text-sm font-medium">{title}</h3>
        {helper ? <p className="mt-0.5 text-xs text-muted-foreground">{helper}</p> : null}
      </div>
      {children}
    </section>
  )
}
