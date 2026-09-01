import type { ClientConfig } from '@/lib/clientConfig'
import { delay } from './delay'

const mockConfig: ClientConfig = {
  schemaVersion: 1,
  operational: true,
  missing: [],
  nsoParamName: '_w7s_nso',
  navigation: { defaultTargetHost: 'www.example.com' },
  sessions: {
    detachedSessionTimeoutSeconds: 3,
    dataStreamTransport: 'webTransport',
    mirrorMode: 'pageProjection',
    viewportPolicy: {
      minWidth: 320,
      minHeight: 240,
      maxWidth: 4096,
      maxHeight: 2160,
      defaultWidth: 1280,
      defaultHeight: 720,
    },
    screencastMaxEncodeScale: 2,
    pageProjectionSwapTimeoutMs: 1500,
    pageProjectionClientStateMs: 1000,
    pageProjectionApplyBudgetMs: 4,
  },
  resourceManagement: { maxConcurrentSessions: 8 },
  telemetry: {
    clientObservation: {
      isEnabled: false,
      sessionWire: true,
      videoStreamingInput: false,
      pageProjectionFrame: false,
      pageProjectionIntent: false,
    },
  },
  hosting: {
    required: false,
    domains: [
      { domain: 'browse.example.com', subdomainMirroringEnabled: true },
      { domain: 'demo.example.com', subdomainMirroringEnabled: false },
    ],
    currentDomain: 'browse.example.com',
  },
}

export function invalidateClientConfigCache(): void {
  /* no-op */
}

export async function fetchClientConfig(_apiUrl: string, _force = false): Promise<ClientConfig> {
  return delay(structuredClone(mockConfig))
}

export function loadClientToken(): string {
  return 'ctkn-mock-0000-1111-2222-33333333'
}

export function saveClientToken(_id: string, _config: ClientConfig): void {
  /* no-op */
}

export function clearClientToken(_config: ClientConfig): void {
  /* no-op */
}

export const CLIENT_TOKEN_COOKIE = 'speculum_client_token'
