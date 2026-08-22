/** FNV-1a 32-bit — cheap mix after the string already exists. Not a substitute for reading `cssText`. */

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

export function fnv1a32(text: string): number {
  let h = OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, PRIME) >>> 0;
  }
  return h >>> 0;
}
