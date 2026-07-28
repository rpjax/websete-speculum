import { monitorEventLoopDelay, performance } from 'perf_hooks';
import type { SessionRegistry } from '../host/SessionRegistry';

export interface CollectTelemetryRequest {
  includeProcess?: boolean;
  includeEventLoop?: boolean;
  includeChrome?: boolean;
  includeQueues?: boolean;
  includeSessionsSummary?: boolean;
  includeFaultedIds?: boolean;
}

let loopDelay: ReturnType<typeof monitorEventLoopDelay> | null = null;
let priorElu = performance.eventLoopUtilization();
let priorCpu = process.cpuUsage();
let priorCpuAt = performance.now();

export async function collectTelemetry(
  request: CollectTelemetryRequest,
  registry: SessionRegistry,
): Promise<Record<string, unknown>> {
  const response: Record<string, unknown> = {};
  const entries = registry.list();
  let statuses: Array<{ id: string; open: boolean; pages: number; faulted: boolean }> | null = null;

  async function getStatuses() {
    if (statuses) return statuses;
    statuses = await Promise.all(entries.map(async ({ session, bridge }) => {
      try {
        const status = await session.getStatus();
        return {
          id: session.sessionId,
          open: status.isOpen,
          pages: status.tabCount,
          faulted: bridge.isFaulted,
        };
      } catch {
        return { id: session.sessionId, open: false, pages: 0, faulted: true };
      }
    }));
    return statuses;
  }

  if (request.includeProcess) {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(priorCpu);
    const now = performance.now();
    const wallMs = Math.max(1, now - priorCpuAt);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const cpuUsage = Math.max(0, (cpuMs / wallMs) * 100);
    priorCpu = process.cpuUsage();
    priorCpuAt = now;
    const uptime = process.uptime();
    response.process = {
      cpuUsage,
      memoryRss: memory.rss,
      memoryHeapUsed: memory.heapUsed,
      memoryHeapTotal: memory.heapTotal,
      pid: process.pid,
      uptimeSec: uptime,
    };
  }

  if (request.includeEventLoop) {
    if (!loopDelay) {
      loopDelay = monitorEventLoopDelay({ resolution: 20 });
      loopDelay.enable();
    }
    const elu = performance.eventLoopUtilization(priorElu);
    priorElu = performance.eventLoopUtilization();
    response.eventLoop = {
      delayMsP50: loopDelay.percentile(50) / 1e6,
      delayMsP99: loopDelay.percentile(99) / 1e6,
      utilization: elu.utilization,
    };
    loopDelay.reset();
  }

  if (request.includeChrome) {
    const current = await getStatuses();
    response.chrome = {
      browserCount: current.filter((status) => status.open).length,
      pageCount: current.reduce((total, status) => total + status.pages, 0),
    };
  }

  if (request.includeQueues) {
    response.queues = entries.reduce(
      (total, { bridge, session }) => {
        const sessionTelemetry = session.getTelemetrySnapshot?.();
        return {
        videoDepth: total.videoDepth + bridge.video.pendingCount,
        audioDepth: total.audioDepth + bridge.audio.pendingCount,
        consoleDepth: total.consoleDepth + bridge.consoleQ.pendingCount,
        inputDepth: total.inputDepth + (sessionTelemetry?.inputPendingCount ?? 0),
        droppedTotal:
          total.droppedTotal
          + bridge.video.droppedCount
          + bridge.audio.droppedCount
          + bridge.consoleQ.droppedCount
          + bridge.location.droppedCount
          + bridge.navigationBlocked.droppedCount
          + bridge.editableFocus.droppedCount
          + bridge.crash.droppedCount,
      };
      },
      { videoDepth: 0, audioDepth: 0, consoleDepth: 0, inputDepth: 0, droppedTotal: 0 },
    );
  }

  if (request.includeSessionsSummary) {
    const current = await getStatuses();
    const faulted = current.filter((status) => status.faulted);
    response.sessions = {
      registered: current.length,
      open: current.filter((status) => status.open).length,
      faulted: faulted.length,
      faultedSessionIds: request.includeFaultedIds ? faulted.map((status) => status.id) : [],
    };
  }

  return response;
}
