/**
 * Launch telemetry probe — boot outcome + document.install sidecar state.
 */

import type { BrowserSession } from '../../../../BrowserSession';
import type { DocumentInstallEvent } from '../../session/extensionC2Host';
import type { LabChassis } from '../host/chassis';
import { evaluateVirtualProbe } from './evaluateVirtualProbe';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';

export type LaunchInstallEvent = {
  generation: number;
  url: string;
  installKind: string;
  t: string;
  installedAtMs: number;
};

export type LaunchGateTiming = {
  configGateMs: number | null;
  configGateAttempts: number | null;
  initContextMs: number | null;
  initContextAttempts: number | null;
};

export type LaunchTelemetryDiagnostic = {
  capturedAt: string;
  established: boolean;
  generation: number | null;
  documentUrl: string | null;
  bootOutcome: { ok: boolean; reason: string; href?: string; detail?: Record<string, unknown> } | null;
  gateTiming: LaunchGateTiming;
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

function readGateTiming(
  bootOutcome: LaunchTelemetryDiagnostic['bootOutcome'],
  launchTimingRaw: unknown,
): LaunchGateTiming {
  const detail = bootOutcome?.detail;
  const fromOutcome = {
    configGateMs: typeof detail?.configGateMs === 'number' ? detail.configGateMs : null,
    configGateAttempts:
      typeof detail?.configGateAttempts === 'number' ? detail.configGateAttempts : null,
    initContextMs: typeof detail?.initContextMs === 'number' ? detail.initContextMs : null,
    initContextAttempts:
      typeof detail?.initContextAttempts === 'number' ? detail.initContextAttempts : null,
  };
  if (fromOutcome.configGateMs !== null) return fromOutcome;

  if (!launchTimingRaw || typeof launchTimingRaw !== 'object') {
    return {
      configGateMs: null,
      configGateAttempts: null,
      initContextMs: null,
      initContextAttempts: null,
    };
  }
  const bag = launchTimingRaw as Record<string, { durationMs?: number; attempts?: number }>;
  return {
    configGateMs: typeof bag.configGate?.durationMs === 'number' ? bag.configGate.durationMs : null,
    configGateAttempts:
      typeof bag.configGate?.attempts === 'number' ? bag.configGate.attempts : null,
    initContextMs: typeof bag.initContext?.durationMs === 'number' ? bag.initContext.durationMs : null,
    initContextAttempts:
      typeof bag.initContext?.attempts === 'number' ? bag.initContext.attempts : null,
  };
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
  let launchTimingRaw: unknown = null;
  const probeSession = session as BrowserSession & {
    evaluateVirtualExpression?: (code: string, contextId?: number) => Promise<unknown>;
    evaluate?: (expr: string, contextId?: number) => Promise<unknown>;
  };
  const raw = await evaluateVirtualProbe(
    probeSession,
    'JSON.stringify({ boot: globalThis.__speculumBootOutcome ?? null, timing: globalThis.__SPECULUM_LAUNCH_TIMING__ ?? null })',
    CONTEXT_ID_ROOT,
  );
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { boot?: unknown; timing?: unknown };
      if (parsed.boot && typeof parsed.boot === 'object') {
        bootOutcome = parsed.boot as LaunchTelemetryDiagnostic['bootOutcome'];
      }
      launchTimingRaw = parsed.timing ?? null;
    } catch {
      /* ignore */
    }
  }

  const dp = session.dataPlaneHost;
  const established = dp?.isEstablished === true;
  const generation = dp?.establishedGeneration ?? null;
  let documentUrl: string | null = null;
  if (typeof session.evaluate === 'function') {
    const urlRaw = await session.evaluate('location.href');
    if (typeof urlRaw === 'string') documentUrl = urlRaw;
    else if (typeof urlRaw === 'object' && urlRaw !== null && 'ok' in urlRaw) {
      const ev = urlRaw as { ok: boolean; value?: unknown };
      if (ev.ok && typeof ev.value === 'string') documentUrl = ev.value;
    }
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
    gateTiming: readGateTiming(bootOutcome, launchTimingRaw),
    installTelemetry,
  };
}
