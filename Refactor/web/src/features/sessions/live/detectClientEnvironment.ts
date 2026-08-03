import type { SessionClientEnvironment } from '@/lib/speculum/types'

/**
 * Operator browser environment for StartSession — policy fills any blanks.
 * Soft mimic only (locale/TZ/languages). Never send UA or hardware cores.
 */
export function detectClientEnvironment(): SessionClientEnvironment {
  const language = (typeof navigator !== 'undefined' && navigator.language?.trim()) || ''
  const locale = language
  let languages: string[] | undefined
  try {
    if (typeof navigator !== 'undefined' && Array.isArray(navigator.languages)) {
      languages = navigator.languages
        .map((l) => (typeof l === 'string' ? l.trim() : ''))
        .filter((l) => l.length > 0)
        .slice(0, 8)
      if (languages.length === 0) {
        languages = undefined
      }
    }
  } catch {
    languages = undefined
  }
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
    languages,
    timeZoneId: timeZoneId || undefined,
    colorScheme,
  }
}
