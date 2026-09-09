import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { runDir } from '../core/store.js'
import type { RunManifest } from '../generate/types.js'
import { startPreview, type PreviewTapeEntry } from '../preview/server.js'
import { entrySnapshot, readSnapshots } from './entry.js'
import { compareScreenshots } from './o1.js'
import { analyzeO4, analyzeO4b, rollupGaps } from './o4.js'
import { oracleReferencePath } from './reference.js'
import { PARITY_SCHEMA, type ParityReport } from './types.js'

export function parityDir(sessionId: string, runId: string): string {
  return join(runDir(sessionId, runId), 'parity')
}

export function readParityReport(sessionId: string, runId: string): ParityReport | null {
  const p = join(parityDir(sessionId, runId), 'report.json')
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as ParityReport
}

export async function runParity(opts: {
  sessionId: string
  runId: string
  manifest: RunManifest
}): Promise<ParityReport> {
  const { sessionId, runId, manifest } = opts
  const snapshots = readSnapshots(sessionId)
  const entry = entrySnapshot(snapshots)
  if (!entry) throw new Error('session has no snapshots')

  const outDir = parityDir(sessionId, runId)
  const candDir = join(outDir, 'candidate')
  const diffDir = join(outDir, 'diff')
  mkdirSync(candDir, { recursive: true })
  mkdirSync(diffDir, { recursive: true })

  const tape: PreviewTapeEntry[] = []
  const handle = await startPreview({
    runDir: runDir(sessionId, runId),
    manifest,
    mode: 'fixtures',
    onTape: (e) => tape.push(e),
  })

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  })
  const page = await browser.newPage()
  await page.setViewportSize({ width: entry.viewport.width, height: entry.viewport.height })

  try {
    await page.goto(handle.url, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.getByRole('button', { name: /accept all/i }).click({ timeout: 5000 }).catch(() => undefined)
    await page.waitForTimeout(2000)

    const candPath = join(candDir, `${entry.id}.png`)
    await page.screenshot({ path: candPath, animations: 'disabled' })
  } finally {
    await browser.close()
    await handle.stop()
  }

  const o4 = analyzeO4(tape)
  const o4b = analyzeO4b(tape, sessionId)

  const refPath = oracleReferencePath(sessionId, entry.id)
  let o1: ParityReport['oracles']['O1']
  if (!refPath) {
    o1 = { pass: false, skipped: true, reason: 'no reference captured at close — re-close session after upgrade' }
  } else {
    const diffPath = join(diffDir, `${entry.id}.png`)
    o1 = compareScreenshots(refPath, join(candDir, `${entry.id}.png`), diffPath)
  }

  const gaps = rollupGaps(o4, o4b)
  if (!o1.skipped && !o1.pass) {
    gaps.push({
      layer: 'visual',
      summary: o1.reason ?? `screens differ ${o1.differPct?.toFixed(2)}% (max region ${o1.maxRegion?.w}x${o1.maxRegion?.h})`,
    })
  }

  const pass = o4.pass && o4b.pass && (o1.skipped || o1.pass)

  const report: ParityReport = {
    schema: PARITY_SCHEMA,
    sessionId,
    runId,
    at: new Date().toISOString(),
    entrySnapId: entry.id,
    viewport: entry.viewport,
    pass,
    ignored: o4.ignored,
    oracles: { O4: o4, O4b: o4b, O1: o1 },
    gaps,
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  return report
}
