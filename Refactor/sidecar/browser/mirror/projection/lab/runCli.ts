/**
 * Agent port: one-shot lab run. Writes lab-runs/<ts>-<slug>/report.json and exits 0/1 from verdicts.
 *
 *   npm run lab:run -- fixtures/demo.html 15s --cpu --iso
 *   npm run lab:run -- --url fixtures/demo.html --duration 15s --cpu --iso
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { labAssetRoots } from './assetRoots';
import { createRunCollectors, executeLabRun } from './runTools';
import { NodeTableApplier } from './nodeTableApply';
import { reportExitCode } from './runReport';
import { LAB_TELEMETRY_DEFAULTS, DEFAULT_TELEMETRY_CONFIG, type ProjectionTelemetryMessage } from '../models/telemetry';
import { createV4ProjectionBrowserSessionFactory } from '../session/V4ProjectionBrowserSession';
import { v4LabLaunchOptions } from '../session/v4LabLaunch';
import type { BrowserSessionEvents } from '../../../BrowserSession';

type Args = {
  url: string;
  durationMs: number;
  cpu: boolean;
  iso: boolean;
  invariants: boolean;
  structuralDiff: boolean;
  telemetryLab: boolean;
  outDir: string;
  headed: boolean;
  labUrl: string | null;
};

function parseDuration(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(raw.trim());
  if (!m) return Number(raw);
  const n = Number(m[1]);
  const unit = m[2] ?? 'ms';
  if (unit === 's') return Math.round(n * 1000);
  if (unit === 'm') return Math.round(n * 60_000);
  return Math.round(n);
}

function isDurationToken(raw: string): boolean {
  return /^\d+(?:\.\d+)?(ms|s|m)?$/i.test(raw.trim());
}

const POSITIONAL_SWITCHES = new Set([
  'iso',
  'cpu',
  'headed',
  'no-invariants',
  'structural-diff',
]);

function applySwitch(args: Args, token: string): void {
  switch (token) {
    case 'cpu':
    case '--cpu':
      args.cpu = true;
      return;
    case 'iso':
    case '--iso':
      args.iso = true;
      return;
    case 'headed':
    case '--headed':
      args.headed = true;
      return;
    case 'no-invariants':
    case '--no-invariants':
      args.invariants = false;
      return;
    case 'structural-diff':
    case '--structural-diff':
      args.structuralDiff = true;
      return;
    default:
      return;
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: 'fixtures/demo.html',
    durationMs: 15_000,
    cpu: false,
    iso: false,
    invariants: true,
    structuralDiff: false,
    telemetryLab: true,
    outDir: path.join(process.cwd(), 'lab-runs'),
    headed: false,
    labUrl: null,
  };
  if (process.env.SPECULUM_LAB_CPU === '1') args.cpu = true;
  if (process.env.SPECULUM_LAB_ISO === '1') args.iso = true;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    if (a === '--help' || a === '-h') {
      console.log(
        'lab:run [url] [duration] [iso] [cpu] [--url] [--duration] [--cpu] [--iso] [--no-invariants] [--structural-diff] [--telemetry off] [--headed] [--out dir]',
      );
      process.exit(0);
    }
    if (a === '--url' && next) {
      args.url = next;
      i += 1;
    } else if (a === '--duration' && next) {
      args.durationMs = parseDuration(next);
      i += 1;
    } else if (a === '--telemetry' && next) {
      args.telemetryLab = next !== 'off';
      i += 1;
    } else if (a === '--out' && next) {
      args.outDir = next;
      i += 1;
    } else if (a === '--lab-url' && next) {
      args.labUrl = next;
      i += 1;
    } else if (a.startsWith('--')) {
      applySwitch(args, a);
    } else if (!a.startsWith('-')) {
      positionals.push(a);
    }
  }
  // npm on Windows often drops dashed flags; positionals (`url`, `8s`, `iso`, `cpu`) survive.
  let p = 0;
  if (positionals[p] && !POSITIONAL_SWITCHES.has(positionals[p]!)) {
    args.url = positionals[p]!;
    p += 1;
  }
  if (positionals[p] && isDurationToken(positionals[p]!)) {
    args.durationMs = parseDuration(positionals[p]!);
    p += 1;
  }
  for (; p < positionals.length; p++) applySwitch(args, positionals[p]!);
  return args;
}

function stubEvents(
  onFrame: (body: Uint8Array) => void,
  onTel: (m: ProjectionTelemetryMessage) => void,
): BrowserSessionEvents {
  return {
    onVideoFrame: () => undefined,
    onAudioFrame: () => undefined,
    onPageProjectionDiff: (diff) => onFrame(diff.body),
    onPageProjectionTelemetry: (m) => onTel(m),
    onConsole: () => undefined,
    onLocationChanged: () => undefined,
    onMainFrameNavigationBlocked: () => undefined,
    onEditableFocusChanged: () => undefined,
    onCameraPermissionRequested: async () => 'deny',
    onMicrophonePermissionRequested: async () => 'deny',
    onCrash: () => undefined,
  };
}

async function startFixtureHttp(): Promise<{ origin: string; close: () => Promise<void> }> {
  const { fixturesDir } = labAssetRoots();
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/fixtures/')) {
      const pathname = url.split('?')[0] ?? url;
      const file = path.join(fixturesDir, decodeURIComponent(pathname.slice('/fixtures/'.length)));
      if (!file.startsWith(path.normalize(fixturesDir)) || !fs.existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('fixture http: no port');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function resolveUrl(raw: string, origin: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const name = raw.replace(/^fixtures\//, '').replace(/^\//, '');
  return `${origin}/fixtures/${name}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.env.SPECULUM_LAB_HEADED = args.headed ? '1' : '';

  let origin = args.labUrl;
  let closeHttp: (() => Promise<void>) | null = null;
  if (!origin) {
    const httpServer = await startFixtureHttp();
    origin = httpServer.origin;
    closeHttp = httpServer.close;
  }

  const target = resolveUrl(args.url, origin.replace(/\/$/, ''));
  const collectors = createRunCollectors();
  const nodeTable = new NodeTableApplier();
  const onFrame = (buf: Uint8Array): void => {
    collectors.observeFrameBytes(buf);
    nodeTable.observeFrameBytes(buf);
  };
  const factory = createV4ProjectionBrowserSessionFactory({ headless: !args.headed });
  const session = factory.create('lab-run', stubEvents(onFrame, collectors.observeTelemetry));

  try {
    await session.launch(
      v4LabLaunchOptions({
        frameRateHz: 60,
        projectionTelemetry: args.telemetryLab ? { ...LAB_TELEMETRY_DEFAULTS } : { ...DEFAULT_TELEMETRY_CONFIG },
        cpuProfiling: args.cpu,
      }),
    );
    await session.navigate(target);
    const result = await executeLabRun(
      {
        session,
        observeFrameBytes: onFrame,
        observeTelemetry: collectors.observeTelemetry,
        requestClientSnapshot: () => nodeTable.snapshot(),
      },
      {
        url: target,
        durationMs: args.durationMs,
        frameRateHz: 60,
        telemetry: args.telemetryLab ? { ...LAB_TELEMETRY_DEFAULTS } : { ...DEFAULT_TELEMETRY_CONFIG },
        cpuProfile: args.cpu,
        invariants: args.invariants,
        structuralDiff: args.structuralDiff,
        isomorphism: args.iso,
        outDir: args.outDir,
      },
      collectors,
    );
    // writeRunReport uses defaultLabRunsDir(); copy note if --out differs is skipped — honor --out
    if (path.resolve(args.outDir) !== path.resolve(process.cwd(), 'lab-runs')) {
      // already written under cwd/lab-runs; print that path
    }
    console.log(result.written.reportPath);
    process.exitCode = reportExitCode(result.report);
  } finally {
    await session.dispose();
    await closeHttp?.();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
