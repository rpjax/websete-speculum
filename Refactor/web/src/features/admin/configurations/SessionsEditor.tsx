import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  DataCard,
  FieldGrid,
  HelperCallout,
  InlineValidation,
  RevealPanel,
  StatusPill,
  SwitchField,
} from '@/features/admin/components'
import {
  CLIENT_ENV_PRESETS,
  COLOR_SCHEME_OPTIONS,
  DETACHED_TIMEOUT_PRESETS,
  DEVICE_EMULATION_PRESETS,
  DATA_STREAM_TRANSPORT_OPTIONS,
  MIRROR_MODE_OPTIONS,
  INPUT_ACCESS_OPTIONS,
  INPUT_OWNERSHIP_OPTIONS,
  INPUT_SCHEDULING_OPTIONS,
  OUTPUT_DELIVERY_OPTIONS,
  OUTPUT_OWNERSHIP_OPTIONS,
  SESSIONS_FILL_GAPS_POSTURE,
  SESSIONS_GUIDED_PRESETS,
  SCREEENCAST_SHARPNESS_PRESETS,
  VIEWPORT_SIZE_PRESETS,
  applySessionsGuidedPreset,
  asNumber,
  asObject,
  detachedTimeoutPresetId,
  fillSessionsGaps,
  mergeDeviceEmulation,
  screencastSharpnessId,
  summarizeSessions,
  text,
  validateClientEnvironment,
  validateDetachedTimeout,
  validateScreencastScale,
  validateViewportOrdering,
  viewportSizePresetId,
  type JsonObject,
  type SessionsGuidedPresetId,
} from './sessionsHelpers'
import {
  ConfigChipRow,
  ConfigControlStep,
  ConfigEnumSelect,
  ConfigField,
} from './configFieldPrimitives'
import { describeTimeSpan } from './resourceManagementHelpers'

type PosturePickId = SessionsGuidedPresetId | 'fill-gaps'

