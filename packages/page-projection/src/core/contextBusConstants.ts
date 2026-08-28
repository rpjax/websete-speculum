/** LOCKED CB-13 — never mint as document contextId. */
export const CONTEXT_BUS_RUNTIME = 0xffff_ffff as const;
/** Max mintable / document contextId (inclusive). */
export const CONTEXT_ID_MAX_DOCUMENT = 0xffff_fffe as const;
/**
 * Nested bootstrap only — bus source/dest before getScopeId returns a real id.
 * Not mintable; never a document contextId after handshake.
 */
export const CONTEXT_ID_PROVISIONAL = 0 as const;

export const CONTEXT_BUS_CHANNEL = 'speculum.context.bus' as const;
