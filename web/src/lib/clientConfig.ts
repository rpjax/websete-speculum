import { MOCK_MODE } from '@/lib/env'
import {
  invalidateClientConfigCache as mockInvalidateClientConfigCache,
  fetchClientConfig as mockFetchClientConfig,
  loadClientToken as mockLoadClientToken,
  saveClientToken as mockSaveClientToken,
  clearClientToken as mockClearClientToken,
  CLIENT_TOKEN_COOKIE as MOCK_CLIENT_TOKEN_COOKIE,
} from '@/lib/mock/clientConfig.mock'
import type { MirrorMode } from '@/lib/speculum'
import { normalizeMirrorMode } from '@/lib/speculum'
import { SESSION_VIEWPORT_BASELINE } from '@/features/sessions/live/sessionViewportPolicy'
import { w7sPath } from '@/lib/w7s'

const COOKIE_NAME = 'speculum_client_token'

/** Sessions.ViewportPolicy as projected on client-config. */
export interface SessionViewportPolicyConfig {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  defaultWidth: number
  defaultHeight: number
}

/** Client-config sessions.viewportPolicy — same numbers as SESSION_VIEWPORT_BASELINE. */
export const FALLBACK_SESSION_VIEWPORT_POLICY: SessionViewportPolicyConfig = {
  minWidth: SESSION_VIEWPORT_BASELINE.minWidth,
  minHeight: SESSION_VIEWPORT_BASELINE.minHeight,
  maxWidth: SESSION_VIEWPORT_BASELINE.maxWidth,
  maxHeight: SESSION_VIEWPORT_BASELINE.maxHeight,
  defaultWidth: SESSION_VIEWPORT_BASELINE.defaultWidth,
  defaultHeight: SESSION_VIEWPORT_BASELINE.defaultHeight,
}

export { normalizeMirrorMode }

/**
 * When client-config claims operational, Sessions pre-Start fields must be present.
 * Throws so Lab/Live fail closed instead of silently defaulting to video/WT.
 */
export function requireOperationalSessionsConfig(config: ClientConfig): void {
  if (!config.operational) return
  const sessions = config.sessions
  if (!sessions) {
    throw new Error('Pending config: sessions missing from client-config')
  }
  const mode = String(sessions.mirrorMode ?? '')
  if (mode !== 'videoStreaming' && mode !== 'pageProjection') {
    throw new Error('Pending config: sessions.mirrorMode invalid on client-config')
  }
  const transport = String(sessions.dataStreamTransport ?? '')
  if (transport !== 'webTransport' && transport !== 'webSocket') {
    throw new Error('Pending config: sessions.dataStreamTransport invalid on client-config')
  }
  const vp = sessions.viewportPolicy
  if (
    !vp
    || ![vp.minWidth, vp.minHeight, vp.maxWidth, vp.maxHeight, vp.defaultWidth, vp.defaultHeight]
      .every((n) => Number.isFinite(Number(n)) && Number(n) > 0)
  ) {
    throw new Error('Pending config: sessions.viewportPolicy incomplete on client-config')
  }
}

/**
 * Read the viewport policy from client-config, filling any missing bound from the
 * engine-aligned fallback so callers always get a complete policy.
 */
export function readSessionViewportPolicy(
  config: ClientConfig | null,
): SessionViewportPolicyConfig {
  const raw = config?.sessions?.viewportPolicy
  if (!raw) return FALLBACK_SESSION_VIEWPORT_POLICY
  const pick = (value: unknown, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
  }
  return {
    minWidth: pick(raw.minWidth, FALLBACK_SESSION_VIEWPORT_POLICY.minWidth),
    minHeight: pick(raw.minHeight, FALLBACK_SESSION_VIEWPORT_POLICY.minHeight),
    maxWidth: pick(raw.maxWidth, FALLBACK_SESSION_VIEWPORT_POLICY.maxWidth),
    maxHeight: pick(raw.maxHeight, FALLBACK_SESSION_VIEWPORT_POLICY.maxHeight),
    defaultWidth: pick(raw.defaultWidth, FALLBACK_SESSION_VIEWPORT_POLICY.defaultWidth),
    defaultHeight: pick(raw.defaultHeight, FALLBACK_SESSION_VIEWPORT_POLICY.defaultHeight),
  }
}

/** Sessions.PageProjection knobs the SPA must honor (swap / client-state / apply budget). */
export type PageProjectionClientKnobs = {
  swapTimeoutMs: number
  clientStateMs: number
  applyBudgetMs: number
}

export const FALLBACK_PAGE_PROJECTION_CLIENT_KNOBS: PageProjectionClientKnobs = {
  swapTimeoutMs: 1500,
  clientStateMs: 1000,
  applyBudgetMs: 4,
}

