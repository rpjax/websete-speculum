/**
 * Builds a PageEpoch parity story from a Telemetry Journal export + a front
 * ClientObservation `-front-activity.jsonl` export.
 *
 * A "PageEpoch" is one Virtual navigation identity (`pageEpochId`, minted on
 * hard nav and on SoftNav — see `docs/page-projection-acceptance.md`). This
 * script correlates Virtual / Establish / Asset facts (keyed by pageEpochId)
 * with Diff facts and front `client_*` hops (keyed by `generation`, the only
 * epoch-ish identity currently on the wire) into one story per epoch, plus
 * `verdictHints` for common liquid-load defects.
 *
 * CLI usage:
 *   node build-page-epoch-story.cjs [journalExportPath] [frontActivityPath] [outPath]
 *   JOURNAL=<path> FRONT=<path> OUT=<path> node build-page-epoch-story.cjs
 *
 * Also usable as a module — `buildStory` / `checkParityDebugComplete` are
 * required by `analyze-pipehop.cjs` and `diagnose-smoke.cjs` to fail a run
 * when the ParityDebug pack is on but the story is incomplete.
 */
const fs = require('fs')
const path = require('path')

function loadJournalFacts(journalPath) {
  if (!journalPath || !fs.existsSync(journalPath)) return []
  const raw = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  return Array.isArray(raw) ? raw : (raw.facts ?? [])
}

