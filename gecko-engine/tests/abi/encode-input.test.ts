/** L1 encoder — requires SPECULUM_MONOREPO_ROOT (never parent-walk into packages/). */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const monorepo = process.env.SPECULUM_MONOREPO_ROOT;
if (!monorepo) {
  console.error('FAIL encode-input: SPECULUM_MONOREPO_ROOT required');
  process.exit(1);
}

const inputDir = join(monorepo, 'packages/page-projection/src/core/input');
const geckoMod = await import(pathToFileURL(join(inputDir, 'geckoControlInput.ts')).href);
const intentMod = await import(pathToFileURL(join(inputDir, 'unifiedIntentTypes.ts')).href);
const {
  encodeControlFromIntent,
  encodeInputKey,
  encodeInputPointer,
  GECKO_INPUT_DOWN,
  GECKO_INPUT_KEY_DOWN,
} = geckoMod;
const { UNIFIED_INTENT_SCHEMA_VERSION } = intentMod;

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

const intent = {
  schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
  type: 'down' as const,
  viewportW: 800,
  viewportH: 600,
  x: 0,
  y: 0,
  contextId: 1,
  nodeId: 5,
  localX: 0.5,
  localY: 0.5,
  button: 'left' as const,
};
const viaIntent = encodeControlFromIntent(11, 1, intent);
if (!viaIntent || hex(viaIntent) !== want) {
  console.error(
    `FALHOU encodeControlFromIntent\n  esperado: ${want}\n  recebido: ${viaIntent ? hex(viaIntent) : 'null'}`,
  );
  process.exit(1);
}
console.log('ok encoder Input down');

const keyWant = hex(encodeInputKey(11, 2, GECKO_INPUT_KEY_DOWN, 'x', 'KeyX', 0));
const keyIntent = {
  schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
  type: 'keyDown' as const,
  contextId: 2,
  key: 'x',
  code: 'KeyX',
};
const viaKey = encodeControlFromIntent(11, 1, keyIntent);
if (!viaKey || hex(viaKey) !== keyWant) {
  console.error(
    `FALHOU encodeControlFromIntent key nested\n  esperado: ${keyWant}\n  recebido: ${viaKey ? hex(viaKey) : 'null'}`,
  );
  process.exit(1);
}
console.log('ok encoder Input key nested ctx');
