import {
  encodeInputPointer,
  GECKO_INPUT_DOWN,
} from '../../../packages/page-projection/src/core/input/geckoControlInput.ts';

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
console.log('ok encoder Input down');
