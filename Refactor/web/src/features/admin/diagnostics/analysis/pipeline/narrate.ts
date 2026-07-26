import { formatDuration } from '@/lib/diagnosticsConstants'
import type { EvidenceBag, Finding, ReportDocument, ReportSection, ReportSectionId } from '../types'

/** Sections that must appear even when empty (didactic completeness). */
export const REQUIRED_REPORT_SECTIONS: ReportSectionId[] = [
  'cover',
  'portrait',
  'proseTimeline',
  'cast',
  'chapters',
  'signals',
  'crossings',
  'governance',
  'attention',
  'glossary',
  'appendix',
]

const SECTION_META: { id: ReportSectionId; title: string; lead: string }[] = [
  {
    id: 'cover',
    title: 'Cover, mandate, and sources',
    lead: 'What was asked, what evidence was gathered, and what gaps remain.',
  },
  {
    id: 'portrait',
    title: 'Portrait of the period',
    lead: 'Density and mix of activity — a calm summary before the details.',
  },
  {
    id: 'proseTimeline',
    title: 'Timeline in prose',
    lead: 'A literary condensation of chapters in time order.',
  },
  {
    id: 'cast',
    title: 'Cast — sessions and system',
    lead: 'Who was on stage: session lanes and the System lane.',
  },
  {
    id: 'chapters',
    title: 'Chapters in detail',
    lead: 'Inventory of story types, outcomes, and successful examples kept on purpose.',
  },
  {
    id: 'signals',
    title: 'Continuous signals',
    lead: 'Telemetry and other continuous measurements that contextualize the beats.',
  },
  {
    id: 'crossings',
    title: 'Crossings and correlations',
    lead: 'Where domains and sessions interact — causation across the cast.',
  },
  {
    id: 'governance',
    title: 'Governance and evidence completeness',
    lead: 'Degraded, Elevate, and whether the evidence bag is trustworthy.',
  },
  {
    id: 'attention',
    title: 'Attention — problems and friction',
    lead: 'One place for friction. Routine success lives in the sections above.',
  },
  {
    id: 'glossary',
    title: 'Glossary',
    lead: 'Shared vocabulary for reading this report and the Timeline.',
  },
  {
    id: 'appendix',
    title: 'Technical appendix',
    lead: 'Indexes for Act→Assert follow-up — not a raw JSON dump.',
  },
]

const GLOSSARY = [
  { term: 'Beat', definition: 'A single diagnostics event — an immutable timeline fact with envelope fields (seq, spanId, causationId, …).' },
  { term: 'Span', definition: 'A timed action paired by Open/Close beats sharing spanId (e.g. motor.navigate).' },
  { term: 'Chapter', definition: 'A correlated narrative unit (usually one correlationId) containing beats and spans.' },
  { term: 'Lane', definition: 'A parallel narrative track — typically one session or the System lane.' },
  { term: 'Degraded', definition: 'Diagnostics circuit-breaker state that caps domains to Metric capability.' },
  { term: 'Elevate', definition: 'TTL overlay forcing BrowserQuery probe + SidecarBrowser capabilities on.' },
]

function findingsFor(section: ReportSectionId, findings: Finding[]): Finding[] {
  return findings.filter((f) => f.sectionHints.includes(section))
}

function coverParagraphs(bag: EvidenceBag): string[] {
  const dur = formatDuration(Math.max(0, bag.mandate.toMs - bag.mandate.fromMs))
  const scope =
    bag.mandate.scope.kind === 'platform'
      ? 'the full platform'
      : bag.mandate.scope.kind === 'system'
        ? 'system / DiagnosticsSelf only'
        : `${bag.mandate.scope.connectionIds.length} session(s)`
  const gaps =
    bag.gaps.length > 0
      ? `Known gaps: ${bag.gaps.join('; ')}.`
      : 'No collection gaps were recorded for this run.'
  return [
    `This report analyzes ${scope} from ${new Date(bag.mandate.fromMs).toLocaleString()} to ${new Date(bag.mandate.toMs).toLocaleString()} (${dur}).`,
    `Depth is ${bag.mandate.depth}; study profile is ${bag.mandate.profile}. ` +
      `Evidence layers requested: events=${bag.mandate.includeEvents}, telemetry=${bag.mandate.includeTelemetry}, ` +
      `runtime=${bag.mandate.includeRuntime}, snapshots=${bag.mandate.includeSnapshots}.`,
    `Collected ${bag.events.length} event(s), ${bag.telemetry.length} telemetry sample(s), ` +
      `${bag.snapshots.length} live snapshot(s). Catalog names known: ${bag.catalogNames.length}. ${gaps}`,
    'This is a complete reading of available evidence — routine success and friction alike — not an incident-only digest.',
  ]
}

