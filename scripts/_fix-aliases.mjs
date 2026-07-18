// Rewrites `require("@/…")` in the parity build to real relative paths.
// tsc does not resolve tsconfig `paths` at emit time, so the compiled JS still
// carries the alias. Only used by scripts/parity-check.mjs.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, relative, dirname } from 'node:path'

const root = resolve('.parity-build')
let n = 0

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (!p.endsWith('.js')) continue
    const before = readFileSync(p, 'utf8')
    const after = before.replace(/require\("@\/([^"]+)"\)/g, (_m, sub) => {
      let rel = relative(dirname(p), join(root, sub)).split('\\').join('/')
      if (!rel.startsWith('.')) rel = './' + rel
      return `require("${rel}")`
    })
    if (after !== before) { writeFileSync(p, after); n++ }
  }
}

walk(root)
console.log(`rewrote aliases in ${n} file(s)`)
