// I7 / D-021 — Imago is standalone. Nothing may be imported from the surrounding
// repository, and nothing here may be imported by it. This check is what makes that
// enforced instead of remembered. Do not add exceptions; duplicate the code instead.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC = join(ROOT, 'src')
const BANNED = [
  /from\s+['"](\.\.\/){2,}/,               // climbing out of imago/
  /from\s+['"]@speculum\//,                 // the repo's packages
  /from\s+['"](patchright|playwright)['"]/, // D-023: playwright-core only
  /require\(\s*['"](\.\.\/){2,}/,
]

const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) files.push(p)
  }
})(SRC)

let bad = 0
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  text.split('\n').forEach((line, i) => {
    for (const re of BANNED) {
      if (re.test(line)) {
        console.error(`boundary violation ${relative(ROOT, f)}:${i + 1}\n  ${line.trim()}`)
        bad++
      }
    }
  })
}
if (bad) { console.error(`\n${bad} boundary violation(s). Imago is standalone (I7).`); process.exit(1) }
console.log(`boundaries ok — ${files.length} files`)