export function readPageProjectionClientKnobs(
  config: ClientConfig | null | undefined,
): PageProjectionClientKnobs {
  const s = config?.sessions
  const pick = (value: unknown, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
  }
  return {
    swapTimeoutMs: pick(s?.pageProjectionSwapTimeoutMs, FALLBACK_PAGE_PROJECTION_CLIENT_KNOBS.swapTimeoutMs),
    clientStateMs: pick(s?.pageProjectionClientStateMs, FALLBACK_PAGE_PROJECTION_CLIENT_KNOBS.clientStateMs),
    applyBudgetMs: pick(s?.pageProjectionApplyBudgetMs, FALLBACK_PAGE_PROJECTION_CLIENT_KNOBS.applyBudgetMs),
  }
}

/** V1 public client-config — Refactor contract (no legacy forwardingHost alias). */
export interface ClientConfig {
  schemaVersion: 1
  operational: boolean
  missing: string[]
  /** W7S wire query param for navigation-state projection. */
  nsoParamName: string
  navigation: {
    defaultTargetHost: string
  }
  /**
   * Everything the client must know **before** StartSession. The mirror surface and
   * the exact start geometry are decided from here, never from the StartSession
   * response — a post-start resize on a stable screen is a bug.
   */
  sessions: {
    detachedSessionTimeoutSeconds: number
    /** Data-plane carrier — Apply Sessions + refresh to pick up. */
    dataStreamTransport: 'webTransport' | 'webSocket'
    /** Sessions.MirrorMode — selects the surface that must be mounted before Start. */
    mirrorMode: MirrorMode
    /** Sessions.ViewportPolicy — client-side geometry validation before Start. */
    viewportPolicy: SessionViewportPolicyConfig
    /** Sessions.ScreencastPolicy.MaxEncodeScale — CSS→JPEG scale cap (1..2). */
    screencastMaxEncodeScale: number
    /** Sessions.PageProjection.SwapTimeoutMs — SurfaceHost swap fallback. */
    pageProjectionSwapTimeoutMs?: number
    /** Sessions.PageProjection.ClientStateMs — ClientState report interval. */
    pageProjectionClientStateMs?: number
    /** Sessions.PageProjection.ApplyBudgetMs — E9 apply overrun threshold. */
    pageProjectionApplyBudgetMs?: number
  }
  resourceManagement: {
    maxConcurrentSessions: number
  }
  /** Telemetry.ClientObservation — front ring enablement (Lab + Live). */
  telemetry?: {
    clientObservation?: {
      isEnabled?: boolean
      sessionWire?: boolean
      videoStreamingInput?: boolean
      pageProjectionFrame?: boolean
      pageProjectionIntent?: boolean
    }
  }
  hosting: {
    required: false
    domains: Array<{ domain: string; subdomainMirroringEnabled: boolean }>
    currentDomain?: string
  }
}

let cachedConfig: ClientConfig | null = null

function realInvalidateClientConfigCache(): void {
  cachedConfig = null
}

async function realFetchClientConfig(apiUrl: string, force = false): Promise<ClientConfig> {
  if (cachedConfig && !force) return cachedConfig
  const base = apiUrl.replace(/\/$/, '')
  const res = await fetch(`${base}${w7sPath('/api/public/client-config')}`)
  if (!res.ok) throw new Error('Failed to load client config')
  cachedConfig = await res.json() as ClientConfig
  return cachedConfig
}

function cookieDomain(_config: ClientConfig): string | undefined {
  const host = window.location.hostname
  if (host === 'localhost' || host.endsWith('.localhost')) return host
  // Subdomain mirroring cookie scope is 1.1 — stay host-default until then.
  return undefined
}

function realLoadClientToken(): string | null {
  const name = COOKIE_NAME + '='
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith(name)) return trimmed.substring(name.length)
  }
  return null
}

function realSaveClientToken(id: string, config: ClientConfig): void {
  const domain = cookieDomain(config)
  const secure = window.location.protocol === 'https:'
  let cookie = `${COOKIE_NAME}=${id}; Path=/; SameSite=Lax; Max-Age=31536000`
  if (domain) cookie += `; Domain=${domain}`
  if (secure) cookie += '; Secure'
  document.cookie = cookie
}

function realClearClientToken(config: ClientConfig): void {
  const domain = cookieDomain(config)
  let cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0`
  if (domain) cookie += `; Domain=${domain}`
  document.cookie = cookie
}

export const invalidateClientConfigCache = MOCK_MODE
  ? mockInvalidateClientConfigCache
  : realInvalidateClientConfigCache
export const fetchClientConfig = MOCK_MODE ? mockFetchClientConfig : realFetchClientConfig
export const loadClientToken = MOCK_MODE ? mockLoadClientToken : realLoadClientToken
export const saveClientToken = MOCK_MODE ? mockSaveClientToken : realSaveClientToken
export const clearClientToken = MOCK_MODE ? mockClearClientToken : realClearClientToken

/** @internal Exported for tests — cookie name used by client token helpers. */
export const CLIENT_TOKEN_COOKIE = MOCK_MODE ? MOCK_CLIENT_TOKEN_COOKIE : COOKIE_NAME

/** Shared pending-config detector for Lab/Live/Motor → /setup. */
export function isPendingConfigError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /Pending config|não configurado|not configured|Motor não configurado/i.test(msg)
}
