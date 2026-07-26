import type { Finding, FindingSeverity } from '../types'

/** Structured didactic prose for report callouts. */
export interface FindingProse {
  lead: string
  whatThisMeans: string
  whatToDoNext?: string
}

const SEVERITY_LEAD: Record<FindingSeverity, string> = {
  info: 'Routine observation',
  notable: 'Worth noting',
  attention: 'Needs attention',
  critical: 'Critical',
}

/**
 * Expand a finding into didactic blocks. Prefer analyzer body when already rich;
 * always add a short "what this means" framing by severity.
 */
export function expandFindingProse(f: Finding): FindingProse {
  const body = f.body.trim()
  const paragraphs = body.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  const lead = paragraphs[0] ?? body
  const rest = paragraphs.slice(1).join(' ')

  const whatThisMeans =
    rest ||
    (f.severity === 'info'
      ? 'This is first-class information about the period — not noise to filter away.'
      : f.severity === 'notable'
        ? 'Something unusual but not necessarily broken. Treat it as a clue when reading the rest of the report.'
        : f.severity === 'attention'
          ? 'Friction or failure that an operator should investigate before closing the period as “healthy”.'
          : 'A severe condition. Prioritize evidence refs and related findings before changing config.')

  const whatToDoNext =
    f.severity === 'attention' || f.severity === 'critical'
      ? buildNextStep(f)
      : undefined

  return {
    lead: `${SEVERITY_LEAD[f.severity]}: ${f.title}. ${lead}`,
    whatThisMeans,
    whatToDoNext,
  }
}

function buildNextStep(f: Finding): string {
  if (f.analyzer.includes('governance') || f.analyzer.includes('evidence')) {
    return 'Confirm Diagnostics Degraded/Elevate state, recover if needed, then re-run Analysis with the same mandate.'
  }
  if (f.analyzer.includes('nav') || f.analyzer.includes('session')) {
    return 'Open the related session on Timeline (same period) and read the chapter beats in order.'
  }
  if (f.analyzer.includes('span') || f.analyzer.includes('probe')) {
    return 'Inspect open or abandoned spans, check errorCode + phase on failure events, then decide recover vs config change.'
  }
  return 'Use evidence refs below, open the period on Timeline if you need chronology, then decide whether to recover, elevate, or change config.'
}

/** Markdown-friendly block for export. */
export function findingToMarkdown(f: Finding): string {
  const prose = expandFindingProse(f)
  const lines = [
    `### ${f.title} (${f.severity})`,
    '',
    prose.lead,
    '',
    `**What this means.** ${prose.whatThisMeans}`,
  ]
  if (prose.whatToDoNext) {
    lines.push('', `**What to do next.** ${prose.whatToDoNext}`)
  }
  if (f.evidenceRefs.length) {
    lines.push('', `_Evidence:_ ${f.evidenceRefs.slice(0, 12).join(', ')}`)
  }
  return lines.join('\n')
}
