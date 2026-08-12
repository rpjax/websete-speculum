/**
 * data: URL parser — shared util (W9 re-home from V1 PageProjection).
 */
export function parseDataUrl(url: string): { body: Buffer; contentType: string } | null {
  if (typeof url !== 'string' || !url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma < 5) return null;
  const meta = url.slice(5, comma);
  const data = url.slice(comma + 1);
  const parts = meta.split(';').map((p) => p.trim()).filter(Boolean);
  const typePart = parts.find((p) => p.includes('/'));
  const contentType = typePart || 'application/octet-stream';
  const b64 = parts.some((p) => p.toLowerCase() === 'base64');
  try {
    const body = b64
      ? Buffer.from(data.replace(/\s/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(data), 'utf8');
    if (b64 && data.replace(/\s/g, '').length > 0 && body.length === 0) return null;
    return { body, contentType };
  } catch {
    return null;
  }
}
