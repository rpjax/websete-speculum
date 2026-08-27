'use strict';
/**
 * Capture wire frame order (contextId × sequence × preTableHash) during Eneba load.
 * docker compose exec lab node scripts/diag-eneba-frame-order.js
 */
process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';

const { chromium } = require('patchright');
const {
  peekFrameHeader,
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
} = require('@speculum/page-projection/core/decode');
const { ReplicatedTable } = require('@speculum/page-projection/core/replicatedTable');
const { applyFrameToTableChecked } = require('@speculum/page-projection/core/replicatedTableApply');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const frames = [];
  const desyncs = [];
  const byContext = new Map();

  function ctxState(id) {
    let s = byContext.get(id);
    if (!s) {
      s = {
        persistent: new PersistentStringTable(),
        assembler: new FramePartAssembler(),
        table: new ReplicatedTable(),
        lastSeq: 0,
      };
      byContext.set(id, s);
    }
    return s;
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') {
        let msg;
        try {
          msg = JSON.parse(frame.payload);
        } catch {
          return;
        }
        if (msg.type === 'telemetry' && msg.message?.kind === 'desynced') desyncs.push(msg.message);
        return;
      }
      let bytes;
      if (Buffer.isBuffer(frame.payload)) bytes = frame.payload;
      else if (frame.payload instanceof Uint8Array) bytes = Buffer.from(frame.payload);
      else if (typeof frame.payload === 'string') {
        try {
          bytes = Buffer.from(frame.payload, 'base64');
        } catch {
          return;
        }
      } else return;
      const hdr = peekFrameHeader(bytes);
      if (!hdr) return;

      const st = ctxState(hdr.contextId);
      const decoded = decodeFramePart(bytes, st.persistent);
      if (!decoded.ok) {
        frames.push({ ctx: hdr.contextId, seq: hdr.sequence, err: decoded.reason });
        return;
      }
      const assembled = st.assembler.ingest(decoded.part);
      if (assembled === null) return;
      if (assembled === 'missing_part' || assembled === 'malformed') {
        frames.push({ ctx: hdr.contextId, seq: hdr.sequence, err: assembled });
        return;
      }

      const before = st.table.tableHash.toString();
      let applyOk = true;
      let applyErr = null;
      if (!assembled.resync && assembled.preTableHash !== st.table.tableHash) {
        applyOk = false;
        applyErr = `preTableHash expected=${assembled.preTableHash} actual=${st.table.tableHash}`;
      } else {
        const r = applyFrameToTableChecked(st.table, assembled.resync, assembled.ops, assembled.sequence);
        if (!r.ok) {
          applyOk = false;
          applyErr =
            r.opName === 'check'
              ? `check expected=${r.expected} actual=${r.actual}`
              : r.message;
        } else {
          st.lastSeq = assembled.sequence;
        }
      }

      const hasCheck = assembled.ops.some((o) => o.op === 0x0b);
      frames.push({
        ctx: assembled.contextId,
        gen: assembled.generation,
        seq: assembled.sequence,
        resync: assembled.resync,
        opCount: assembled.ops.length,
        hasCheck,
        wirePre: assembled.preTableHash.toString(),
        tableBefore: before,
        tableAfter: st.table.tableHash.toString(),
        rows: st.table.size,
        applyOk,
        applyErr,
      });
    });
  });

  try {
    await page.goto('http://127.0.0.1:4103/', { waitUntil: 'domcontentloaded' });
    await page.click('#connect');
    await page.waitForFunction(
      () => /ws open|connected/i.test(document.getElementById('chipWs')?.textContent ?? ''),
      null,
      { timeout: 20_000 },
    );
    await page.fill('#url', 'https://www.eneba.com');
    await page.click('#browseStart');

    const deadline = Date.now() + 50_000;
    while (Date.now() < deadline) {
      const d = desyncs[0];
      if (d) break;
      const last = frames[frames.length - 1];
      if (last && last.ctx === 1 && last.seq >= 4) break;
      await wait(400);
    }
    await wait(3000);
    await page.click('#browseStop').catch(() => undefined);
    await wait(1500);
  } finally {
    await browser.close();
  }

  console.log('\n=== FRAME ORDER (per-context replay, post-rewrite wire) ===');
  for (const f of frames) {
    console.log(JSON.stringify(f));
  }

  const firstBad = frames.find((f) => !f.applyOk);
  if (firstBad) {
    console.log('\n=== FIRST REPLAY FAILURE ===');
    console.log(JSON.stringify(firstBad, null, 2));
  }

  const ctx2 = frames.filter((f) => f.ctx === 2);
  if (ctx2.length > 0) {
    console.log(`\n=== NESTED ctx2 frames: ${ctx2.length} (interleaved with root) ===`);
    const ctx1Before4 = frames.filter((f) => f.ctx === 1 && f.seq <= 3);
    const ctx2BeforeRoot4 = frames.filter((f) => {
      const root4Idx = frames.findIndex((x) => x.ctx === 1 && x.seq === 4);
      const idx = frames.indexOf(f);
      return f.ctx === 2 && idx >= 0 && (root4Idx < 0 || idx < root4Idx);
    });
    console.log(`ctx1 seq1-3 count: ${ctx1Before4.length}`);
    console.log(`ctx2 before root seq4: ${ctx2BeforeRoot4.length}`);
    if (ctx2BeforeRoot4.length > 0) {
      console.log('ctx2 before root4:', JSON.stringify(ctx2BeforeRoot4));
    }
  }

  if (desyncs[0]) {
    console.log('\n=== CLIENT DESYNC ===');
    console.log(JSON.stringify(desyncs[0]));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
