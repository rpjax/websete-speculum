import {
  encodeControlFromIntent,
  encodeInputPointer,
  GECKO_INPUT_DOWN,
} from '../../../packages/page-projection/src/core/input/geckoControlInput.ts';
import type { PointerIntent } from '../../../packages/page-projection/src/core/input/unifiedIntentTypes.ts';
import { UNIFIED_INTENT_SCHEMA_VERSION } from '../../../packages/page-projection/src/core/input/unifiedIntentTypes.ts';

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

const want =
  '08 01 0b 00 00 00 01 00 00 00 01 05 00 00 00 00 80 00 80 00';
const got = hex(encodeInputPointer(11, 1, GECKO_INPUT_DOWN, 5, 32768, 32768, 0));
if (got !== want) {
  console.error(`FALHOU encoder Input\n  esperado: ${want}\n  recebido: ${got}`);
  process.exit(1);
}

const intent: PointerIntent = {
  schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
  type: 'down',
  viewportW: 800,
  viewportH: 600,
  x: 0,
  y: 0,
  contextId: 1,
  nodeId: 5,
  localX: 0.5,
  localY: 0.5,
  button: 'left',
};
const viaIntent = encodeControlFromIntent(11, 1, intent);
if (!viaIntent || hex(viaIntent) !== want) {
  console.error(
    `FALHOU encodeControlFromIntent\n  esperado: ${want}\n  recebido: ${viaIntent ? hex(viaIntent) : 'null'}`,
  );
  process.exit(1);
}
console.log('ok encoder Input down');
