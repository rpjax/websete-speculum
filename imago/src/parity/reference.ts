import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext } from 'playwright-core'
import { sessionDir } from '../core/store.js'
import type { SessionConfig, SnapshotRecord } from '../core/types.js'
import type { OracleMeta } from './types.js'
import { oracleSnapshotTargets, readSnapshots } from './entry.js'

const FREEZE_CSS = '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}'

/** Capture reference screenshots at close (parity.md §2, capture.md §2). */
export async function captureOracleReferences(
  context: BrowserContext,
  sessionId: string,
  config: SessionConfig,
): Promise<number> {
  const snapshots = readSnapshots(sessionId)
  const targets = oracleSnapshotTargets(snapshots)
  if (targets.length === 0) return 0

  const page = context.pages()[0] ?? await context.newPage()
  let captured = 0

  for (const snap of targets) {
    const dir = join(sessionDir(sessionId), 'oracles', snap.id)
    mkdirSync(dir, { recursive: true })
    try {
      if (page.url() !== snap.url) {
        await page.goto(snap.url, { waitUntil: 'networkidle', timeout: 90_000 })
      }
      await page.setViewportSize({
        width: snap.viewport.width,
        height: snap.viewport.height,
      })
      await page.addStyleTag({ content: FREEZE_CSS }).catch(() => undefined)
      await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => undefined)
      const refPath = join(dir, 'reference.png')
      await page.screenshot({ path: refPath, animations: 'disabled', fullPage: false })

      const meta: OracleMeta = {
        url: snap.url,
        viewport: snap.viewport,
        locale: config.locale,
        timezone: config.timezoneId,
        capturedAt: new Date().toISOString(),
      }
      writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))

      const snapPath = join(sessionDir(sessionId), 'snapshots', `${snap.id}.json`)
      if (existsSync(snapPath)) {
        const rec = JSON.parse(readFileSync(snapPath, 'utf8')) as SnapshotRecord
        rec.oracleRef = 'reference.png'
        writeFileSync(snapPath, JSON.stringify(rec, null, 2))
      }
      captured++
    } catch {
      // one failed reference must not block close
    }
  }
  return captured
}

export function oracleReferencePath(sessionId: string, snapId: string): string | null {
  const p = join(sessionDir(sessionId), 'oracles', snapId, 'reference.png')
  return existsSync(p) ? p : null
}

export function readOracleMeta(sessionId: string, snapId: string): OracleMeta | null {
  const p = join(sessionDir(sessionId), 'oracles', snapId, 'meta.json')
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as OracleMeta
}

export function listOracleSnapIds(sessionId: string): string[] {
  const dir = join(sessionDir(sessionId), 'oracles')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((d) =>
    existsSync(join(dir, d, 'reference.png')),
  )
}
