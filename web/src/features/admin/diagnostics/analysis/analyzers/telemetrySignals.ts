import type { Analyzer, Finding } from '../types'

export const telemetrySignalsAnalyzer: Analyzer = {
  id: 'telemetrySignals',
  run(bag) {
    if (bag.telemetry.length === 0) return []

    const cpus: number[] = []
    const mems: number[] = []
    const fps: number[] = []
    const caps: number[] = []
    const lives: number[] = []

    for (const s of bag.telemetry) {
      const p = s.payload
      if (typeof p.host?.cpuUsage === 'number') cpus.push(p.host.cpuUsage)
      if (typeof p.host?.memoryUsed === 'number') mems.push(p.host.memoryUsed)
      if (typeof p.motor?.avgFps === 'number') fps.push(p.motor.avgFps)
      if (typeof p.motor?.capacityUsedPct === 'number') caps.push(p.motor.capacityUsedPct)
      if (typeof p.motor?.live === 'number') lives.push(p.motor.live)
    }

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
    const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null)
    const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null)

    const avgCpu = avg(cpus)
    const avgMem = avg(mems)
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
          (avgCpu != null ? `Host CPU avg≈${avgCpu.toFixed(1)}%. ` : 'Host CPU section absent. ') +
          (avgMem != null ? `Memory used avg≈${Math.round(avgMem / (1024 * 1024))} MiB. ` : '') +
          (avgFps != null ? `Motor avgFps≈${avgFps.toFixed(1)} (min ${minFps?.toFixed(1)}). ` : 'Motor FPS absent. ') +
          (maxCap != null ? `Peak capacityUsedPct≈${maxCap.toFixed(1)}%. ` : '') +
          `Live session count delta across samples: ${liveDelta >= 0 ? '+' : ''}${liveDelta}. ` +
          `Missing sections mean those toggles were off — absence is a completeness fact, not a zero measurement.`,
        evidenceRefs: bag.telemetry.slice(0, 3).map((s) => s.id),
        relatedFindingIds: [],
        sectionHints: ['signals'],
      },
    ]

    if (minFps != null && avgCpu != null && minFps < 10 && avgCpu < 40) {
      findings.push({
        id: 'telemetry-fps-vs-cpu',
        severity: 'notable',
        analyzer: 'telemetrySignals',
        title: 'Possible render pressure with flat CPU',
        body:
          `Minimum avgFps dipped to ${minFps.toFixed(1)} while average host CPU stayed moderate (${avgCpu.toFixed(1)}%). ` +
          `Symptom→signal guidance: when FPS falls and CPU is flat, inspect motor input/frame channel depths and sidecar connectivity next.`,
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
