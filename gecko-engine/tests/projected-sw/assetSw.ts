/** Service worker do Projected: ready + token no header. Sem Gecko. */
export const ASSET_TOKEN_HEADER = 'x-speculum-session-token';

export function swReadyMessage(): { type: 'ready' } {
  return { type: 'ready' };
}

export function stampAssetHeaders(
  headers: Record<string, string>,
  token: string,
): Record<string, string> {
  if (!token) {
    return { ...headers };
  }
  return { ...headers, [ASSET_TOKEN_HEADER]: token };
}
