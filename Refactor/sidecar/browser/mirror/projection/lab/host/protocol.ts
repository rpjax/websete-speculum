/**
 * Lab control WebSocket protocol v1 (lab-design.md §8.6).
 */

export const LAB_PROTOCOL_VERSION = 1 as const;

export type LabClientMessage =
  | { type: 'hello'; protocolVersion?: number }
  | {
      type: 'browse.start';
      url: string;
      frameRateHz?: number;
      telemetry?: Record<string, unknown>;
      headed?: boolean;
    }
  | { type: 'browse.stop'; exportDossier?: boolean }
  | { type: 'browse.navigate'; url: string }
  | {
      type: 'run.start';
      blueprintId: string;
      overrides?: Record<string, unknown>;
    }
  | { type: 'run.abort'; reason?: string }
  | { type: 'surface.clear' }
  | { type: 'client.telemetry'; message: unknown }
  | {
      type: 'client.snapshotResult';
      tree?: unknown;
      table?: unknown;
      sequence?: number | null;
      generation?: number | null;
      desynced?: boolean;
      applyError?: string | null;
      armed?: boolean;
      resyncInFlight?: boolean;
      cascade?: {
        authorColor: string;
        adoptedColor: string;
        adoptedCount: number;
        styleSheetCount: number;
        styleElCount: number;
        doublePaint: boolean;
      } | null;
    }
  | { type: 'client.requestResync'; reason?: string }
  | { type: 'client.tamperResult'; ok: boolean; reason?: string | null }
  | {
      type: 'client.injectResult';
      sequence?: number | null;
      generation?: number | null;
      desynced?: boolean;
      applyError?: string | null;
      tableHash?: string | null;
    };

export type LabHostMessage =
  | { type: 'session.hello'; sessionId: string; protocolVersion: typeof LAB_PROTOCOL_VERSION }
  | {
      type: 'session.booted';
      sessionId: string;
      mode: 'browse' | 'run';
      url: string;
      dossierDir: string;
    }
  | {
      type: 'session.stopped';
      sessionId: string;
      reason: string;
      dossierDir?: string;
    }
  | { type: 'session.fault'; sessionId: string; message: string }
  | {
      type: 'run.progress';
      sessionId: string;
      actionId: string;
      queue: string;
      status: 'started' | 'succeeded' | 'failed' | 'skipped';
      detail?: string;
    }
  | {
      type: 'run.complete';
      sessionId: string;
      dossierDir: string;
      verdictsSummary: { pass: number; fail: number; skipped: number };
    }
  | { type: 'stats'; payload: Record<string, unknown> }
  | { type: 'telemetry'; message: unknown }
  | { type: 'error'; message: string; code?: string }
  | { type: 'requestSnapshot' }
  | { type: 'lab.tamper'; kind: 'ghostRule' }
  | { type: 'lab.injectFrame'; bytes: string };

export function parseClientMessage(raw: unknown): LabClientMessage | { error: string; code: string } {
  if (!raw || typeof raw !== 'object') return { error: 'invalid JSON control message', code: 'invalid_json' };
  const msg = raw as Record<string, unknown>;
  const type = msg.type;
  if (typeof type !== 'string') return { error: 'missing type', code: 'unknown_type' };
  switch (type) {
    case 'hello':
    case 'browse.start':
    case 'browse.stop':
    case 'browse.navigate':
    case 'run.start':
    case 'run.abort':
    case 'surface.clear':
    case 'client.telemetry':
    case 'client.snapshotResult':
    case 'client.requestResync':
    case 'client.tamperResult':
    case 'client.injectResult':
      return msg as LabClientMessage;
    default:
      return { error: `unknown control type: ${type}`, code: 'unknown_type' };
  }
}
