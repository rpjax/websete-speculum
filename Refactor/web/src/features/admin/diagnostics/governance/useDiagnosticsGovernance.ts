import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  diagnosticsApi,
  type DiagnosticsOptions,
  type DiagnosticsOverview,
  type DiagnosticsProfile,
} from '@/lib/diagnosticsApi'
import { api, ConfigSections } from '@/lib/api'
import { DIAGNOSTICS_PRESETS } from '@/lib/diagnosticsConstants'
import { DEFAULT_CONFIG, mergeDiagnosticsConfig } from './governanceDefaults'
import { diffDiagnosticsConfig } from './diffDiagnosticsConfig'
import { waitConfigApplied } from './waitConfigApplied'

export type GovernanceSaveResult = 'confirmed' | 'unconfirmed' | 'error'

export function useDiagnosticsGovernance() {
  const [overview, setOverview] = useState<DiagnosticsOverview | null>(null)
  const [config, setConfig] = useState<DiagnosticsOptions>(DEFAULT_CONFIG)
  const [savedConfig, setSavedConfig] = useState<DiagnosticsOptions>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [elevating, setElevating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const changes = useMemo(() => diffDiagnosticsConfig(savedConfig, config), [savedConfig, config])
  const dirty = changes.length > 0

  const refresh = useCallback(async (opts?: { keepDraft?: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const [ov, section] = await Promise.all([
        diagnosticsApi.getOverview(),
        api.getSection<DiagnosticsOptions>(ConfigSections.Diagnostics),
      ])
      setOverview(ov)
      const merged = mergeDiagnosticsConfig(section)
      setSavedConfig(merged)
      if (!opts?.keepDraft) {
        setConfig(merged)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load governance data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const applyProfile = useCallback((profile: DiagnosticsProfile) => {
    const preset = DIAGNOSTICS_PRESETS[profile]
    setConfig((prev) => ({
      ...prev,
      profile,
      domains: preset.domains,
      telemetry: preset.telemetry,
      storage: preset.storage,
      sampling: preset.sampling,
    }))
  }, [])

  const discard = useCallback(() => {
    setConfig(savedConfig)
    setMessage(null)
    setImportError(null)
  }, [savedConfig])

  const save = useCallback(async (): Promise<GovernanceSaveResult> => {
    setSaving(true)
    setMessage(null)
    setError(null)
    const sinceIso = new Date().toISOString()
    try {
      await api.putSection(ConfigSections.Diagnostics, config)
      const confirmed = await waitConfigApplied(sinceIso)
      await refresh()
      if (confirmed) {
        setMessage('Configuration saved and applied. Changes are live across all sessions.')
        return 'confirmed'
      }
      setMessage('Configuration saved, but apply confirmation timed out. Refresh to verify effective state.')
      return 'unconfirmed'
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
      return 'error'
    } finally {
      setSaving(false)
    }
  }, [config, refresh])

  const resetToServerSeed = useCallback(async (): Promise<GovernanceSaveResult> => {
    setSaving(true)
    setMessage(null)
    setError(null)
    const sinceIso = new Date().toISOString()
    try {
      await api.deleteSection(ConfigSections.Diagnostics)
      const confirmed = await waitConfigApplied(sinceIso)
      await refresh()
      if (confirmed) {
        setMessage('Reset to server seed profile. Configuration re-applied.')
        return 'confirmed'
      }
      setMessage('Reset completed, but apply confirmation timed out. Refresh to verify.')
      return 'unconfirmed'
    } catch (e: unknown) {
      // Fallback: PUT Production defaults if DELETE is unavailable.
      try {
        await api.putSection(ConfigSections.Diagnostics, DEFAULT_CONFIG)
        const confirmed = await waitConfigApplied(sinceIso)
        await refresh()
        setMessage(
          confirmed
            ? 'Reset to Production defaults (server reseed unavailable).'
            : 'Reset applied without ConfigApplied confirmation.',
        )
        return confirmed ? 'confirmed' : 'unconfirmed'
      } catch (inner: unknown) {
        setError(inner instanceof Error ? inner.message : e instanceof Error ? e.message : 'Reset failed')
        return 'error'
      }
    } finally {
      setSaving(false)
    }
  }, [refresh])

  const recover = useCallback(async () => {
    setRecovering(true)
    setError(null)
    try {
      await diagnosticsApi.recover()
      setMessage('Degraded circuit cleared. Capabilities restored to configured levels.')
      await refresh({ keepDraft: dirty })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Recovery failed')
    } finally {
      setRecovering(false)
    }
  }, [refresh, dirty])

  const elevate = useCallback(async (minutes: number) => {
    setElevating(true)
    setError(null)
    try {
      await diagnosticsApi.elevate({ minutes })
      setMessage(`Browser Query elevated for ${minutes} minute${minutes === 1 ? '' : 's'}.`)
      await refresh({ keepDraft: dirty })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Elevation failed')
      throw e
    } finally {
      setElevating(false)
    }
  }, [refresh, dirty])

  const clearElevate = useCallback(async () => {
    setError(null)
    try {
      await diagnosticsApi.clearElevate()
      setMessage('Elevation cleared.')
      await refresh({ keepDraft: dirty })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clear elevate failed')
    }
  }, [refresh, dirty])

  const importConfig = useCallback((raw: string) => {
    setImportError(null)
    try {
      const imported = JSON.parse(raw) as DiagnosticsOptions
      if (!imported.domains || !imported.storage) throw new Error('Invalid config structure')
      setConfig(mergeDiagnosticsConfig(imported))
      setMessage('Configuration imported — review changes and click Save to apply.')
    } catch {
      setImportError('Invalid configuration file. Must be a valid JSON diagnostics config.')
    }
  }, [])

  const clearFeedback = useCallback(() => {
    setError(null)
    setMessage(null)
    setImportError(null)
  }, [])

  return {
    overview,
    config,
    setConfig,
    savedConfig,
    changes,
    dirty,
    loading,
    saving,
    recovering,
    elevating,
    error,
    message,
    importError,
    refresh,
    applyProfile,
    discard,
    save,
    resetToServerSeed,
    recover,
    elevate,
    clearElevate,
    importConfig,
    clearFeedback,
  }
}

export type DiagnosticsGovernanceApi = ReturnType<typeof useDiagnosticsGovernance>
