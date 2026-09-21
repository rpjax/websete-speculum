/**
 * Escada anti-bot v2 — isola o que quebra o challenge Cloudflare no Virtual.
 *
 * Por que a v1 nao mediu nada: usava --load-extension, que o Chrome branded 137+
 * IGNORA (ChromeRuntime.ts:119), e o Playwright ainda adiciona --disable-extensions
 * por padrao. A extensao nunca carregou em degrau nenhum.
 * Esta versao usa launchChrome() de dist/ — o MESMO launcher da producao: flags reais,
 * ignoreDefaultArgs, Extensions.loadUnpacked via CDP do browser, applyLogicalViewport.
 *
 * Regras duras (a v1 travou 3h por nao ter):
 *   - tentativas FIXAS por degrau. Nao existe rerun automatico. Nunca.
 *   - teto de tempo por tentativa E teto global. Estoura -> aborta e reporta.
 *   - autoverificacao SEMPRE depois do goto, na pagina real. about:blank nao injeta
 *     content script; verificar la foi o que gerou INVALID em tudo.
 *
 * Run: node scripts/cf-ladder.js
 *      node scripts/cf-ladder.js --rungs E1,E2 --attempts 3
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { launchChrome } = require('../dist/browser/patchright/ChromeRuntime.js');
const { readMainWorld, extensionPresent } = require('./cf-detect.js');

const TARGET = process.env.CF_TARGET || 'https://www.eneba.com';
const ATTEMPT_TIMEOUT_MS = 180_000;
const GLOBAL_TIMEOUT_MS = 45 * 60_000;
const SETTLE_MS = 90_000;
const EXT_SRC = path.join(__dirname, '..', 'extensions', 'speculum-pp');

const PHONE = { mobile: true, touch: true, deviceScaleFactor: 3, maxTouchPoints: 5, deviceCategory: 'phone' };
const DESKTOP = { mobile: false, touch: false, deviceScaleFactor: 1, maxTouchPoints: 0, deviceCategory: 'pc' };

const ALL = ['main/webgl.js','main/csp-neutralize.js','main/single-tab.js','main/runtime-bridge.js','main/plane-shim.js','main/virtual.js'];
const without = (f) => ALL.filter((x) => x !== f);

/** ext:null = sem extensao. Senao, lista exata de content scripts MAIN presentes. */
const RUNGS = [
  { id: 'E0', label: 'sem extensao, desktop',        ext: null,                          device: DESKTOP, size: [1280, 800] },
  { id: 'E1', label: 'extensao completa, desktop',   ext: ALL,                           device: DESKTOP, size: [1280, 800] },
  { id: 'E2', label: 'extensao completa, mobile',    ext: ALL,                           device: PHONE,   size: [390, 844] },
  { id: 'E3', label: 'mobile, sem csp-neutralize',   ext: without('main/csp-neutralize.js'), device: PHONE, size: [390, 844] },
  { id: 'E4', label: 'mobile, sem webgl',            ext: without('main/webgl.js'),      device: PHONE,   size: [390, 844] },
  { id: 'E5', label: 'mobile, sem single-tab',       ext: without('main/single-tab.js'), device: PHONE,   size: [390, 844] },
  { id: 'E6', label: 'mobile, sem virtual.js',       ext: without('main/virtual.js'),    device: PHONE,   size: [390, 844] },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name);
    const b = path.join(dest, e.name);
    if (e.isDirectory()) copyDirSync(a, b); else fs.copyFileSync(a, b);
  }
}

/** Ausencia real: arquivo apagado do disco E fora do manifest. Flag em runtime nao serve. */
function materialize(keep, dir) {
  copyDirSync(EXT_SRC, dir);
  const mp = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  const block = m.content_scripts.find((c) => c.world === 'MAIN');
  if (!block) throw new Error('manifest sem bloco MAIN');
  const dropped = block.js.filter((f) => !keep.includes(f));
  block.js = block.js.filter((f) => keep.includes(f));
  fs.writeFileSync(mp, JSON.stringify(m, null, 2), 'utf8');
  for (const f of dropped) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return { kept: block.js, dropped };
}

async function classify(page, context) {
  const title = await page.title().catch(() => '');
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '').catch(() => '');
  const cookies = await context.cookies().catch(() => []);
  const cfCookies = cookies.filter((c) => /^(cf_|__cf)/.test(c.name)).map((c) => c.name);
  const clearance = !!cookies.find((c) => c.name === 'cf_clearance');
  const interstitial = /just a moment|um momento|performing security verification|verificando/i.test(`${title} ${body}`);
  const blocked = /incompatible browser extension|blocked the security verification|network configuration/i.test(body);
  const denied = /sorry, you have been blocked|acesso negado|error code: 1020|you are unable to access/i.test(body);
  if (blocked) return { state: 'BLOCKED', title, clearance, cfCookies, body };
  if (denied) return { state: 'DENIED', title, clearance, cfCookies, body };
  if (clearance && !interstitial) return { state: 'PASSED', title, clearance, cfCookies, body };
  if (interstitial) return { state: 'INTERSTITIAL', title, clearance, cfCookies, body };
  return { state: 'NO_CHALLENGE', title, clearance, cfCookies, body };
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

