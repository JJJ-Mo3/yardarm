/**
 * Self-verification loop: opt-in system-prompt guidance asking
 * the agent to verify its work with the project's own checks before declaring
 * a task done. Pure and shared — the agent host injects/removes the guidance
 * via the pluginInstructions state; the session manager resolves the
 * effective per-chat value (subchat override falling back to the global
 * app_settings default).
 */

/**
 * Build the verification guidance injected into pluginInstructions. Kept as a
 * builder (not a const) because the browser sentence is only included when
 * browser tools are configured. Both variants are stable strings so the
 * host's includes-guards stay simple and prompts stay prefix-cache friendly.
 */
export function buildVerificationGuidance(options: { browser: boolean }): string {
  const base =
    'Before declaring a task complete, verify your work: discover the project\u2019s own ' +
    'checks (package.json scripts, Makefile targets, CI config) and run the relevant ones ' +
    '(typecheck, lint, tests, build). Run each check as a separate command rather than one ' +
    'long chained command. If a check fails, fix the problem and re-run it \u2014 but after ' +
    'about 2 fix attempts for the same failure, stop and report the remaining failures ' +
    'honestly instead of continuing to iterate. Never claim a task is complete while ' +
    'relevant checks are failing, and never weaken or skip a check just to make it pass.'
  const browser =
    ' For user-facing web changes, also do a quick smoke test with the browser tools ' +
    '(load the page, confirm the change works).'
  return options.browser ? base + browser : base
}

/**
 * Effective verify-work value for a session: the per-subchat override wins
 * when set; otherwise the global default applies (absent/undefined = off —
 * this feature is opt-in).
 */
export function resolveVerifyWork(
  subchatValue: boolean | null | undefined,
  globalValue: unknown
): boolean {
  if (typeof subchatValue === 'boolean') return subchatValue
  return globalValue === true
}
