import {
  HelperCallout,
  StatusPill,
} from '@/features/admin/components'
import { ConfigField, text, type JsonObject } from './configFieldPrimitives'
import { MainFrameAllowlistEditor } from './MainFrameAllowlistEditor'
import { isBareHost } from './urlMatchRules'

export function NavigationEditor({
  value,
  replace,
  update,
}: {
  value: JsonObject
  replace: (next: JsonObject) => void
  update: (path: string[], raw: string | boolean | number) => void
}) {
  const host = text(value.defaultTargetHost)
  const rules = Array.isArray(value.allowedMainFrameUrls) ? value.allowedMainFrameUrls : []
  const hostOk = Boolean(host) && isBareHost(host)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={hostOk ? `Target · ${host}` : 'Target host incomplete'}
          tone={hostOk ? 'success' : 'warning'}
        />
        <StatusPill
          label={rules.length ? `Allowlist · ${rules.length}` : 'Allowlist empty'}
          tone={rules.length ? 'success' : 'warning'}
        />
      </div>

      {!hostOk ? (
        <HelperCallout tone="warning" title="Default host required">
          Enter a bare host (no scheme or path) so new sessions know where to open first.
        </HelperCallout>
      ) : null}

      <ConfigField
        id="defaultTargetHost"
        label="Default target host"
        helper="First page sessions open. Host only — no scheme or path."
        placeholder="example.com"
        value={host}
        error={host && !isBareHost(host) ? 'Enter a bare host without a scheme or path.' : undefined}
        onChange={(v) => update(['defaultTargetHost'], v)}
      />

      <div className="space-y-3 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-medium">Main-frame allowlist</h3>
          <p className="text-xs text-muted-foreground">
            Which destinations the remote browser may navigate in the main frame.
          </p>
        </div>
        <MainFrameAllowlistEditor
          defaultHost={host}
          rules={rules}
          onChange={(next) => replace({ ...value, allowedMainFrameUrls: next })}
        />
      </div>
    </div>
  )
}