async function runAttempt(rung, outDir, attempt) {
  const tag = `${rung.id}-a${attempt}`;
  const sessionId = `cfladder-${randomUUID()}`;
  const extDir = rung.ext ? fs.mkdtempSync(path.join(os.tmpdir(), `ppext-${tag}-`)) : null;
  const rec = {
    rung: rung.id, label: rung.label, attempt, startedAt: new Date().toISOString(),
    challengeReqs: 0, consoleErrors: [],
    /** POSTs de /cdn-cgi/challenge-platform/ — 403 aqui = desafio recusado. */
    chlPlatform: [],
    /** Resposta do documento principal: 403 = bloqueio, 503 = desafio, cf-mitigated = veredito. */
    docResponses: [],
    /** Quantas vezes a pagina voltou ao interstitial — loop = recusa, nao pendencia. */
    interstitialCycles: 0,
    stateTrace: [],
  };
  let handle = null;

  try {
    if (extDir) rec.extension = materialize(rung.ext, extDir);

    handle = await launchChrome({
      sessionId,
      headless: false,
      width: rung.size[0],
      height: rung.size[1],
      locale: 'pt-BR',
      language: 'pt-BR',
      timeZoneId: 'America/Sao_Paulo',
      colorScheme: 'light',
      device: rung.device,
      extensionPaths: extDir ? [extDir] : [],
    });

    const context = handle.context;
    const page = handle.page;
    // patchright desabilita a Console API inteira (README) — nao ha console para capturar.
    rec.consoleErrors = ['(indisponivel: patchright desabilita a Console API)'];
    // A orquestracao do desafio roda em /cdn-cgi/challenge-platform/ no dominio DO SITE.
    // Filtrar so challenges.cloudflare.com (o widget) perde exatamente a evidencia de recusa.
    page.on('response', async (r) => {
      const u = r.url();
      try {
        if (u.includes('/cdn-cgi/challenge-platform/')) {
          rec.chlPlatform.push({ status: r.status(), path: new URL(u).pathname.slice(-60) });
        }
        if (u.includes('challenges.cloudflare.com')) rec.challengeReqs += 1;
        const req = r.request();
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
          const h = r.headers();
          rec.docResponses.push({
            status: r.status(),
            cfMitigated: h['cf-mitigated'] ?? null,
            cfRay: h['cf-ray'] ?? null,
            server: h['server'] ?? null,
          });
        }
      } catch { /* response ja descartada */ }
    });

    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await wait(3000);

    // Autoverificacao DEPOIS do goto — na pagina real.
    // Canal DOM: patchright avalia em contexto ISOLADO, onde patch MAIN e invisivel.
    rec.state = await readMainWorld(page);
    const wantExt = rung.ext !== null;
    const sawExt = extensionPresent(rec.state);
    // Sem leitura (CSP) != sem extensao. Os dois viram INVALID, com razao distinta.
    rec.extensionConfirmed = sawExt === null ? false : wantExt === sawExt;
    rec.extensionReadFailed = sawExt === null;

    rec.geoClicked = await clickGeo(page);

    // O desafio PASSA — a questao e em quanto tempo e com quantos re-challenges.
    // Chrome limpo libera em segundos; com o motor leva ~1min. A camada culpada e
    // aquela onde esse numero pula. Amostragem curta para ter resolucao.
    const t0 = Date.now();
    const deadline = t0 + SETTLE_MS;
    let sawInterstitial = false;
    let inInterstitial = false;
    let tChallengeStart = null;
    let tPassed = null;
    let st = await classify(page, context);

    while (Date.now() < deadline) {
      const nowIn = st.state === 'INTERSTITIAL';
      if (nowIn && !inInterstitial) {
        // Entrou no interstitial. Primeira vez marca o inicio; as seguintes sao re-challenge.
        if (!sawInterstitial) tChallengeStart = Date.now();
        else rec.interstitialCycles += 1;
        sawInterstitial = true;
        rec.stateTrace.push(`INTERSTITIAL@${Date.now() - t0}ms`);
      }
      if (!nowIn && inInterstitial) rec.stateTrace.push(`OUT@${Date.now() - t0}ms`);
      inInterstitial = nowIn;

      if (st.state === 'PASSED') { tPassed = Date.now(); break; }
      if (st.state === 'BLOCKED' || st.state === 'DENIED') break;
      await wait(500);
      st = await classify(page, context);
    }

    rec.msToPass = tPassed && tChallengeStart ? tPassed - tChallengeStart : null;
    rec.msTotal = (tPassed ?? Date.now()) - t0;
    rec.challengeAppeared = sawInterstitial;
    rec.neverPassed = tPassed === null;
    rec.chlRounds = rec.chlPlatform.length;

    let verdict = st.state;
    if (rec.neverPassed && sawInterstitial) verdict = 'NEVER_PASSED';
    if (!sawInterstitial && st.state === 'PASSED') verdict = 'PASSED_NO_CHALLENGE';
    rec.verdict = rec.extensionConfirmed ? verdict : 'INVALID';
    rec.invalidReason = rec.extensionConfirmed
      ? null
      : sawExt === null
        ? `sem leitura do MAIN: ${rec.state?.reason ?? '?'}`
        : `extensao esperada=${wantExt} observada=${sawExt}`;
    rec.title = st.title;
    rec.cfClearance = st.clearance;
    rec.cfCookies = st.cfCookies;
    rec.bodyHead = (st.body || '').slice(0, 300);

    await page.screenshot({ path: path.join(outDir, `${tag}.png`) }).catch(() => undefined);
  } catch (err) {
    rec.verdict = 'ERROR';
    rec.error = err instanceof Error ? err.message : String(err);
  } finally {
    try { await handle?.context?.close(); } catch { /* */ }
    if (extDir) fs.rmSync(extDir, { recursive: true, force: true });
    rec.endedAt = new Date().toISOString();
  }
  return rec;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
  const only = arg('--rungs', null);
  const attempts = Math.max(1, Math.min(10, Number(arg('--attempts', '3'))));
  const set = only ? new Set(only.split(',')) : null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'lab-runs', 'cf-ladder', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const t0 = Date.now();
  const records = [];
  let aborted = null;

  for (const rung of RUNGS.filter((r) => !set || set.has(r.id))) {
    for (let a = 1; a <= attempts; a++) {
      if (Date.now() - t0 > GLOBAL_TIMEOUT_MS) { aborted = 'teto global de 45min'; break; }
      process.stdout.write(`\n=== ${rung.id} a${a}/${attempts} — ${rung.label}\n`);
      const rec = await Promise.race([
        runAttempt(rung, outDir, a),
        wait(ATTEMPT_TIMEOUT_MS).then(() => ({ rung: rung.id, attempt: a, verdict: 'TIMEOUT' })),
      ]);
      records.push(rec);
      process.stdout.write(
        `    ${rec.verdict}` +
        ` | ext=${rec.extensionConfirmed === undefined ? '-' : rec.extensionConfirmed}` +
        ` | cf=${rec.cfClearance ?? '-'}` +
        ` | geo=${rec.geoClicked ?? '-'}` +
        ` | touch=${rec.state?.maxTouchPoints ?? '-'}` +
        `${rec.invalidReason ? ` | ${rec.invalidReason}` : ''}` +
        `${rec.error ? ` | ${rec.error}` : ''}\n`,
      );
      // Sem rerun automatico. Degrau invalido fica invalido e voce decide.
    }
    if (aborted) break;
  }

  fs.writeFileSync(path.join(outDir, 'ladder.json'), JSON.stringify({ target: TARGET, attempts, aborted, records }, null, 2));

  process.stdout.write('\n=== RESUMO — tempo ate liberar (o numero que importa) ===\n');
  process.stdout.write('degrau\tn\tmedMs\tmin\tmax\tciclos(med)\trounds(med)\tnuncaPassou\tINVALID\tlabel\n');
  const med = (xs) => {
    const a = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q);
    return a.length ? a[Math.floor(a.length / 2)] : null;
  };
  const byRung = new Map();
  for (const r of records) {
    if (!byRung.has(r.rung)) byRung.set(r.rung, []);
    byRung.get(r.rung).push(r);
  }
  for (const [id, rs] of byRung) {
    const valid = rs.filter((r) => r.verdict !== 'INVALID' && r.challengeAppeared);
    const times = valid.map((r) => r.msToPass);
    const nums = times.filter((x) => typeof x === 'number');
    process.stdout.write(
      [
        id,
        valid.length,
        med(times) ?? '-',
        nums.length ? Math.min(...nums) : '-',
        nums.length ? Math.max(...nums) : '-',
        med(valid.map((r) => r.interstitialCycles)) ?? '-',
        med(valid.map((r) => r.chlRounds)) ?? '-',
        valid.filter((r) => r.neverPassed).length,
        rs.filter((r) => r.verdict === 'INVALID').length,
        rs[0].label,
      ].join('\t') + '\n',
    );
  }
  process.stdout.write('\nLeitura: a camada culpada e o degrau onde medMs (e ciclos) pula.\n');
  if (aborted) process.stdout.write(`\nABORTADO: ${aborted}\n`);
  process.stdout.write(`\nartefato: ${path.join(outDir, 'ladder.json')}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
