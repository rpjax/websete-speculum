import type { ClientConfig } from '@/lib/clientConfig'
import { delay } from './delay'

const mockConfig: ClientConfig = {
  nsoParamName: '_w7s_nso',
  forwardingHost: 'www.example.com',
  mirroringEnabled: true,
  currentDomain: 'browse.example.com',
  profiles: [
    { domain: 'browse.example.com', mirroringEnabled: true },
    { domain: 'demo.example.com', mirroringEnabled: false },
  ],
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
