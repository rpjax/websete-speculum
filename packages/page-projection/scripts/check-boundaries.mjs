/**
 * Enforce package dependency direction + sidecar session must not import lab/:
 *   core → (nothing under virtual/projected/lab)
 *   virtual → core only
 *   projected → core only
 *   package never imports lab/
 *   sidecar session/ (non-unit) never imports lab/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const sidecarSession = path.resolve(root, '../../sidecar/browser/mirror/projection/session');

const violations = [];

function walk(dir, onFile) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, onFile);
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) onFile(p);
  }
}

function checkPackageFile(file) {
  const rel = path.relative(src, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of imports) {
    if (spec.includes('/lab/') || spec.endsWith('/lab') || spec.includes('mirror/projection/lab')) {
      violations.push(`${rel} imports lab: ${spec}`);
    }
    if (rel.startsWith('core/') && (spec.includes('/virtual/') || spec.includes('/projected/'))) {
      violations.push(`${rel} (core) imports sibling realm: ${spec}`);
    }
    if (rel.startsWith('virtual/') && (spec.includes('/projected/') || spec.includes('../projected'))) {
      violations.push(`${rel} (virtual) must not import projected: ${spec}`);
    }
    if (rel.startsWith('projected/') && (spec.includes('/virtual/') || spec.includes('../virtual'))) {
      violations.push(`${rel} (projected) must not import virtual: ${spec}`);
    }
  }
}

function checkSessionFile(file) {
  const base = path.basename(file);
  if (base.endsWith('.unit.ts')) return;
  const rel = path.relative(sidecarSession, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of imports) {
    if (spec.includes('../lab/') || spec.includes('/lab/') || spec.includes("lab/probes")) {
      violations.push(`session/${rel} imports lab: ${spec}`);
    }
  }
}

walk(src, checkPackageFile);
walk(sidecarSession, checkSessionFile);

if (violations.length) {
  console.error('page-projection boundary violations:');
  for (const v of violations) console.error(' -', v);
  process.exit(1);
}
console.log('page-projection boundaries OK');
