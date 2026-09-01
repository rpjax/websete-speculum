import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExportButton } from '@/components/admin/ExportButton'
import type { Finding, ReportDocument, ReportSection } from './types'
import { expandFindingProse, findingToMarkdown } from './narrative/findingProse'
import { cn } from '@/lib/utils'
import { ArrowUpRight } from 'lucide-react'
import { formatDuration } from '@/lib/diagnosticsConstants'

interface AnalysisReportViewProps {
  report: ReportDocument
}

function Callout({ finding }: { finding: Finding }) {
  const prose = expandFindingProse(finding)
  const tone =
    finding.severity === 'critical' || finding.severity === 'attention'
      ? 'border-destructive/35 bg-destructive/5'
      : finding.severity === 'notable'
        ? 'border-amber-500/35 bg-amber-500/5'
        : 'border-sky-500/25 bg-sky-500/5'

  return (
    <aside className={cn('rounded-lg border px-4 py-3', tone)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            finding.severity === 'critical' || finding.severity === 'attention'
              ? 'destructive'
              : finding.severity === 'notable'
                ? 'warning'
                : 'muted'
          }
          className="text-[10px] capitalize"
        >
          {finding.severity}
        </Badge>
        <span className="text-[10px] text-muted-foreground">{finding.analyzer}</span>
      </div>
      <h3 className="mt-2 text-sm font-semibold text-foreground">{finding.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-foreground/90">{prose.lead}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground/80">What this means. </span>
        {prose.whatThisMeans}
      </p>
      {prose.whatToDoNext && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">What to do next. </span>
          {prose.whatToDoNext}
        </p>
      )}
    </aside>
  )
}

function SectionBody({ section }: { section: ReportSection }) {
  const lead = section.paragraphs[0]
  const rest = section.paragraphs.slice(1)

  return (
    <div className="mt-3 space-y-4">
      {lead && (
        <p className="text-base leading-relaxed text-foreground/95">{stripMd(lead)}</p>
      )}
      {rest.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {stripMd(p)}
        </p>
      ))}
      {section.findings.length > 0 && section.id !== 'cover' && (
        <div className="space-y-3 pt-1">
          {section.findings.map((f) => (
            <Callout key={f.id} finding={f} />
          ))}
        </div>
      )}
    </div>
  )
}

function stripMd(s: string): string {
  return s.replace(/\*\*(.*?)\*\*/g, '$1')
}

export function AnalysisReportView({ report }: AnalysisReportViewProps) {
  const [active, setActive] = useState(report.sections[0]?.id ?? 'cover')

  const markdown = useMemo(() => {
    const lines = [
      `# ${report.title}`,
      '',
      `_Generated ${report.generatedAt}_`,
      '',
      `Period: ${new Date(report.mandate.fromMs).toLocaleString()} → ${new Date(report.mandate.toMs).toLocaleString()} ` +
        `(${formatDuration(Math.max(0, report.mandate.toMs - report.mandate.fromMs))})`,
      '',
    ]
    for (const s of report.sections) {
      lines.push(`## ${s.title}`, '')
      for (const p of s.paragraphs) lines.push(stripMd(p), '')
      for (const f of s.findings) {
        lines.push(findingToMarkdown(f), '')
      }
    }
    if (report.glossary.length) {
      lines.push('## Glossary', '')
      for (const g of report.glossary) lines.push(`- **${g.term}** — ${g.definition}`, '')
    }
    return lines.join('\n')
  }, [report])

  const timelineLink = useMemo(() => {
    const q = new URLSearchParams()
    q.set('from', new Date(report.mandate.fromMs).toISOString())
    q.set('to', new Date(report.mandate.toMs).toISOString())
    if (report.mandate.scope.kind === 'sessions' && report.mandate.scope.connectionIds[0]) {
      q.set('connectionId', report.mandate.scope.connectionIds[0])
    }
    return `/admin/diagnostics/timeline?${q.toString()}`
  }, [report.mandate])

  const mandateProse =
    `Mandate: ${report.mandate.profile} profile at ${report.mandate.depth} depth, ` +
    `${formatDuration(Math.max(0, report.mandate.toMs - report.mandate.fromMs))} window.`

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <nav
        className="h-fit sticky top-4 space-y-1 rounded-xl border border-border bg-card p-3"
        aria-label="Report contents"
      >
        <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Contents
        </p>
        {report.sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setActive(s.id)
              document.getElementById(`report-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className={cn(
              'block w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors',
              active === s.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.title}
          </button>
        ))}
        <div className="mt-2 space-y-2 border-t border-border pt-3">
          <ExportButton data={report} filename="diagnostics-analysis" />
          <Button asChild variant="outline" size="sm" className="h-8 w-full gap-1 text-xs">
            <a
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`}
              download="diagnostics-analysis.md"
            >
              Export Markdown
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-8 w-full gap-1 text-xs text-muted-foreground">
            <Link to={timelineLink}>
              View period on Timeline <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </nav>

      <article className="mx-auto max-w-3xl space-y-8">
        <header className="border-b border-border pb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Speculum Diagnostics · Analysis
          </p>
          <h1 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {report.title}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{mandateProse}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.findings.length} findings · {report.sections.length} sections · generated{' '}
            {new Date(report.generatedAt).toLocaleString()}
          </p>
        </header>

        {report.sections.map((section) => (
          <section key={section.id} id={`report-${section.id}`} className="scroll-mt-6">
            <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
              {section.title}
            </h2>
            <SectionBody section={section} />
          </section>
        ))}
      </article>
    </div>
  )
}
