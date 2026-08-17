/**
 * Dev-only projection lab — HTTP + WS, no gRPC / .NET.
 */

import { createLabServer, type LabServerOptions } from './server';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<void> {
  const opts: LabServerOptions = {
    host: process.env.SPECULUM_LAB_HOST ?? '127.0.0.1',
    port: envInt('SPECULUM_LAB_PORT', 4077),
    headless: process.env.SPECULUM_LAB_HEADED !== '1',
  };

  const lab = await createLabServer(opts);
  const base = `http://${opts.host}:${opts.port}`;

  console.log(`[projection-lab] listening ${base}`);
  console.log(`[projection-lab] open ${base}/  (client shell)`);
  console.log(`[projection-lab] fixtures ${base}/fixtures/demo.html`);
  console.log(`[projection-lab] headed=${!opts.headless} (SPECULUM_LAB_HEADED=1 for visible Chrome)`);

  const shutdown = async () => {
    console.log('[projection-lab] shutting down…');
    await lab.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[projection-lab] fatal', err);
  process.exit(1);
});
