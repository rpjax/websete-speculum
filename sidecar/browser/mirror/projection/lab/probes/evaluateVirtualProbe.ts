/** Resolve Virtual-side probe expression in root or nested context. */
export async function evaluateVirtualProbe(
  session: { evaluate?: (code: string) => Promise<{ ok: boolean; value?: unknown }>; evaluateVirtualExpression?: (code: string, contextId?: number) => Promise<unknown> },
  code: string,
  contextId: number,
): Promise<unknown> {
  if (typeof session.evaluateVirtualExpression === 'function') {
    return session.evaluateVirtualExpression(code, contextId);
  }
  if (contextId === 1 && typeof session.evaluate === 'function') {
    const r = await session.evaluate(code);
    return r.ok ? r.value : null;
  }
  return null;
}
