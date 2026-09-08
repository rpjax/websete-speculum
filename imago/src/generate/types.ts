export type Disposition = 'stub' | 'drop' | 'keep' | 'fixture'

export interface GenerationProfile {
  /**
   * `flat` is the default (**D-042**). `rehost` remains available and unchanged, but
   * it is no longer the path to "it works": it ships the origin's JavaScript, so it
   * inherits every way someone else's application can fail — hydration, lazy chunks,
   * a third-party SDK throwing inside an error boundary. `flat` ships no script.
   */
  emitter: 'flat' | 'rehost'
  /** Where the bundle's API calls go. null = served by the preview's API layer. */
  apiBase: string | null
  /** Per-host disposition for non-API third parties (E-6). No silent default. */
  hosts: Record<string, Disposition>
  /** Default for a host the profile does not name. */
  defaultDisposition: Disposition
}

export const DEFAULT_PROFILE: GenerationProfile = {
  emitter: 'flat',
  apiBase: null,
  hosts: {},
  defaultDisposition: 'stub',
}

export interface RunManifest {
  runId: string
  sessionId: string
  profileHash: string
  profile: GenerationProfile
  createdAt: string
  emitter: string
  /** primary host — its paths become the bundle's web root */
  primaryHost: string
  entry: string
  files: number
  bytes: number
  /** original absolute URL → path inside the bundle */
  routes: Record<string, string>
  /** URLs the page will ask for that the bundle does not have */
  missing: string[]
  rewrites: { file: string; count: number }[]
  /** Complete origins pointed at the preview instead of the real internet (E-10). */
  rewrittenOrigins?: string[]
  warnings: string[]
}
