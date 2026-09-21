import { geckoViewportResizeMessage } from './geckoLabWire';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function runGeckoViewportResizeUnitTests(): void {
  const raw = geckoViewportResizeMessage(1440, 900);
  const msg = JSON.parse(raw) as { type: string; width: number; height: number };
  assert(msg.type === 'client.resize', 'gecko resize uses designed JSON hop, not client.control ABI');
  assert(msg.width === 1440 && msg.height === 900, 'width/height travel on client.resize');
  console.log('[unit] geckoViewportResize ok');
}
