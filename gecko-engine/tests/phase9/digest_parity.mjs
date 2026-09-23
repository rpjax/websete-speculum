#!/usr/bin/env node
/**
 * Phase 9 — TS Digest parity vs digest_vectors.json (same FNV as rowHash.ts / PatchBuilder.hpp).
 * Requires SPECULUM_PAGE_PROJECTION (set by assert-digest-parity from SPECULUM_MONOREPO_ROOT).
 * No ../ path deduction.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK64 = 0xffffffffffffffffn;

function h64Bytes(bytes, seed = FNV_OFFSET) {
  let h = seed;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

function h64U32(value, seed = FNV_OFFSET) {
  let h = seed;
  for (let i = 0; i < 4; i++) {
    h ^= BigInt((value >>> (8 * i)) & 0xff);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

function digestBytes(bytes) {
  return h64Bytes(bytes);
}

function digestTable(tableHash, sequence) {
  let h = h64U32(sequence >>> 0);
  h ^= tableHash;
  h = (h * FNV_PRIME) & MASK64;
  return h;
}

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = process.env.SPECULUM_DIGEST_VECTORS ?? join(here, 'digest_vectors.json');
const vec = JSON.parse(readFileSync(vectorsPath, 'utf8'));

let fails = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    fails++;
  }
}

const pp = process.env.SPECULUM_PAGE_PROJECTION;
if (!pp) {
  console.error(
    'FAIL digest_parity: SPECULUM_PAGE_PROJECTION required (via assert-digest-parity / SPECULUM_MONOREPO_ROOT)',
  );
  process.exit(1);
}
check(existsSync(join(pp, 'src/core/digestBytes.ts')), `digestBytes.ts under ${pp}`);
if (existsSync(join(pp, 'src/core/digestBytes.ts'))) {
  const digestSrc = readFileSync(join(pp, 'src/core/digestBytes.ts'), 'utf8');
  check(digestSrc.includes('export function digestBytes'), 'package digestBytes.ts present');
  check(digestSrc.includes('export function digestTable'), 'package digestTable present');
}

for (const c of vec.digestBytes) {
  const got = digestBytes(Uint8Array.from(c.bytes)).toString();
  check(got === c.digest, `digestBytes ${c.name}: got ${got} want ${c.digest}`);
}
for (const c of vec.digestTable) {
  const got = digestTable(BigInt(c.tableHash), c.sequence).toString();
  check(got === c.digest, `digestTable seq=${c.sequence}: got ${got} want ${c.digest}`);
}

const suiteDir =
  process.env.SPECULUM_DIGEST_SUITE_DIR || join(here, 'suite_patches');
if (existsSync(suiteDir)) {
  for (const name of readdirSync(suiteDir)) {
    if (!name.endsWith('.bin')) continue;
    const bytes = new Uint8Array(readFileSync(join(suiteDir, name)));
    const wantPath = join(suiteDir, name.replace(/\.bin$/, '.digest.txt'));
    check(existsSync(wantPath), `suite missing digest for ${name}`);
    if (!existsSync(wantPath)) continue;
    const want = readFileSync(wantPath, 'utf8').trim();
    const got = digestBytes(bytes).toString();
    check(got === want, `suite ${name}: got ${got} want ${want}`);
  }
}

if (fails) {
  console.error(`digest_parity FAIL (${fails})`);
  process.exit(1);
}
console.log('digest_parity PASS');
