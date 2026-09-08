import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext } from 'playwright-core'
import { profileDir } from '../core/store.js'
import type { SessionConfig } from '../core/types.js'

const here = dirname(fileURLToPath(import.meta.url))

/** dist/agent.js, built by `npm run build:agent`. */
export function agentSource(): string {
  for (const candidate of [join(here, '../../dist/agent.js'), join(here, '../../../dist/agent.js')]) {
    try { return readFileSync(candidate, 'utf8') } catch { /* try next */ }
  }
  throw new Error('agent bundle missing — run `npm run build:agent`')
}

/**
 * Own headed Chrome, own profile dir, system browser by default so nothing is
 * downloaded (D-023). Not patchright; no stealth stack — challenges are ignored.
 */
export async function launch(config: SessionConfig): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir(), {
    headless: false,
    channel: config.executablePath ? undefined : (config.channel ?? 'chrome'),
    executablePath: config.executablePath,
    viewport: config.viewport ?? null,
    userAgent: config.userAgent,
    locale: config.locale,
    timezoneId: config.timezoneId,
    args: ['--start-maximized', '--disable-features=Translate,MediaRouter'],
  })
}
