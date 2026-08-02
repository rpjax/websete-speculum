import type { SessionClientEnvironment } from '@/lib/speculum/types'

/**
 * Operator browser environment for StartSession — policy fills any blanks.
 * Prefer navigator/Intl so remote Chrome matches the human client.
 */
export function detectClientEnvironment(): SessionClientEnvironment {
  const language = (typeof navigator !== 'undefined' && navigator.language?.trim()) || ''
  const locale = language
  let timeZoneId = ''
  try {
    timeZoneId = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || ''
  } catch {
    timeZoneId = ''
  }
  let colorScheme: SessionClientEnvironment['colorScheme'] = 'light'
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
      colorScheme = 'dark'
    }
  } catch {
    colorScheme = 'light'
  }
  return {
    locale: locale || undefined,
    language: language || undefined,
    timeZoneId: timeZoneId || undefined,
    colorScheme,
  }
}
