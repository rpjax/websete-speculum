"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectTelemetry = collectTelemetry;
const perf_hooks_1 = require("perf_hooks");
let loopDelay = null;
let priorElu = perf_hooks_1.performance.eventLoopUtilization();
let priorCpu = process.cpuUsage();
let priorCpuAt = perf_hooks_1.performance.now();
async function collectTelemetry(request, registry) {
    const response = {};
    const entries = registry.list();
    let statuses = null;
    async function getStatuses() {
        if (statuses)
            return statuses;
        statuses = await Promise.all(entries.map(async ({ session, bridge }) => {
            try {
                const status = await session.getStatus();
                return {
                    id: session.sessionId,
                    open: status.isOpen,
                    pages: status.tabCount,
                    faulted: bridge.isFaulted,
                };
            }
            catch {
                return { id: session.sessionId, open: false, pages: 0, faulted: true };
            }
        }));
        return statuses;
    }
    if (request.includeProcess) {
        const memory = process.memoryUsage();
        const cpu = process.cpuUsage(priorCpu);
        const now = perf_hooks_1.performance.now();
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
            loopDelay = (0, perf_hooks_1.monitorEventLoopDelay)({ resolution: 20 });
            loopDelay.enable();
        }
        const elu = perf_hooks_1.performance.eventLoopUtilization(priorElu);
        priorElu = perf_hooks_1.performance.eventLoopUtilization();
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
        response.queues = entries.reduce((total, { bridge, session }) => {
            const sessionTelemetry = session.getTelemetrySnapshot?.();
            return {
                videoDepth: total.videoDepth + bridge.video.pendingCount,
                audioDepth: total.audioDepth + bridge.audio.pendingCount,
                consoleDepth: total.consoleDepth + bridge.consoleQ.pendingCount,
                inputDepth: total.inputDepth + (sessionTelemetry?.inputPendingCount ?? 0),
                inputChainDepth: total.inputChainDepth + (sessionTelemetry?.inputChainDepth ?? 0),
                droppedTotal: total.droppedTotal
                    + bridge.video.droppedCount
                    + bridge.audio.droppedCount
                    + bridge.dom.droppedCount
                    + bridge.consoleQ.droppedCount
                    + bridge.location.droppedCount
                    + bridge.navigationBlocked.droppedCount
                    + bridge.editableFocus.droppedCount
                    + bridge.crash.droppedCount
                    + bridge.videoStreamingInputPath.droppedCount
                    + bridge.domProjectionInputPath.droppedCount
                    + bridge.domProjectionLifecycle.droppedCount
                    + bridge.allocationLifecycle.droppedCount,
            };
        }, { videoDepth: 0, audioDepth: 0, consoleDepth: 0, inputDepth: 0, inputChainDepth: 0, droppedTotal: 0 });
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
    if (request.includeAllocationsSummary || request.includeAllocationSessions) {
        const allocationRows = await Promise.all(entries.map(async ({ session, bridge }) => {
            let open = false;
            let faulted = bridge.isFaulted;
            try {
                const status = await session.getStatus();
                open = status.isOpen;
            }
            catch {
                open = false;
                faulted = true;
            }
            const snap = session.getTelemetrySnapshot?.() ?? {};
            return {
                sessionId: session.sessionId,
                open,
                faulted,
                snap,
            };
        }));
        if (request.includeAllocationsSummary) {
            let allocatedDisplayPixels = 0;
            let displayCount = 0;
            let osInputSessions = 0;
            let patchrightInputSessions = 0;
            let touchPrimarySessions = 0;
            let userDataDirsPresent = 0;
            let allocatedSessions = 0;
            for (const row of allocationRows) {
                const snap = row.snap;
                if (snap.displayAllocated) {
                    allocatedSessions += 1;
                    displayCount += 1;
                    allocatedDisplayPixels += (snap.displayWidth ?? 0) * (snap.displayHeight ?? 0);
                }
                if (snap.inputBackend === 'os')
                    osInputSessions += 1;
                if (snap.inputBackend === 'patchright')
                    patchrightInputSessions += 1;
                if (snap.touchPrimary)
                    touchPrimarySessions += 1;
                if (snap.userDataDirPresent)
                    userDataDirsPresent += 1;
            }
            response.allocations = {
                summary: {
                    allocatedSessions,
                    openSessions: allocationRows.filter((row) => row.open).length,
                    faultedSessions: allocationRows.filter((row) => row.faulted).length,
                    displayCount,
                    allocatedDisplayPixels,
                    osInputSessions,
                    patchrightInputSessions,
                    touchPrimarySessions,
                    userDataDirsPresent,
                },
            };
        }
        if (request.includeAllocationSessions) {
            const sessions = allocationRows.map((row) => ({
                sessionId: row.sessionId,
                open: row.open,
                faulted: row.faulted,
                displayAllocated: row.snap.displayAllocated ?? false,
                displayWidth: row.snap.displayWidth ?? 0,
                displayHeight: row.snap.displayHeight ?? 0,
                logicalWidth: row.snap.logicalWidth ?? 0,
                logicalHeight: row.snap.logicalHeight ?? 0,
                chromeWidth: row.snap.chromeWidth ?? 0,
                chromeHeight: row.snap.chromeHeight ?? 0,
                inputBackend: row.snap.inputBackend ?? '',
                touchPrimary: row.snap.touchPrimary ?? false,
                userDataDirPresent: row.snap.userDataDirPresent ?? false,
            }));
            response.allocations = {
                ...response.allocations,
                sessions,
            };
        }
    }
    return response;
}
//# sourceMappingURL=collectTelemetry.js.map