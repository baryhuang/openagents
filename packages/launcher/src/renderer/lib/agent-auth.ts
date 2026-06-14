import type { CatalogEntry } from "../types"

/**
 * A "login-only" agent authenticates exclusively through its own CLI sign-in
 * (e.g. `cursor-agent login`, `hermes setup`) and exposes NO API-key fields —
 * getEnvFields returns [] for it. The setup wizard (enter key → test
 * connection → create instance) is meaningless for these: there's no key to
 * collect and nothing to test. Their sign-in lives in the Agents-page Configure
 * dialog (the CLI login flow), so the post-install wizard and the "Setup
 * wizard" button must be skipped for them.
 *
 * Dual-auth agents like Claude carry a login_command AND key fields
 * (ANTHROPIC_API_KEY etc.), so getEnvFields is non-empty — they are NOT
 * login-only and keep the wizard.
 *
 * Note: a catalog entry's own `env_config` can't be trusted here — Cursor's
 * registry entry still lists CURSOR_API_KEY even though the launcher hides it
 * (getEnvFields → []). Always pass the resolved getEnvFields result.
 */
export function isLoginOnlyAgent(
  entry: Pick<CatalogEntry, "check_ready">,
  envFields: { length: number } | null | undefined,
): boolean {
  return !!entry.check_ready?.login_command && (envFields?.length ?? 0) === 0
}
