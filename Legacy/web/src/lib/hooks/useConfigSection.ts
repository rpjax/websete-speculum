import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ConfigSectionName } from '@/lib/api'

interface UseConfigSectionOptions<T> {
  section: ConfigSectionName | string
  mapIn: (raw: unknown) => T
  mapOut: (value: T) => unknown
  initial: T
}

export function useConfigSection<T>({ section, mapIn, mapOut, initial }: UseConfigSectionOptions<T>) {
  const [value, setValue] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const mapInRef = useRef(mapIn)
  const mapOutRef = useRef(mapOut)
  mapInRef.current = mapIn
  mapOutRef.current = mapOut
  const valueRef = useRef(value)
  valueRef.current = value

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const raw = await api.getSection(section)
      setValue(mapInRef.current(raw))
    } catch {
      // Missing section is common — keep initial
    } finally {
      setLoading(false)
    }
  }, [section])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(async () => {
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      await api.putSection(section, mapOutRef.current(valueRef.current))
      setMessage('Saved')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setPending(false)
    }
  }, [section])

  const remove = useCallback(async (resetTo: T, successMessage = 'Deleted') => {
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      await api.deleteSection(section)
      setValue(resetTo)
      setMessage(successMessage)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setPending(false)
    }
  }, [section])

  return {
    value,
    setValue,
    loading,
    pending,
    message,
    error,
    loadError,
    save,
    remove,
    reload,
    setMessage,
    setError,
  }
}
