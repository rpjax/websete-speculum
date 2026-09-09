/**
 * A/B do exclude_matches — mede se a extensao dentro do iframe do challenge e o que
 * faz o desafio repetir round.
 *
 * Metrica: rounds = requests a /cdn-cgi/challenge-platform/. Limpo ~3, em loop ~10.
 * E msToPass. Sem cronometro humano.
 *
 * Alterna A,B,A,B... de proposito: reputacao de IP e hora do dia derivam ao longo da
 * sessao; alternar cancela essa deriva. Rodar todos os A e depois todos os B nao cancela.
 *
 * A = manifest como esta hoje
 * B = manifest + "exclude_matches": ["https://challenges.cloudflare.com/*"] no bloco MAIN
 *
 * Run: node scripts/cf-ab.js            (8 pares)
 *      node scripts/cf-ab.js --pairs 5
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { launchChrome, speculumPpExtensionPath } = require('../dist/browser/patchright/ChromeRuntime.js');
const { readMainWorld, extensionPresent } = require('./cf-detect.js');

const TARGET = 'https://www.eneba.com';
const WINDOW_MS = 75_000;
const ATTEMPT_CAP_MS = 150_000;
const EXCLUDE = ['https://challenges.cloudflare.com/*'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dest, e.name);
    if (e.isDirectory()) copyDirSync(a, b); else fs.copyFileSync(a, b);
  }
}

function materialize(condition, dir) {
  copyDirSync(speculumPpExtensionPath(), dir);
  const mp = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  const main = m.content_scripts.find((c) => c.world === 'MAIN');
  if (!main) throw new Error('manifest sem bloco MAIN');
  if (condition === 'B') main.exclude_matches = EXCLUDE;
  else delete main.exclude_matches; // A e sempre o manifest sem a chave, mesmo se o template ja tiver
  fs.writeFileSync(mp, JSON.stringify(m, null, 2), 'utf8');
  return main.exclude_matches ?? null;
}

async function clickGeo(page) {
  for (const loc of [
    page.getByRole('button', { name: /^\s*sim\s*$/i }),
    page.getByRole('link', { name: /^\s*sim\s*$/i }),
    page.locator('button:has-text("SIM")'),
  ]) {
    try { await loc.first().click({ timeout: 4000 }); return true; } catch { /* proximo */ }
  }
  return false;
}

async function state(page, context) {
  const title = await page.title().catch(() => '');
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 1500) ?? '').catch(() => '');
  const cookies = await context.cookies().catch(() => []);
  const clearance = !!cookies.find((c) => c.name === 'cf_clearance');
  const inter = /just a moment|um momento|performing security verification|verificando/i.test(`${title} ${body}`);
  return { inter, clearance, title, blocked: /incompatible browser extension|blocked the security/i.test(body) };
}

async function run(condition, i) {
  const sessionId = `cfab-${condition}-${randomUUID()}`;
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), `ppab-${condition}${i}-`));
  const rec = { condition, i, rounds: 0, chlStatuses: [], startedAt: new Date().toISOString() };
  let handle = null;
  try {
    rec.excludeApplied = materialize(condition, extDir);
    handle = await launchChrome({
      sessionId, headless: false, width: 1280, height: 800,
      locale: 'pt-BR', language: 'pt-BR', timeZoneId: 'America/Sao_Paulo', colorScheme: 'light',
      extensionPaths: [extDir],
    });
    const { context, page } = handle;
    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('/cdn-cgi/challenge-platform/')) {
        rec.rounds += 1;
        if (rec.chlStatuses.length < 20) rec.chlStatuses.push(r.status());
      }
    });

    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await wait(2500);

    // A extensao tem que estar viva nos dois lados, senao o par nao compara nada.
    const main = await readMainWorld(page);
    rec.extPresent = extensionPresent(main);

    rec.geo = await clickGeo(page);

    const t0 = Date.now();
    let tInter = null, tPass = null;
    let s = await state(page, context);
    while (Date.now() - t0 < WINDOW_MS) {
      if (s.inter && tInter === null) tInter = Date.now();
      if (s.clearance && !s.inter && tInter !== null) { tPass = Date.now(); break; }
      if (s.blocked) break;
      await wait(400);
      s = await state(page, context);
    }
    rec.challengeAppeared = tInter !== null;
    rec.msToPass = tInter && tPass ? tPass - tInter : null;
    rec.neverPassed = tInter !== null && tPass === null;
    rec.finalTitle = s.title;
  } catch (e) {
    rec.error = e instanceof Error ? e.message : String(e);
  } finally {
    try { await handle?.context.close(); } catch { /* */ }
    fs.rmSync(extDir, { recursive: true, force: true });
  }
  return rec;
}

const med = (xs) => {
  const a = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

async function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf('--pairs');
  const pairs = pi >= 0 && argv[pi + 1] ? Math.max(1, Math.min(20, Number(argv[pi + 1]))) : 8;

  const outDir = path.join(process.cwd(), 'lab-runs', 'cf-ab', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(outDir, { recursive: true });
  const records = [];

  for (let i = 1; i <= pairs; i++) {
    for (const c of ['A', 'B']) {
      const r = await Promise.race([run(c, i), wait(ATTEMPT_CAP_MS).then(() => ({ condition: c, i, verdict: 'TIMEOUT' }))]);
      records.push(r);
      process.stdout.write(
        `${c}${i}\trounds=${r.rounds ?? '-'}\tchl=${r.challengeAppeared ?? '-'}\tms=${r.msToPass ?? '-'}\tnever=${r.neverPassed ?? '-'}\text=${r.extPresent ?? '-'}\tgeo=${r.geo ?? '-'}${r.error ? ' ERR ' + r.error : ''}\n`,
      );
      await wait(1500);
    }
  }

  fs.writeFileSync(path.join(outDir, 'ab.json'), JSON.stringify({ pairs, records }, null, 2));

  process.stdout.write('\n=== A/B ===\n');
  for (const c of ['A', 'B']) {
    const rs = records.filter((r) => r.condition === c && r.extPresent === true);
    const looped = rs.filter((r) => (r.rounds ?? 0) >= 6).length;
    process.stdout.write(
      `${c === 'A' ? 'A (como esta hoje) ' : 'B (exclude_matches)'}` +
      `\tn=${rs.length}` +
      `\troundsMed=${med(rs.map((r) => r.rounds)) ?? '-'}` +
      `\tloop(rounds>=6)=${looped}/${rs.length}` +
      `\tmsMed=${med(rs.map((r) => r.msToPass)) ?? '-'}` +
      `\tnuncaPassou=${rs.filter((r) => r.neverPassed).length}\n`,
    );
  }
  const bad = records.filter((r) => r.extPresent !== true).length;
  if (bad) process.stdout.write(`\nATENCAO: ${bad} tentativa(s) sem extensao confirmada — fora da conta.\n`);
  process.stdout.write(`\nartefato: ${path.join(outDir, 'ab.json')}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
