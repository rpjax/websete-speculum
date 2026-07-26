import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { PageHeader } from '@/components/admin/PageHeader'
import { ConfigSectionCard } from '@/components/admin/ConfigSectionCard'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructive'
import { useConfigSection } from '@/lib/hooks/useConfigSection'
import { ConfigSections } from '@/lib/api'

export default function CapacityPage() {
  const maxSessions = useConfigSection({
    section: ConfigSections.MaxSessions,
    initial: 4,
    mapIn: (raw) => Number(raw ?? 4),
    mapOut: (v) => v,
  })

  const policy = useConfigSection({
    section: ConfigSections.SessionPolicy,
    initial: { ttlDays: 30 },
    mapIn: (raw) => {
      const r = raw as { ttlDays?: number }
      return { ttlDays: r?.ttlDays ?? 30 }
    },
    mapOut: (v) => v,
  })

  const bridge = useConfigSection({
    section: ConfigSections.JsBridge,
    initial: { enable: false },
    mapIn: (raw) => {
      const r = raw as { enable?: boolean }
      return { enable: !!r?.enable }
    },
    mapOut: (v) => v,
  })

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Capacity & bridges"
        description="Limit concurrent browsers, session retention, and the optional vcon eval bridge. Rare options stay collapsed."
      />

      <ConfigSectionCard
        title="Max sessions"
        description="How many remote browsers can run at the same time on this motor."
        loading={maxSessions.loading}
        pending={maxSessions.pending}
        message={maxSessions.message}
        error={maxSessions.error}
        onSave={() => void maxSessions.save()}
      >
        <div className="space-y-2">
          <Label htmlFor="max">Concurrent sessions (1–65535)</Label>
          <Input
            id="max"
            type="number"
            min={1}
            max={65535}
            value={maxSessions.value}
            onChange={(e) => maxSessions.setValue(Number(e.target.value))}
          />
        </div>
      </ConfigSectionCard>

      <ConfigSectionCard
        title="Session policy"
        description="How long persisted browser state is kept before expiry."
        loading={policy.loading}
        pending={policy.pending}
        message={policy.message}
        error={policy.error}
        onSave={() => void policy.save()}
        secondary={
          <ConfirmDestructiveButton
            label="Reset to default"
            size="sm"
            title="Reset session policy?"
            description="Removes the stored policy. The motor will use the default 30-day TTL."
            confirmLabel="Reset"
            onConfirm={() => void policy.remove({ ttlDays: 30 }, 'Reset to default TTL')}
          />
        }
      >
        <div className="space-y-2">
          <Label htmlFor="ttl">TTL (days)</Label>
          <Input
            id="ttl"
            type="number"
            min={1}
            value={policy.value.ttlDays}
            onChange={(e) => policy.setValue({ ttlDays: Number(e.target.value) })}
          />
        </div>
      </ConfigSectionCard>

      <ConfigSectionCard
        title="JsBridge"
        description="Allows page scripts to evaluate JavaScript in the remote browser via vcon. Keep off unless you need it."
        loading={bridge.loading}
        pending={bridge.pending}
        message={bridge.message}
        error={bridge.error}
        onSave={() => void bridge.save()}
        secondary={
          <ConfirmDestructiveButton
            label="Disable & clear"
            size="sm"
            title="Clear JsBridge config?"
            description="Deletes the stored section. JsBridge stays disabled by default."
            confirmLabel="Clear"
            onConfirm={() => void bridge.remove({ enable: false }, 'Cleared (disabled by default)')}
          />
        }
      >
        <div className="flex items-center gap-3">
          <Switch
            id="jsbridge"
            checked={bridge.value.enable}
            onCheckedChange={(enable) => bridge.setValue({ enable })}
          />
          <Label htmlFor="jsbridge">Enable JsBridge</Label>
        </div>
        <Accordion type="single" collapsible>
          <AccordionItem value="adv">
            <AccordionTrigger>Why this matters</AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground">
              When enabled, trusted injected or page-side scripts can ask the motor to run evaluate
              operations in the remote Chrome. Disable in production unless operators rely on it.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </ConfigSectionCard>
    </div>
  )
}