function loadFrontRows(frontPath) {
  if (!frontPath || !fs.existsSync(frontPath)) return []
  return fs
    .readFileSync(frontPath, 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function payloadOf(fact) {
  const raw = fact.payload ?? fact.Payload
  if (raw == null) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function typeOf(fact) {
  return String(fact.type ?? fact.Type ?? '')
}

function endsWithFact(fact, suffix) {
  return typeOf(fact).endsWith(suffix)
}

function num(v) {
  return v == null ? null : Number(v)
}

function emptyEpoch(pageEpochId) {
  return {
    pageEpochId,
    virtual: {
      bootMarked: null,
      navCommit: null,
      navTiming: null,
      resourceSummary: null,
      pageErrors: [],
      lifecycle: [],
    },
    establish: {
      stylesWait: { started: null, completed: null },
      domMap: { started: null, completed: null, byPath: {} },
      cssomInstall: { started: null, completed: null },
      firstDiffEmitted: null,
      completed: null,
      failed: null,
    },
    asset: {
      rewriteSummary: null,
      fetches: [],
    },
    diff: {
      generation: null,
      frameReceived: 0,
      wireDelivered: 0,
      queueDropped: 0,
      softNavObserved: 0,
      generationBumped: 0,
      resyncRequested: 0,
      resyncServed: 0,
    },
    client: {
      armCount: 0,
      epochArmCount: 0,
      disarmCount: 0,
      desyncCount: 0,
      surfaceProbes: [],
      lastSurfaceProbe: null,
    },
    timings: {
      bootMs: null,
      tSinceCommitFirstDiffMs: null,
      tSinceCommitEstablishMs: null,
      establishTotalMs: null,
    },
    verdictHints: [],
  }
}

/**
 * @param {{facts: unknown[], frontRows: unknown[]}} input
 * @returns story object keyed by pageEpochId (plan F shape)
 */
function buildStory({ facts, frontRows }) {
  const epochs = new Map()
  const generationToEpoch = new Map()
  const globals = { bootMarked: [], serveMiss: [], serveSlow: [] }

  const ensure = (pageEpochId) => {
    if (!pageEpochId) return null
    if (!epochs.has(pageEpochId)) epochs.set(pageEpochId, emptyEpoch(pageEpochId))
    return epochs.get(pageEpochId)
  }

  // Pass 1 — pageEpochId-keyed facts (Virtual/Establish/Asset own pageEpochId
  // directly; ServeMiss/ServeSlow/global BootMarked do not — see
  // ISessionPageProjectionAssetTelemetryEvents / VirtualTelemetryEvents).
  for (const fact of facts) {
    const type = typeOf(fact)
    if (!type.startsWith('Telemetry.Sessions.PageProjection.')) continue
    const p = payloadOf(fact)

    if (endsWithFact(fact, 'Virtual.BootMarked')) {
      const entry = {
        browserLaunchedAtMs: num(p.browserLaunchedAtMs),
        firstCommitAtMs: num(p.firstCommitAtMs),
        bootMs: num(p.bootMs),
      }
      globals.bootMarked.push(entry)
      const epoch = p.pageEpochId ? ensure(p.pageEpochId) : null
      if (epoch) {
        epoch.virtual.bootMarked = entry
        epoch.timings.bootMs = entry.bootMs
      }
      continue
    }
    if (endsWithFact(fact, 'Virtual.NavCommit')) {
      const epoch = ensure(p.pageEpochId)
      if (!epoch) continue
      epoch.virtual.navCommit = {
        url: p.url ?? null,
        generation: num(p.generation),
        documentEpoch: p.documentEpoch ?? null,
        navigationType: p.navigationType ?? null,
        tVirtualMs: num(p.tVirtualMs),
      }
      epoch.diff.generation = num(p.generation)
      if (epoch.diff.generation != null) generationToEpoch.set(epoch.diff.generation, epoch)
      continue
    }
    if (endsWithFact(fact, 'Virtual.NavTiming')) {
      const epoch = ensure(p.pageEpochId)
      if (!epoch) continue
      epoch.virtual.navTiming = {
        redirectMs: num(p.redirectMs),
        dnsMs: num(p.dnsMs),
        connectMs: num(p.connectMs),
        ttfbMs: num(p.ttfbMs),
        domInteractiveMs: num(p.domInteractiveMs),
        domContentLoadedMs: num(p.domContentLoadedMs),
        loadEventMs: num(p.loadEventMs),
      }
      continue
    }
    if (endsWithFact(fact, 'Virtual.ResourceSummary')) {
      const epoch = ensure(p.pageEpochId)
      if (!epoch) continue
      epoch.virtual.resourceSummary = {
        byType: p.byType ?? p.byTypeJson ?? null,
        topSlow: p.topSlow ?? p.topSlowJson ?? null,
      }
      continue
    }
    if (endsWithFact(fact, 'Virtual.PageError')) {
      const epoch = ensure(p.pageEpochId)
      if (!epoch) continue
      epoch.virtual.pageErrors.push({
        source: p.source ?? null,
        message: p.message ?? null,
        urlKey: p.urlKey ?? null,
        count: num(p.count),
      })
      continue
    }
    if (endsWithFact(fact, 'Virtual.Lifecycle')) {
      const epoch = ensure(p.pageEpochId)
      if (!epoch) continue
      epoch.virtual.lifecycle.push({ name: p.name ?? null, tSinceCommitMs: num(p.tSinceCommitMs) })
      continue
    }
    if (endsWithFact(fact, 'Establish.StylesWaitStarted')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) epoch.establish.stylesWait.started = { timeoutMs: num(p.timeoutMs) }
      continue
    }
    if (endsWithFact(fact, 'Establish.StylesWaitCompleted')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) {
        epoch.establish.stylesWait.completed = {
          waitedMs: num(p.waitedMs),
          timedOut: Boolean(p.timedOut),
        }
      }
      continue
    }
    if (endsWithFact(fact, 'Establish.DomMapStarted')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) epoch.establish.domMap.started = { path: p.path ?? null }
      continue
    }
    if (endsWithFact(fact, 'Establish.DomMapCompleted')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) {
        const completed = {
          path: p.path ?? null,
          durationMs: num(p.durationMs),
          approxNodes: num(p.approxNodes),
          takeRecordsMs: num(p.takeRecordsMs),
          clearLedgerMs: num(p.clearLedgerMs),
          anchorAllMs: num(p.anchorAllMs),
          remintMs: num(p.remintMs),
          mapNodeMs: num(p.mapNodeMs),
          resetPublishedMs: num(p.resetPublishedMs),
          cssomMs: num(p.cssomMs),
          pageTotalMs: num(p.pageTotalMs),
          cdpTransferMs: num(p.cdpTransferMs),
        }
        epoch.establish.domMap.completed = completed
        const pathKey = String(p.path || 'unknown')
        if (!epoch.establish.domMap.byPath) epoch.establish.domMap.byPath = {}
        epoch.establish.domMap.byPath[pathKey] = completed
      }
      continue
    }
    if (endsWithFact(fact, 'Establish.CssomInstallStarted')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) epoch.establish.cssomInstall.started = { source: p.source ?? null }
      continue
    }
    if (endsWithFact(fact, 'Establish.CssomInstallCompleted')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) {
        epoch.establish.cssomInstall.completed = {
          source: p.source ?? null,
          durationMs: num(p.durationMs),
          sheetCount: num(p.sheetCount),
          ruleCount: num(p.ruleCount),
          seededSheetCount: num(p.seededSheetCount),
        }
      }
      continue
    }
    if (endsWithFact(fact, 'Establish.FirstDiffEmitted')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) {
        epoch.establish.firstDiffEmitted = {
          plane: p.plane ?? null,
          operation: p.operation ?? null,
          sequence: num(p.sequence),
          tSinceCommitMs: num(p.tSinceCommitMs),
        }
        epoch.timings.tSinceCommitFirstDiffMs = num(p.tSinceCommitMs)
      }
      continue
    }
    if (endsWithFact(fact, 'Establish.EstablishCompleted')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) {
        epoch.establish.completed = { totalMs: num(p.totalMs), tSinceCommitMs: num(p.tSinceCommitMs) }
        epoch.timings.establishTotalMs = num(p.totalMs)
        epoch.timings.tSinceCommitEstablishMs = num(p.tSinceCommitMs)
      }
      continue
    }
    if (endsWithFact(fact, 'Establish.EstablishFailed')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) {
        epoch.establish.failed = {
          errorCode: p.errorCode ?? null,
          phase: p.phase ?? null,
          message: p.message ?? null,
        }
      }
      continue
    }
    if (endsWithFact(fact, 'Asset.RewriteSummary')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) {
        epoch.asset.rewriteSummary = {
          candidates: num(p.candidates),
          rewritten: num(p.rewritten),
          bareSkipped: num(p.bareSkipped),
          dataInlined: num(p.dataInlined),
          blobQueued: num(p.blobQueued),
          deferredFetches: num(p.deferredFetches),
        }
      }
      continue
    }
    if (endsWithFact(fact, 'Asset.FetchFinished')) {
      const epoch = ensure(p.pageEpochId)
      if (epoch) {
        epoch.asset.fetches.push({
          urlKey: p.urlKey ?? null,
          durationMs: num(p.durationMs),
          bytes: num(p.bytes),
          mode: p.mode ?? null,
          ok: Boolean(p.ok),
        })
      }
      continue
    }
    // ServeMiss / ServeSlow carry no pageEpochId (DomAsset proxy is epoch-agnostic).
    if (endsWithFact(fact, 'Asset.ServeMiss')) {
      globals.serveMiss.push({ urlKey: p.urlKey ?? null, durationMs: num(p.durationMs), status: num(p.status) })
      continue
    }
    if (endsWithFact(fact, 'Asset.ServeSlow')) {
      globals.serveSlow.push({ urlKey: p.urlKey ?? null, durationMs: num(p.durationMs), status: num(p.status) })
      continue
    }
  }

  // Pass 2 — Diff facts are generation-keyed only; attribute to the epoch that
  // minted that generation via NavCommit (best-effort — pageEpochId is not on
  // the Diff wire yet).
  for (const fact of facts) {
    const type = typeOf(fact)
    if (!type.startsWith('Telemetry.Sessions.PageProjection.Diff.')) continue
    const p = payloadOf(fact)
    const generation = num(p.generation ?? p.toGeneration)
    const epoch = generation != null ? generationToEpoch.get(generation) : null
    if (!epoch) continue
    if (endsWithFact(fact, 'Diff.FrameReceived')) epoch.diff.frameReceived += 1
    else if (endsWithFact(fact, 'Diff.WireDelivered')) epoch.diff.wireDelivered += 1
    else if (endsWithFact(fact, 'Diff.QueueDropped')) epoch.diff.queueDropped += 1
    else if (endsWithFact(fact, 'Diff.SoftNavObserved')) epoch.diff.softNavObserved += 1
    else if (endsWithFact(fact, 'Diff.GenerationBumped')) epoch.diff.generationBumped += 1
    else if (endsWithFact(fact, 'Diff.ResyncRequested')) epoch.diff.resyncRequested += 1
    else if (endsWithFact(fact, 'Diff.ResyncServed')) epoch.diff.resyncServed += 1
  }

  // Pass 3 — front `client_*` hops, also generation-keyed only.
  for (const row of frontRows ?? []) {
    const hop = row.fields?.hop ?? row.hop
    if (!hop) continue
    const generation = num(row.fields?.generation ?? row.generation)
    const epoch = generation != null ? generationToEpoch.get(generation) : null
    if (!epoch) continue
    if (hop === 'client_arm') epoch.client.armCount += 1
    else if (hop === 'client_epoch_arm') epoch.client.epochArmCount += 1
    else if (hop === 'client_disarm') epoch.client.disarmCount += 1
    else if (hop === 'client_desync') epoch.client.desyncCount += 1
    else if (hop === 'client_surface_probe') {
      const extra = row.fields?.extra ?? {}
      const probe = {
        tClient: row.fields?.tClient ?? null,
        htmlLen: extra.htmlLen ?? null,
        ownedRules: extra.ownedRules ?? null,
        imgCount: extra.imgCount ?? null,
        brokenImgs: extra.brokenImgs ?? null,
        brokenImgsInViewport: extra.brokenImgsInViewport ?? null,
        armed: row.fields?.armed ?? null,
        lastSequence: row.fields?.sequence ?? null,
        lagMsP50: extra.lagMsP50 ?? null,
      }
      epoch.client.surfaceProbes.push(probe)
      epoch.client.lastSurfaceProbe = probe
    }
  }

  for (const epoch of epochs.values()) {
    epoch.verdictHints = verdictHintsFor(epoch)
  }

  const epochOrder = [...epochs.keys()].sort((a, b) => {
    const ta = epochs.get(a).virtual.navCommit?.tVirtualMs ?? Number.MAX_SAFE_INTEGER
    const tb = epochs.get(b).virtual.navCommit?.tVirtualMs ?? Number.MAX_SAFE_INTEGER
    return ta - tb
  })

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    epochCount: epochs.size,
    epochOrder,
    epochs: Object.fromEntries(epochs),
    globals,
  }
}

