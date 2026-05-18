/**
 * Windows env-casing helpers.
 *
 * Windows' env block uses the canonical key `Path` (mixed case) — some
 * libraries also set `PATH`. When code does `process.env.PATH = ...` on a
 * Windows process whose env only carries `Path`, it creates a SECOND key,
 * and a subsequent `{ ...process.env, PATH: 'newval' }` spread to spawn()
 * leaks BOTH `Path` (old) and `PATH` (new) into the child env block.
 *
 * CreateProcess looks up env vars case-insensitively but the resulting
 * lookup order across duplicate keys is undefined — so children sometimes
 * see the new PATH, sometimes the old. In our case that caused npm's
 * postinstall (cmd.exe /d /s /c node install.cjs) to fail with
 * "'node' is not recognized" even though our parent prepended the bundled
 * runtime dir.
 *
 * These helpers update the canonical key in place and produce spawn envs
 * with exactly one PATH-ish entry.
 */

export function readPathEnv(): string {
  for (const k of Object.keys(process.env)) {
    if (k.toLowerCase() === 'path') return process.env[k] || ''
  }
  return ''
}

export function writePathEnv(value: string): void {
  let touched = false
  for (const k of Object.keys(process.env)) {
    if (k.toLowerCase() === 'path') {
      process.env[k] = value
      touched = true
    }
  }
  if (!touched) {
    process.env[process.platform === 'win32' ? 'Path' : 'PATH'] = value
  }
}

/**
 * Build a child-process env that contains exactly one PATH-ish key, set to
 * `value`. Safer than `{ ...process.env, PATH: value }` on Windows.
 */
export function withPathEnv(value: string, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const src = base ?? process.env
  const out: NodeJS.ProcessEnv = {}
  for (const k of Object.keys(src)) {
    if (k.toLowerCase() === 'path') continue
    out[k] = src[k]
  }
  out[process.platform === 'win32' ? 'Path' : 'PATH'] = value
  return out
}
