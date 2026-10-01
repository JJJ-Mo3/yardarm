/**
 * Sign-in method derivation for a Factory checkout's .env.
 *
 * Mirrors the auth ladder in the scaffold's src/mastra/index.ts exactly:
 * (1) MASTRACODE_AUTH_DISABLED === '1' passes auth: null — no gate, but the
 * work board's organization-scoped APIs reject anonymous requests, so the
 * board can never load; (2) MASTRA_SHARED_API_URL defers identity to that
 * platform API; (3) WORKOS_API_KEY + WORKOS_CLIENT_ID enable self-managed
 * WorkOS sign-in; (4) otherwise the factory installs MastraAuthStudio —
 * identity-only Mastra platform sign-in (the server and its data stay
 * local). Pure and Electron-free so the checklist copy can be unit-tested.
 */

export type FactoryAuthPlan = 'disabled' | 'platform-deferred' | 'workos' | 'platform-default'

/** Which sign-in method the scaffold will pick for this .env (last-wins map). */
export function deriveAuthPlan(env: Record<string, string>): FactoryAuthPlan {
  if (env.MASTRACODE_AUTH_DISABLED === '1') return 'disabled'
  if (env.MASTRA_SHARED_API_URL?.trim()) return 'platform-deferred'
  if (env.WORKOS_API_KEY?.trim() && env.WORKOS_CLIENT_ID?.trim()) return 'workos'
  return 'platform-default'
}