export function SessionsEditor({
  value,
  replace,
  update,
}: {
  value: JsonObject
  replace: (next: JsonObject) => void
  update: (path: string[], raw: string | boolean | number) => void
}) {
  const [pickedPosture, setPickedPosture] = useState<PosturePickId | null>(null)
  const [showCustomTimeout, setShowCustomTimeout] = useState(
    () => detachedTimeoutPresetId(text(value.detachedSessionTimeout)) === 'custom',
  )
  const [showCustomViewport, setShowCustomViewport] = useState(() => {
    const vp = asObject(asObject(value.viewportPolicy).default)
    return viewportSizePresetId(asNumber(vp.width, 1280), asNumber(vp.height, 720)) === 'custom'
  })

  const summary = summarizeSessions(value)
  const viewport = asObject(value.viewportPolicy)
  const defaults = asObject(viewport.default)
  const minimum = asObject(viewport.minimum)
  const maximum = asObject(viewport.maximum)
  const clientEnvironment = asObject(value.clientEnvironmentPolicy)
  const devicePolicy = asObject(value.deviceEmulationPolicy)
  const deviceDefault = asObject(devicePolicy.default)
  const input = asObject(value.inputMultiplexingPolicy)
  const output = asObject(value.outputMultiplexingPolicy)

  const timeoutRaw = text(value.detachedSessionTimeout)
  const timeoutPreset = detachedTimeoutPresetId(timeoutRaw)
  const timeoutError = validateDetachedTimeout(timeoutRaw)
  const viewportError = validateViewportOrdering(value)
  const clientError = validateClientEnvironment(value)
  const screencastError = validateScreencastScale(value)
  const sharpnessId = screencastSharpnessId(asObject(value.screencastPolicy).maxEncodeScale)
  const needsBootstrap =
    !value.viewportPolicy || !value.clientEnvironmentPolicy || !value.deviceEmulationPolicy

  const defaultWidth = asNumber(defaults.width, 1280)
  const defaultHeight = asNumber(defaults.height, 720)
  const sizePreset = viewportSizePresetId(defaultWidth, defaultHeight)
  const exclusiveFrames = summary.delivery === 'exclusive'
  const picked =
    pickedPosture === 'fill-gaps'
      ? SESSIONS_FILL_GAPS_POSTURE
      : (SESSIONS_GUIDED_PRESETS.find((preset) => preset.id === pickedPosture) ?? null)

  const touchFields = (next: JsonObject) => {
    setPickedPosture(null)
    replace(next)
  }

  const patchField = (path: string[], raw: string | boolean | number) => {
    setPickedPosture(null)
    update(path, raw)
  }

  const applyClientEnv = (presetId: string) => {
    const found = CLIENT_ENV_PRESETS.find((item) => item.id === presetId)
    if (!found) return
    touchFields({
      ...value,
      clientEnvironmentPolicy: {
        ...clientEnvironment,
        defaultLocale: found.defaultLocale,
        defaultLanguage: found.defaultLanguage,
        defaultTimeZoneId: found.defaultTimeZoneId,
        defaultColorScheme: found.defaultColorScheme,
      },
    })
  }

  const applyDevicePreset = (presetId: string) => {
    const found = DEVICE_EMULATION_PRESETS.find((item) => item.id === presetId)
    if (!found) return
    touchFields({
      ...value,
      deviceEmulationPolicy: mergeDeviceEmulation(devicePolicy, found.patch as JsonObject),
    })
  }

  const applyPosture = (id: PosturePickId) => {
    setPickedPosture(id)
    if (id === 'fill-gaps') {
      replace(fillSessionsGaps(value))
      return
    }
    const preset = SESSIONS_GUIDED_PRESETS.find((item) => item.id === id)
    if (preset) replace(applySessionsGuidedPreset(value, preset))
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">Current posture</p>
          <p className="text-sm text-muted-foreground">
            {summary.complete
              ? `Sessions keep running ${summary.timeoutLabel} after the last disconnect, start at ${summary.viewportLabel}, stream ${summary.sharpnessLabel.toLowerCase()}, ${summary.jsBridge ? 'with' : 'without'} the JS bridge, use ${summary.dataStreamTransportLabel} for frames/input, mirror as ${summary.mirrorModeLabel}, and ${summary.access === 'exclusive' ? 'limit typing to one owner' : 'let attached clients share typing'} while ${summary.delivery === 'broadcast' ? 'sending video to every attached client' : 'sending video only to the owning client'}.`
              : 'Some required settings are missing. Choose a starting posture or Keep my values before saving.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill
            label={summary.complete ? `Hold · ${summary.timeoutLabel}` : 'Sessions incomplete'}
            tone={summary.complete ? 'success' : 'warning'}
          />
          <StatusPill
            label={summary.jsBridge ? 'JS bridge on' : 'JS bridge off'}
            tone={summary.jsBridge ? 'info' : 'neutral'}
          />
          <StatusPill
            label={`Viewport · ${summary.viewportLabel}`}
            tone={summary.hasViewport ? 'success' : 'warning'}
          />
          <StatusPill
            label={`${summary.access === 'exclusive' ? 'Exclusive' : 'Shared'} in · ${summary.delivery === 'broadcast' ? 'Broadcast' : 'Exclusive'} out`}
            tone={exclusiveFrames ? 'warning' : 'neutral'}
          />
          <StatusPill
            label={`Data · ${summary.dataStreamTransportLabel}`}
            tone="info"
          />
          <StatusPill
            label={`Mirror · ${summary.mirrorModeLabel}`}
            tone={summary.mirrorMode === 'domProjection' ? 'warning' : 'info'}
          />
          <StatusPill
            label={`Stream · ${summary.sharpnessLabel}`}
            tone={summary.sharpnessId === 'lean' ? 'neutral' : 'success'}
          />
        </div>
      </div>

      {needsBootstrap ? (
        <HelperCallout tone="warning" title="Recommended defaults required">
          Viewport, client environment, and device defaults are required. Pick{' '}
          <span className="font-medium text-foreground">Lab</span> or{' '}
          <span className="font-medium text-foreground">Keep my values</span> below before saving.
        </HelperCallout>
      ) : null}

      <DataCard className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Choose a starting posture</h3>
          <p className="text-xs text-muted-foreground">
            One choice fills the knobs below. Nothing hits the engine until you click Save Sessions.
          </p>
        </div>

        <div role="radiogroup" aria-label="Session posture presets" className="grid gap-2 sm:grid-cols-2">
          {[...SESSIONS_GUIDED_PRESETS, SESSIONS_FILL_GAPS_POSTURE].map((preset) => {
            const selected = pickedPosture === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => applyPosture(preset.id)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background/40 hover:bg-muted/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{preset.label}</p>
                  {selected ? (
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" aria-hidden />
                    </span>
                  ) : (
                    <span
                      className="mt-0.5 inline-flex h-5 w-5 shrink-0 rounded-full border border-border"
                      aria-hidden
                    />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
                <p className="mt-2 text-[11px] leading-snug text-foreground/80">{preset.effect}</p>
              </button>
            )
          })}
        </div>

        {picked ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={`Applied · ${picked.label}`} tone="success" />
            <p className="text-xs text-muted-foreground">Review the steps below, then Save when ready.</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Not sure? Start with <span className="font-medium text-foreground">Lab</span> on a laptop, or{' '}
            <span className="font-medium text-foreground">Shared viewing</span> when others attach.
          </p>
        )}
      </DataCard>

      <DataCard className="space-y-6 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Primary session answers</h3>
          <p className="text-xs text-muted-foreground">
            Six decisions most operators need. Locale, device profile, resize limits, and multi-client sharing stay
            collapsed until you open them below.
          </p>
        </div>

        <div className="space-y-6">
          <ConfigControlStep
            step={1}
            totalSteps={6}
            title="How long should a session stay after the last disconnect?"
            helper="After every client leaves, Speculum keeps the browser alive for this hold so someone can reattach. Shorter is safer on shared hosts."
          >
            <ConfigChipRow label="Detach hold presets">
              {DETACHED_TIMEOUT_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant={timeoutPreset === preset.id && !showCustomTimeout ? 'default' : 'outline'}
                  onClick={() => {
                    setShowCustomTimeout(false)
                    patchField(['detachedSessionTimeout'], preset.value)
                  }}
                >
                  {preset.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={showCustomTimeout || timeoutPreset === 'custom' ? 'default' : 'outline'}
                onClick={() => {
                  setShowCustomTimeout(true)
                  if (timeoutPreset !== 'custom') {
                    patchField(['detachedSessionTimeout'], timeoutRaw.trim() || '00:30:00')
                  }
                }}
              >
                Custom…
              </Button>
            </ConfigChipRow>
            {showCustomTimeout || timeoutPreset === 'custom' ? (
              <div className="space-y-1.5">
                <Label htmlFor="detachedSessionTimeout">Custom hold (.NET TimeSpan)</Label>
                <Input
                  id="detachedSessionTimeout"
                  value={timeoutRaw}
                  placeholder="00:30:00"
                  onChange={(event) => patchField(['detachedSessionTimeout'], event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Example: 00:05:00 is five minutes. Current: {describeTimeSpan(timeoutRaw)}.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Selected hold: <span className="font-medium text-foreground">{describeTimeSpan(timeoutRaw)}</span>
              </p>
            )}
            <InlineValidation message={timeoutError} />
          </ConfigControlStep>

          <ConfigControlStep
            step={2}
            totalSteps={6}
            title="May pages use the JavaScript bridge?"
            helper="When on, sessions can expose the in-page scripting bridge for automation and lab scripts. Turn off on hosts that must not admit bridge-capable pages."
          >
            <SwitchField
              id="isJsBridgeEnabled"
              label={summary.jsBridge ? 'JS bridge enabled' : 'JS bridge disabled'}
              helper={
                summary.jsBridge
                  ? 'Page scripting bridge is available for new sessions.'
                  : 'New sessions will not expose an in-page bridge surface.'
              }
              checked={Boolean(value.isJsBridgeEnabled)}
              onCheckedChange={(checked) => patchField(['isJsBridgeEnabled'], checked)}
            />
          </ConfigControlStep>

          <ConfigControlStep
            step={3}
            totalSteps={6}
            title="Which data-stream transport should new sessions use?"
            helper="Frames, input, and console ride this carrier. Save applies immediately for new sessions; open browsers must refresh. WebSocket is same-origin proxyable; WebTransport needs HTTP/3 to the API."
          >
            <ConfigEnumSelect
              id="dataStreamTransport"
              label="Data stream transport"
              value={
                text(value.dataStreamTransport) === 'webSocket' ? 'webSocket' : 'webTransport'
              }
              options={DATA_STREAM_TRANSPORT_OPTIONS}
              onChange={(v) => patchField(['dataStreamTransport'], v)}
            />
          </ConfigControlStep>

          <ConfigControlStep
            step={4}
            totalSteps={6}
            title="Which mirror mode should new sessions use?"
            helper="Admin-only. Saved to Sessions config and sent on Launch. Session clients cannot choose this. DOM projection is accepted and stored; runtime still follows video streaming until that plugin lands."
          >
            <ConfigEnumSelect
              id="mirrorMode"
              label="Mirror mode"
              value={
                text(value.mirrorMode) === 'domProjection' ? 'domProjection' : 'videoStreaming'
              }
              options={MIRROR_MODE_OPTIONS}
              onChange={(v) => patchField(['mirrorMode'], v)}
            />
          </ConfigControlStep>

          <ConfigControlStep
            step={5}
            totalSteps={6}
            title="What default screen size should new sessions open at?"
            helper="This is the starting viewport operators land on. Clients can still resize within the limits in the reveal below."
          >
            <ConfigChipRow label="Default viewport size">
              {VIEWPORT_SIZE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant={sizePreset === preset.id && !showCustomViewport ? 'default' : 'outline'}
                  onClick={() => {
                    setShowCustomViewport(false)
                    touchFields({
                      ...value,
                      viewportPolicy: {
                        ...viewport,
                        default: { ...defaults, width: preset.width, height: preset.height },
                      },
                    })
                  }}
                >
                  {preset.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={showCustomViewport || sizePreset === 'custom' ? 'default' : 'outline'}
                onClick={() => setShowCustomViewport(true)}
              >
                Custom…
              </Button>
            </ConfigChipRow>
            {showCustomViewport || sizePreset === 'custom' ? (
              <FieldGrid>
                <ConfigField
                  id="viewport-default-width"
                  label="Width"
                  type="number"
                  min={1}
                  value={text(defaults.width ?? 1280)}
                  onChange={(v) => patchField(['viewportPolicy', 'default', 'width'], v)}
                />
                <ConfigField
                  id="viewport-default-height"
                  label="Height"
                  type="number"
                  min={1}
                  value={text(defaults.height ?? 720)}
                  onChange={(v) => patchField(['viewportPolicy', 'default', 'height'], v)}
                />
              </FieldGrid>
            ) : null}
            <InlineValidation message={viewportError} />
          </ConfigControlStep>

          <ConfigControlStep
            step={6}
            totalSteps={6}
            title="How sharp should the live video look?"
            helper="This only changes JPEG pixel density — not click targeting. Input always maps to the CSS viewport. Sharp costs more CPU and bandwidth on HiDPI clients; Lean stays light."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {SCREEENCAST_SHARPNESS_PRESETS.map((preset) => {
                const selected = sharpnessId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => patchField(['screencastPolicy', 'maxEncodeScale'], preset.scale)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-background/40 hover:bg-muted/40',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{preset.label}</p>
                      {selected ? (
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" aria-hidden />
                        </span>
                      ) : (
                        <span
                          className="mt-0.5 inline-flex h-5 w-5 shrink-0 rounded-full border border-border"
                          aria-hidden
                        />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{preset.blurb}</p>
                  </button>
                )
              })}
            </div>
            <HelperCallout tone="info" title="Safe defaults">
              Prefer <span className="font-medium text-foreground">Sharp</span> for operator laptops.
              Switch to <span className="font-medium text-foreground">Lean</span> if the host is
              CPU-bound or many sessions run at once. Encode never exceeds the viewport maximum
              (Xvfb / display ceiling).
            </HelperCallout>
            <InlineValidation message={screencastError} />
          </ConfigControlStep>
        </div>
      </DataCard>

      <RevealPanel title="Who can type, and who gets frames?" defaultOpen={exclusiveFrames}>
        <p className="mb-3 text-sm text-muted-foreground">
          When several people attach to one live session, these controls decide who may type and who receives video.
          Prefer <span className="font-medium text-foreground">Broadcast</span> video for multi-viewer sessions —
          Exclusive delivery can leave the live canvas blank.
        </p>
        {exclusiveFrames ? (
          <HelperCallout tone="warning" title="Exclusive video can starve the live view">
            With Exclusive delivery, only one client receives frames. The live canvas often stays black. Switch to
            Broadcast unless you intentionally pin a single video owner.
          </HelperCallout>
        ) : null}
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Input (who may drive)</p>
            <FieldGrid>
              <ConfigEnumSelect
                id="input-access"
                label="Input access"
                value={text(input.access || 'shared')}
                options={INPUT_ACCESS_OPTIONS}
                onChange={(v) => patchField(['inputMultiplexingPolicy', 'access'], v)}
              />
              <ConfigEnumSelect
                id="input-ownership"
                label="Input ownership"
                value={text(input.ownership || 'firstAttached')}
                options={INPUT_OWNERSHIP_OPTIONS}
                onChange={(v) => patchField(['inputMultiplexingPolicy', 'ownership'], v)}
              />
              <ConfigEnumSelect
                id="input-scheduling"
                label="Input scheduling"
                value={text(input.scheduling || 'arrivalOrder')}
                options={INPUT_SCHEDULING_OPTIONS}
                onChange={(v) => patchField(['inputMultiplexingPolicy', 'scheduling'], v)}
              />
            </FieldGrid>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Output (who receives frames)</p>
            <FieldGrid>
              <ConfigEnumSelect
                id="output-delivery"
                label="Frame delivery"
                value={text(output.delivery || 'broadcast')}
                options={OUTPUT_DELIVERY_OPTIONS}
                onChange={(v) => patchField(['outputMultiplexingPolicy', 'delivery'], v)}
              />
              <ConfigEnumSelect
                id="output-ownership"
                label="Output ownership"
                value={text(output.ownership || 'firstAttached')}
                options={OUTPUT_OWNERSHIP_OPTIONS}
                onChange={(v) => patchField(['outputMultiplexingPolicy', 'ownership'], v)}
              />
            </FieldGrid>
          </div>
        </div>
      </RevealPanel>

      <RevealPanel title="How small or large may clients resize?" defaultOpen={Boolean(viewportError)}>
        <p className="mb-3 text-sm text-muted-foreground">
          Live clients may only resize within these bounds. Speculum rejects sizes outside Minimum…Maximum.
          The display ceiling (Maximum) also caps how sharp Retina encode can get.
        </p>
        <FieldGrid>
          <ConfigField
            id="viewport-min-width"
            label="Minimum width"
            type="number"
            min={1}
            value={text(minimum.width ?? 100)}
            onChange={(v) => patchField(['viewportPolicy', 'minimum', 'width'], v)}
          />
          <ConfigField
            id="viewport-min-height"
            label="Minimum height"
            type="number"
            min={1}
            value={text(minimum.height ?? 100)}
            onChange={(v) => patchField(['viewportPolicy', 'minimum', 'height'], v)}
          />
          <ConfigField
            id="viewport-max-width"
            label="Maximum width"
            type="number"
            min={1}
            value={text(maximum.width ?? 4096)}
            onChange={(v) => patchField(['viewportPolicy', 'maximum', 'width'], v)}
          />
          <ConfigField
            id="viewport-max-height"
            label="Maximum height"
            type="number"
            min={1}
            value={text(maximum.height ?? 2160)}
            onChange={(v) => patchField(['viewportPolicy', 'maximum', 'height'], v)}
          />
        </FieldGrid>
      </RevealPanel>

      <RevealPanel title="What locale and time zone should new sessions pretend?">
        <p className="mb-3 text-sm text-muted-foreground">
          Defaults when a client does not send its own preference. Pick a chip, then tweak if needed.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {CLIENT_ENV_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyClientEnv(preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <FieldGrid>
          <ConfigField
            id="client-environment-locale"
            label="Locale"
            placeholder="en-US"
            value={text(clientEnvironment.defaultLocale ?? 'en-US')}
            onChange={(v) => patchField(['clientEnvironmentPolicy', 'defaultLocale'], v)}
            error={clientError && !text(clientEnvironment.defaultLocale).trim() ? clientError : undefined}
          />
          <ConfigField
            id="client-environment-language"
            label="Language"
            placeholder="en-US"
            value={text(clientEnvironment.defaultLanguage ?? 'en-US')}
            onChange={(v) => patchField(['clientEnvironmentPolicy', 'defaultLanguage'], v)}
          />
          <ConfigField
            id="client-environment-time-zone"
            label="Time zone ID"
            placeholder="UTC"
            helper="IANA zone id, e.g. UTC or America/Sao_Paulo."
            value={text(clientEnvironment.defaultTimeZoneId ?? 'UTC')}
            onChange={(v) => patchField(['clientEnvironmentPolicy', 'defaultTimeZoneId'], v)}
          />
          <ConfigEnumSelect
            id="client-environment-color-scheme"
            label="Color scheme"
            value={text(clientEnvironment.defaultColorScheme || 'light').toLowerCase()}
            options={COLOR_SCHEME_OPTIONS}
            onChange={(v) => patchField(['clientEnvironmentPolicy', 'defaultColorScheme'], v)}
          />
        </FieldGrid>
        <InlineValidation message={clientError} />
      </RevealPanel>

      <RevealPanel title="Should sessions look like a phone or a desktop?">
        <p className="mb-3 text-sm text-muted-foreground">
          Default input and display characteristics for sessions without a device override. Prefer Desktop unless you
          are testing mobile — wrong touch settings make clicks feel broken even when video looks fine.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {DEVICE_EMULATION_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyDevicePreset(preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="space-y-3">
          <SwitchField
            id="device-emulation-mobile"
            label="Mobile"
            helper="Prefer mobile layout and input characteristics by default."
            checked={Boolean(deviceDefault.mobile)}
            onCheckedChange={(checked) =>
              patchField(['deviceEmulationPolicy', 'default', 'mobile'], checked)
            }
          />
          <SwitchField
            id="device-emulation-touch"
            label="Touch input"
            helper="Advertise touch capability to the page."
            checked={Boolean(deviceDefault.touch)}
            onCheckedChange={(checked) =>
              patchField(['deviceEmulationPolicy', 'default', 'touch'], checked)
            }
          />
          <FieldGrid>
            <ConfigField
              id="device-emulation-scale"
              label="Device scale factor"
              type="number"
              min={0}
              step={0.1}
              value={text(deviceDefault.deviceScaleFactor ?? 1)}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'default', 'deviceScaleFactor'], v)}
            />
            <ConfigField
              id="device-emulation-touch-points"
              label="Default max touch points"
              type="number"
              min={0}
              value={text(deviceDefault.maxTouchPoints ?? 0)}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'default', 'maxTouchPoints'], v)}
            />
            <ConfigField
              id="device-emulation-ua"
              label="Default user-agent profile"
              placeholder="desktop"
              value={text(deviceDefault.userAgentProfile ?? 'desktop')}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'default', 'userAgentProfile'], v)}
            />
            <ConfigField
              id="device-emulation-orientation"
              label="Screen orientation"
              placeholder="landscapePrimary"
              value={text(deviceDefault.screenOrientation ?? 'landscapePrimary')}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'default', 'screenOrientation'], v)}
            />
          </FieldGrid>
          <p className="text-xs font-medium text-muted-foreground">Bounds and profile names</p>
          <FieldGrid>
            <ConfigField
              id="device-min-scale"
              label="Min device scale"
              type="number"
              min={0}
              step={0.1}
              value={text(devicePolicy.minDeviceScaleFactor ?? 1)}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'minDeviceScaleFactor'], v)}
            />
            <ConfigField
              id="device-max-scale"
              label="Max device scale"
              type="number"
              min={0}
              step={0.1}
              value={text(devicePolicy.maxDeviceScaleFactor ?? 2)}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'maxDeviceScaleFactor'], v)}
            />
            <ConfigField
              id="device-policy-max-touch"
              label="Policy max touch points"
              type="number"
              min={0}
              value={text(devicePolicy.maxTouchPoints ?? 10)}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'maxTouchPoints'], v)}
            />
            <ConfigField
              id="device-touch-when-touch"
              label="Touch points when touch on"
              type="number"
              min={0}
              value={text(devicePolicy.defaultTouchPointsWhenTouch ?? 5)}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'defaultTouchPointsWhenTouch'], v)}
            />
            <ConfigField
              id="device-desktop-ua"
              label="Desktop UA profile name"
              placeholder="desktop"
              value={text(devicePolicy.desktopUserAgentProfile ?? 'desktop')}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'desktopUserAgentProfile'], v)}
            />
            <ConfigField
              id="device-mobile-ua"
              label="Mobile UA profile name"
              placeholder="mobile"
              value={text(devicePolicy.mobileUserAgentProfile ?? 'mobile')}
              onChange={(v) => patchField(['deviceEmulationPolicy', 'mobileUserAgentProfile'], v)}
            />
          </FieldGrid>
        </div>
      </RevealPanel>
    </div>
  )
}
