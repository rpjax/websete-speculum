/**
 * Bump monotonic lab client build seq — runs before build:lab-client.
 */
const fs = require('node:fs');
const path = require('node:path');

const stampPath = path.join(
  __dirname,
  '..',
  'browser',
  'mirror',
  'projection',
  'lab',
  'static',
  'labBuildStamp.json',
);

let stamp = { seq: 0, builtAt: '' };
if (fs.existsSync(stampPath)) {
  try {
    stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
  } catch {
    /* reset below */
  }
}

stamp.seq = (Number(stamp.seq) || 0) + 1;
stamp.builtAt = new Date().toISOString();
fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`[lab-build-stamp] #${stamp.seq} ${stamp.builtAt}`);
