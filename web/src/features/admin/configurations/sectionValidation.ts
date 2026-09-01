import { isBareHost } from './urlMatchRules'
import {
  summarizeSessions,
  validateClientEnvironment,
  validateDetachedTimeout,
  validateScreencastScale,
  validateViewportOrdering,
  text,
  type JsonObject,
} from './sessionsHelpers'
import { nestedNumber, summarizeResourceManagement } from './resourceManagementHelpers'

/**
 * Whether the section draft is valid enough to PUT.
 * Scripting has no save path on this route.
 */
export function sectionCanSave(section: string, value: JsonObject): boolean {
  switch (section) {
    case 'Scripting':
      return false
    case 'Navigation': {
      const host = text(value.defaultTargetHost)
      return Boolean(host) && isBareHost(host)
    }
    case 'Hosting': {
      const domains = Array.isArray(value.domains) ? value.domains : []
      // Empty list is valid (Hosting unused). Every listed domain needs a bare host.
      return domains.every((item) => {
        if (!item || typeof item !== 'object') return false
        const host = text((item as JsonObject).domain).trim()
        return Boolean(host) && isBareHost(host)
      })
    }
    case 'Sessions': {
      const timeout = text(value.detachedSessionTimeout)
      if (validateDetachedTimeout(timeout)) return false
      if (validateViewportOrdering(value)) return false
      if (validateClientEnvironment(value)) return false
      if (validateScreencastScale(value)) return false
      return summarizeSessions(value).complete
    }
    case 'ResourceManagement': {
      if (!summarizeResourceManagement(value).complete) return false
      const budget = nestedNumber(value, 'storage', 'budgetBytes')
      return budget > 0
    }
    default:
      return true
  }
}
