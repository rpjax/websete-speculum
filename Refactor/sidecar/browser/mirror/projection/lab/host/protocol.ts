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
      cpuProfiling?: boolean;
      headed?: boolean;
      width?: number;
      height?: number;
      device?: Record<string, unknown>;
    }
  | { type: 'browse.stop'; exportDossier?: boolean; inputCapture?: unknown }
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
      contextId?: number;
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
      formProps?: Array<{
        key: string;
        value?: string;
        checked?: boolean;
        selected?: boolean;
      }> | null;
    }
  | { type: 'client.requestResync'; reason?: string; contextId?: number }
  | { type: 'client.intent'; intent: Record<string, unknown> }
  | { type: 'client.tamperResult'; ok: boolean; reason?: string | null }
  | {
      type: 'client.resize';
      width: number;
      height: number;
      device?: Record<string, unknown>;
    }
  | {
      type: 'client.injectResult';
      sequence?: number | null;
      generation?: number | null;
      desynced?: boolean;
      applyError?: string | null;
      tableHash?: string | null;
    }
  | { type: 'client.snapshot'; label?: string }
  | { type: 'client.validateSnaps' };

export type LabHostMessage =
  | { type: 'session.hello'; sessionId: string; sessionToken: string; protocolVersion: typeof LAB_PROTOCOL_VERSION }
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
  | {
      type: 'session.fault';
      sessionId: string;
      message: string;
      errorCode?: string;
      phase?: string;
      dossierDir?: string;
    }
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
  | { type: 'debug.probe'; payload: Record<string, unknown> }
  | { type: 'telemetry'; message: unknown }
  | { type: 'error'; message: string; code?: string }
  | {
      type: 'session.resized';
      applied: boolean;
      width: number;
      height: number;
      errorCode?: string;
      message?: string;
    }
  | { type: 'requestSnapshot'; contextId: number }
  | { type: 'lab.tamper'; kind: 'ghostRule' }
  | { type: 'lab.injectFrame'; bytes: string }
  | { type: 'console'; level: number; text: string; t: number }
  | {
      type: 'snap.stored';
      id: string;
      sequence: number | null;
      generation: number | null;
      allPass: boolean;
      label?: string;
      snapCount: number;
    }
  | {
      type: 'validate.result';
      allPass: boolean;
      snapCount: number;
      pass: number;
      fail: number;
      skipped: number;
      dossierPath?: string;
    };

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
    case 'client.intent':
    case 'client.tamperResult':
    case 'client.injectResult':
    case 'client.resize':
    case 'client.snapshot':
    case 'client.validateSnaps':
      return msg as LabClientMessage;
    default:
      return { error: `unknown control type: ${type}`, code: 'unknown_type' };
  }
}
