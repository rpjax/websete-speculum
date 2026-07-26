import type { Analyzer, Finding } from '../types'

export const telemetrySignalsAnalyzer: Analyzer = {
  id: 'telemetrySignals',
  run(bag) {
    if (bag.telemetry.length === 0) return []

    const hostCpus: number[] = []
    const hostMems: number[] = []
    const apiCpus: number[] = []
    const apiMems: number[] = []
    const apiThreads: number[] = []
    const fps: number[] = []
    const caps: number[] = []
    const lives: number[] = []

    for (const s of bag.telemetry) {
      const p = s.payload
      if (typeof p.host?.cpuUsage === 'number') hostCpus.push(p.host.cpuUsage)
      if (typeof p.host?.memoryUsed === 'number') hostMems.push(p.host.memoryUsed)
      if (typeof p.apiProcess?.cpuUsage === 'number') apiCpus.push(p.apiProcess.cpuUsage)
      if (typeof p.apiProcess?.memoryUsed === 'number') apiMems.push(p.apiProcess.memoryUsed)
      if (typeof p.apiProcess?.threadCount === 'number') apiThreads.push(p.apiProcess.threadCount)
      if (typeof p.motor?.avgFps === 'number') fps.push(p.motor.avgFps)
      if (typeof p.motor?.capacityUsedPct === 'number') caps.push(p.motor.capacityUsedPct)
      if (typeof p.motor?.live === 'number') lives.push(p.motor.live)
    }

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
    const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null)
    const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null)

    const avgHostCpu = avg(hostCpus)
    const avgHostMem = avg(hostMems)
    const avgApiCpu = avg(apiCpus)
    const avgApiMem = avg(apiMems)
    const avgThreads = avg(apiThreads)
    const avgFps = avg(fps)
    const minFps = min(fps)
    const maxCap = max(caps)
    const liveDelta = lives.length >= 2 ? lives[lives.length - 1] - lives[0] : 0

    const findings: Finding[] = [
      {
        id: 'telemetry-signals',
        severity: 'info',
        analyzer: 'telemetrySignals',
        title: 'Continuous signals (telemetry composite)',
        body:
          `${bag.telemetry.length} telemetry sample(s) in range. ` +
          (avgHostCpu != null ? `Machine CPU avg≈${avgHostCpu.toFixed(1)}%. ` : 'Machine CPU section absent. ') +
          (avgHostMem != null ? `Machine memory used avg≈${Math.round(avgHostMem / (1024 * 1024))} MiB. ` : '') +
          (avgApiCpu != null ? `API process CPU avg≈${avgApiCpu.toFixed(1)}%. ` : 'API process CPU section absent. ') +
          (avgApiMem != null ? `API working set avg≈${Math.round(avgApiMem / (1024 * 1024))} MiB. ` : '') +
          (avgThreads != null ? `API threads avg≈${avgThreads.toFixed(0)}. ` : '') +
          (avgFps != null ? `Motor avgFps≈${avgFps.toFixed(1)} (min ${minFps?.toFixed(1)}). ` : 'Motor FPS absent. ') +
          (maxCap != null ? `Peak capacityUsedPct≈${maxCap.toFixed(1)}%. ` : '') +
          `Live session count delta across samples: ${liveDelta >= 0 ? '+' : ''}${liveDelta}. ` +
          `Missing sections mean those toggles were off — absence is a completeness fact, not a zero measurement.`,
        evidenceRefs: bag.telemetry.slice(0, 3).map((s) => s.id),
        relatedFindingIds: [],
        sectionHints: ['signals'],
      },
    ]

    // FPS×CPU story uses machine CPU only — never substitute API-process CPU.
    if (minFps != null && avgHostCpu != null && minFps < 10 && avgHostCpu < 40) {
      findings.push({
        id: 'telemetry-fps-vs-cpu',
        severity: 'notable',
        analyzer: 'telemetrySignals',
        title: 'Possible render pressure with flat machine CPU',
        body:
          `Minimum avgFps dipped to ${minFps.toFixed(1)} while average machine CPU stayed moderate (${avgHostCpu.toFixed(1)}%). ` +
          `Symptom→signal guidance: when FPS falls and machine CPU is flat, inspect motor input/frame channel depths and sidecar connectivity next.`,
        evidenceRefs: [],
        relatedFindingIds: ['telemetry-signals'],
        sectionHints: ['signals', 'crossings'],
      })
    }

    if (maxCap != null && maxCap >= 90) {
      findings.push({
        id: 'telemetry-capacity',
        severity: 'attention',
        analyzer: 'telemetrySignals',
        title: 'Capacity saturation signal',
        body:
          `capacityUsedPct peaked near ${maxCap.toFixed(1)}%. Correlate with Motor.SessionRefused / Starting pile-up in the event narrative.`,
        evidenceRefs: [],
        relatedFindingIds: ['telemetry-signals'],
        sectionHints: ['signals', 'crossings', 'attention'],
      })
    }

    return findings
  },
}