function proseTimeline(bag: EvidenceBag): string[] {
  const chapters = bag.narrative?.chapters ?? []
  if (chapters.length === 0) {
    return [
      'No chapters could be reconstructed for a prose timeline. See Governance for completeness notes, or widen the mandate period.',
    ]
  }
  const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs)
  const paras = [
    `Literary condensation of ${sorted.length} chapter(s) in chronological order:`,
  ]
  for (const c of sorted.slice(0, 12)) {
    paras.push(`• ${new Date(c.startMs).toLocaleTimeString()} — ${c.proseHint}`)
  }
  if (sorted.length > 12) {
    paras.push(`…and ${sorted.length - 12} additional chapter(s) omitted from this prose digest (see Chapters section).`)
  }
  paras.push('Successful chapter examples are retained as first-class information, not filtered away.')
  return paras
}

function castParagraphs(bag: EvidenceBag): string[] {
  const lanes = bag.narrative?.lanes ?? []
  if (lanes.length === 0) {
    return ['No lanes in the reconstructed narrative. Events may still exist — check Portrait and Governance.']
  }
  return [
    `The cast comprises ${lanes.length} lane(s). Each lane is a parallel story track.`,
    ...lanes.map(
      (l) =>
        `• ${l.label}: ${l.chapters.length} chapter(s), ${l.beats.length} beat(s)` +
        (l.kind === 'session' ? `, connection ${l.id}` : ''),
    ),
  ]
}

function emptyCoaching(id: ReportSectionId): string[] {
  switch (id) {
    case 'portrait':
      return ['No volume portrait findings were produced. The period may be empty, or event collection was disabled in the mandate.']
    case 'chapters':
      return ['No chapter inventory is available. Without correlated events, chapters cannot be rebuilt.']
    case 'signals':
      return ['No continuous-signal findings. Telemetry may be off in the mandate, or no samples landed in the window.']
    case 'crossings':
      return ['No cross-domain correlations were highlighted. That can be healthy quiet — not a missing failure.']
    case 'governance':
      return ['No governance or completeness findings. Treat that as “nothing raised,” then confirm evidence toggles on the cover.']
    default:
      return ['No additional material for this section.']
  }
}

function appendixParagraphs(bag: EvidenceBag, findings: Finding[]): string[] {
  return [
    `Findings total: ${findings.length}.`,
    `Event id sample: ${bag.events.slice(0, 10).map((e) => e.id).join(', ') || 'none'}.`,
    `Seq range: ${minmaxSeq(bag)}.`,
    'Raw payloads remain on individual beats; this appendix is an index for Act→Assert follow-up, not a JSON dump.',
  ]
}

function minmaxSeq(bag: EvidenceBag): string {
  const seqs = bag.events.map((e) => e.seq).filter((s): s is number => typeof s === 'number')
  if (seqs.length === 0) return 'n/a'
  return `${Math.min(...seqs)} … ${Math.max(...seqs)}`
}

export function narrateReport(bag: EvidenceBag, findings: Finding[]): ReportDocument {
  const sections: ReportSection[] = []

  for (const meta of SECTION_META) {
    const sectionFindings = findingsFor(meta.id, findings)
    const filtered =
      meta.id === 'attention'
        ? findings.filter((f) => f.severity === 'attention' || f.severity === 'critical')
        : sectionFindings

    let paragraphs: string[] = [meta.lead]
    if (meta.id === 'cover') paragraphs = coverParagraphs(bag)
    else if (meta.id === 'proseTimeline') paragraphs = proseTimeline(bag)
    else if (meta.id === 'cast') paragraphs = castParagraphs(bag)
    else if (meta.id === 'glossary') {
      paragraphs = [meta.lead, ...GLOSSARY.map((g) => `${g.term} — ${g.definition}`)]
    } else if (meta.id === 'appendix') paragraphs = appendixParagraphs(bag, findings)
    else if (meta.id === 'attention' && filtered.length === 0) {
      paragraphs = [
        meta.lead,
        'No attention- or critical-severity findings were raised for this mandate. ' +
          'That does not mean “nothing happened” — see Portrait, Chapters, and Signals for the full reading.',
      ]
    } else if (filtered.length === 0) {
      paragraphs = [meta.lead, ...emptyCoaching(meta.id)]
    } else {
      paragraphs = [meta.lead]
    }

    sections.push({
      id: meta.id,
      title: meta.title,
      paragraphs,
      findings: meta.id === 'glossary' || meta.id === 'appendix' ? [] : filtered,
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    mandate: bag.mandate,
    title: `Diagnostics analysis · ${new Date(bag.mandate.fromMs).toLocaleString()} → ${new Date(bag.mandate.toMs).toLocaleString()}`,
    sections,
    findings,
    glossary: GLOSSARY,
  }
}