/** Heuristic liquid-load defect hints — see docs/telemetry.md § PageEpoch story. */
function verdictHintsFor(epoch) {
  const hints = []
  const navCommit = epoch.virtual.navCommit
  const navTiming = epoch.virtual.navTiming
  const domMap = epoch.establish.domMap.completed
  const cssomInstall = epoch.establish.cssomInstall.completed
  const establishCompleted = epoch.establish.completed
  const stylesWait = epoch.establish.stylesWait.completed

  if (!navCommit) hints.push('missing_nav_commit')
  if (navTiming?.ttfbMs != null && navTiming.ttfbMs > 1000) hints.push('virtual_ttfb_high')
  if (domMap?.durationMs != null && domMap.durationMs > 2000) hints.push('establish_dom_map_gt_2s')
  if (domMap?.cdpTransferMs != null && domMap.pageTotalMs != null && domMap.cdpTransferMs > domMap.pageTotalMs) {
    hints.push('dom_map_cdp_transfer_dominant')
  }
  if (domMap?.mapNodeMs != null && domMap.pageTotalMs && domMap.mapNodeMs / domMap.pageTotalMs > 0.5) {
    hints.push('dom_map_map_node_dominant')
  }
  if (domMap?.anchorAllMs != null && domMap.pageTotalMs && domMap.anchorAllMs / domMap.pageTotalMs > 0.4) {
    hints.push('dom_map_anchor_all_dominant')
  }
  if (domMap?.durationMs != null && establishCompleted?.totalMs) {
    if (domMap.durationMs / establishCompleted.totalMs > 0.6) hints.push('oob_dom_map_dominant')
  }
  if (cssomInstall?.durationMs != null && cssomInstall.durationMs > 1000) {
    hints.push('establish_cssom_install_slow')
  }
  if (stylesWait?.timedOut) hints.push('establish_styles_wait_timed_out')
  if (epoch.establish.failed) hints.push('establish_failed')
  if (
    navCommit
    && navCommit.navigationType !== 'soft'
    && !epoch.establish.completed
    && !epoch.establish.failed
  ) {
    hints.push('establish_missing')
  }
  if (epoch.virtual.pageErrors.length > 0) hints.push('virtual_page_errors_present')
  if (epoch.diff.queueDropped > 0 && epoch.diff.resyncServed === 0) {
    hints.push('diff_queue_dropped_without_resync')
  }
  if ((epoch.client.lastSurfaceProbe?.brokenImgs ?? 0) > 0) hints.push('client_broken_imgs_present')
  if (epoch.asset.fetches.some((f) => f.ok === false)) hints.push('asset_fetch_failures')

  return hints
}

