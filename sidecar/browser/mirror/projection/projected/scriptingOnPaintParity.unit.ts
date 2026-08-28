import assert from 'assert';
import { SCRIPTING_ON_PAINT_PARITY_CSS } from '@speculum/page-projection/projected/scriptingOnPaintParity';

export function runScriptingOnPaintParityUnitTests(): void {
  assert.match(SCRIPTING_ON_PAINT_PARITY_CSS, /noscript/);
  assert.match(SCRIPTING_ON_PAINT_PARITY_CSS, /display\s*:\s*none/i);
  console.log('[unit] scripting-on-paint-parity ok');
}
