/**
 * Launch telemetry probe — boot outcome + document.install sidecar state.
 */

import type { BrowserSession } from '../../../../BrowserSession';
import type { PageProjectionBrowserSession } from '../../session/PageProjectionBrowserSession';
import type { DocumentInstallEvent } from '../../session/extensionC2Host';
import type { LabChassis } from '../host/chassis';

export type LaunchInstallEvent = {
  generation: number;
  url: string;
  installKind: string;
  t: string;
  installedAtMs: number;
};

export type LaunchTelemetryDiagnostic = {
  capturedAt: string;
  established: boolean;
  generation: number | null;
  documentUrl: string | null;
  bootOutcome: { ok: boolean; reason: string; href?: string; detail?: Record<string, unknown> } | null;
  installTelemetry: {
    installCount: number;
    lastInstallUrl: string | null;
    lastGeneration: number | null;
    events: LaunchInstallEvent[];
    installSpacingMs: number[];
    maxSpacingMs: number | null;
  } | null;
};

export function computeInstallSpacingMs(events: DocumentInstallEvent[]): number[] {
  const spacing: number[] = [];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!.installedAtMs;
    const cur = events[i]!.installedAtMs;
    spacing.push(Math.max(0, cur - prev));
  }
  return spacing;
}

export async function runLaunchTelemetryProbe(opts: {
  chassis: LabChassis;
  session: BrowserSession;
}): Promise<LaunchTelemetryDiagnostic> {
  const session = opts.session as BrowserSession & {
    evaluate?: (expr: string, contextId?: number) => Promise<unknown>;
    dataPlaneHost?: { isEstablished: boolean; establishedGeneration: number };
    getInstallTelemetry?: () => {
      installCount: number;
      lastInstallUrl: string | null;
      lastGeneration: number | null;
      events: DocumentInstallEvent[];
    };
  };

  let bootOutcome: LaunchTelemetryDiagnostic['bootOutcome'] = null;
  if (typeof session.evaluate === 'function') {
    const raw = await session.evaluate('JSON.stringify(globalThis.__speculumBootOutcome ?? null)');
    if (typeof raw === 'object' && raw !== null && 'ok' in raw) {
      const ev = raw as { ok: boolean; value?: unknown };
      if (ev.ok && typeof ev.value === 'string') {
        try {
          bootOutcome = JSON.parse(ev.value);
        } catch {
          /* ignore */
        }
      }
    } else if (typeof raw === 'string') {
      try {
        bootOutcome = JSON.parse(raw);
      } catch {
        /* ignore */
      }
    }
  }

  const dp = session.dataPlaneHost;
  const established = dp?.isEstablished === true;
  const generation = dp?.establishedGeneration ?? null;
  let documentUrl: string | null = null;
  if (typeof session.evaluate === 'function') {
    const urlRaw = await session.evaluate('location.href');
    if (typeof urlRaw === 'string') documentUrl = urlRaw;
  }

  const rawTel =
    typeof (opts.session as unknown as { getInstallTelemetry?: () => unknown }).getInstallTelemetry ===
    'function'
      ? (
          opts.session as unknown as {
            getInstallTelemetry: () => {
              installCount: number;
              lastInstallUrl: string | null;
              lastGeneration: number | null;
              events: DocumentInstallEvent[];
            };
          }
        ).getInstallTelemetry()
      : null;

  let installTelemetry: LaunchTelemetryDiagnostic['installTelemetry'] = null;
  if (rawTel) {
    const spacing = computeInstallSpacingMs(rawTel.events);
    installTelemetry = {
      installCount: rawTel.installCount,
      lastInstallUrl: rawTel.lastInstallUrl,
      lastGeneration: rawTel.lastGeneration,
      events: rawTel.events.map((e) => ({
        generation: e.generation,
        url: e.url,
        installKind: e.installKind,
        t: e.t,
        installedAtMs: e.installedAtMs,
      })),
      installSpacingMs: spacing,
      maxSpacingMs: spacing.length > 0 ? Math.max(...spacing) : null,
    };
  }

  return {
    capturedAt: new Date().toISOString(),
    established,
    generation,
    documentUrl,
    bootOutcome,
    installTelemetry,
  };
}
