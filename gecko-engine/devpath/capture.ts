// Speculum devpath — consome ws://127.0.0.1:4100/session e grava frames opacos.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFramePart, PersistentStringTable } from '../../packages/page-projection/src/core/decode';

async function toBuffer(data: unknown): Promise<Buffer> {
  if (typeof data === 'string') {
    return Buffer.from(data);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  throw new Error('tipo de mensagem websocket desconhecido');
}

function connectRetry(wsUrl: string, budgetMs: number): Promise<WebSocket> {
  const deadline = Date.now() + budgetMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const ws = new WebSocket(wsUrl);
      const onOpen = () => {
        ws.removeEventListener('error', onError);
        resolve(ws);
      };
      const onError = () => {
        ws.removeEventListener('open', onOpen);
        ws.close();
        if (Date.now() >= deadline) {
          reject(new Error(`websocket falhou: ${wsUrl}`));
          return;
        }
        setTimeout(tryOnce, 100);
      };
      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });
    };
    tryOnce();
  });
}

async function main(): Promise<void> {
  const outDir = process.argv[2];
  const wsUrl = process.argv[3] ?? 'ws://127.0.0.1:4100/session';
  const timeoutSec = Number(process.argv[4] ?? 30);

  if (!outDir) {
    console.error('uso: capture.ts <diretorio-da-captura> [wsUrl] [segundos]');
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'logs'), { recursive: true });

  const ndjsonPath = join(outDir, 'frames.ndjson');
  const persistent = new PersistentStringTable();
  let ordem = 0;

  const ws = await connectRetry(wsUrl, 30_000);
  console.log(`consumidor conectado em ${wsUrl}`);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
    }, timeoutSec * 1000);

    ws.addEventListener('message', (ev) => {
      void (async () => {
        if (typeof ev.data === 'string') {
          return;
        }
        const buf = await toBuffer(ev.data);
        const bytes = new Uint8Array(buf);
        const decoded = decodeFramePart(bytes, persistent);
        if (!decoded.ok) {
          // Kind Telemetry/Asset travel the same WS as raw PP frames.
          return;
        }
        ordem++;
        const contextId = decoded.part.contextId;
        const sequence = decoded.part.sequence;
        const name = `f-${String(ordem).padStart(4, '0')}-ctx${contextId}-seq${sequence}.bin`;
        writeFileSync(join(outDir, name), bytes);
        appendFileSync(
          ndjsonPath,
          `${JSON.stringify({
            ordem,
            childPid: 0,
            contextId,
            sequence,
            bytes: bytes.length,
          })}\n`,
        );
      })().catch((err: unknown) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    ws.addEventListener('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  console.log(`${ordem} frame(s) gravados em ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
