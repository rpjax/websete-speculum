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

/** MIME do canal no complete — sem isto SVG no <img> fica 0×0. */
export function assetResponseHeaders(
  token: string,
  contentType: string,
): Record<string, string> {
  const headers = stampAssetHeaders({}, token);
  if (contentType) {
    headers['content-type'] = contentType;
  }
  return headers;
}

/** Destino do pedido (SW). Dúvida = 0 = recusa no pai. */
export function classifyFetchDestination(destination: string): number {
  switch (destination) {
    case 'image':
      return 1;
    case 'font':
      return 2;
    case 'audio':
      return 3;
    case 'video':
      return 4;
    case 'document':
    case 'frame':
    case 'iframe':
    case 'embed':
    case 'object':
      return 10;
    case 'script':
      return 11;
    case 'style':
      return 12;
    case 'websocket':
      return 15;
    case '':
      return 13;
    default:
      return 0;
  }
}
