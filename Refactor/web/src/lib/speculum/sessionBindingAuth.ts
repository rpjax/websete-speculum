/**
 * Live-session binding auth — re-exports from `@speculum/page-projection/projected`
 * so web and package share one implementation (virtual-assets.md §1.1).
 */

export {
  SessionAuthQueryParam,
  SessionCacheBustQueryParam,
  isVirtualAssetUrl,
  appendSessionAuth,
  appendCacheBust,
  appendSessionBindingQuery,
} from '@speculum/page-projection/projected/sessionBindingAuth'