/**
 * Practical ParityDebug completeness gate: when the pack is on (any
 * Virtual.NavCommit or Establish.* fact present), every non-soft-nav epoch
 * must have an EstablishCompleted or EstablishFailed fact.
 */
function checkParityDebugComplete(story, facts) {
  const gated = facts.some((fact) => {
    const type = typeOf(fact)
    return type.endsWith('PageProjection.Virtual.NavCommit') || type.includes('PageProjection.Establish.')
  })
  if (!gated) {
    return { gated: false, ok: true, incomplete: [] }
  }

  const incomplete = []
  for (const epoch of Object.values(story.epochs)) {
    const navCommit = epoch.virtual.navCommit
    if (!navCommit) {
      incomplete.push({ pageEpochId: epoch.pageEpochId, reason: 'missing_nav_commit' })
      continue
    }
    if (navCommit.navigationType === 'soft') continue
    if (!epoch.establish.completed && !epoch.establish.failed) {
      incomplete.push({ pageEpochId: epoch.pageEpochId, reason: 'missing_establish_completed_or_failed' })
    }
  }
  return { gated: true, ok: incomplete.length === 0, incomplete }
}

module.exports = { buildStory, checkParityDebugComplete, loadJournalFacts, loadFrontRows }

if (require.main === module) {
  const journalPath = process.argv[2] || process.env.JOURNAL
  const frontPath = process.argv[3] || process.env.FRONT
  const outPath = process.argv[4] || process.env.OUT || path.join(__dirname, 'page-epoch-story.json')

  if (!journalPath) {
    console.error('Usage: node build-page-epoch-story.cjs <journal-export.json> [front-activity.jsonl] [out.json]')
    process.exit(1)
  }

  const facts = loadJournalFacts(journalPath)
  const frontRows = loadFrontRows(frontPath)
  const story = buildStory({ facts, frontRows })
  const gate = checkParityDebugComplete(story, facts)

  fs.writeFileSync(outPath, JSON.stringify(story, null, 2))
  console.log(`WROTE ${outPath}`)
  console.log(JSON.stringify({ epochCount: story.epochCount, parityDebugGate: gate }, null, 2))

  if (gate.gated && !gate.ok) {
    console.error('FAIL — ParityDebug pack on but story incomplete:', JSON.stringify(gate.incomplete))
    process.exit(1)
  }
}
