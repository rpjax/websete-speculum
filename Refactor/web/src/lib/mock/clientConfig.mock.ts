import type { ClientConfig } from '@/lib/clientConfig'
import { delay } from './delay'

const mockConfig: ClientConfig = {
  schemaVersion: 1,
  operational: true,
  missing: [],
  nsoParamName: '_w7s_nso',
  navigation: { defaultTargetHost: 'www.example.com' },
  sessions: { detachedSessionTimeoutSeconds: 300 },
  resourceManagement: { maxConcurrentSessions: 8 },
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
