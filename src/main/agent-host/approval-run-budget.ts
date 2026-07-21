/**
 * SDK quirk workaround: the Session's tool-approval path (approveToolCall /
 * declineToolCall) calls `agent.sendToolApproval` without the shared run
 * budget that every other run path carries (`buildSharedRunOptions()` —
 * maxSteps 1000, savePerStep, provider fallbacks). Without `maxSteps` the
 * resumed stream falls back to the loop default of `stepCountIs(5)`, so the
 * agent silently stops ~5 steps after every approval with a plain
 * `agent_end reason: 'complete'` — no error, mid-task. The SDK's own docs
 * flag the hazard ("a missing maxSteps on resume silently caps the resumed
 * run at the agent's small default and ends it mid-task") but the fix never
 * reached the approve/decline path.
 *
 * We can't patch node_modules (packaging re-stages the runtime from npm), so
 * this re-supplies the budget at runtime: wrap `machinery.getAgent` — the
 * agent is re-resolved per call and can be rebuilt on mode/model switches —
 * and patch each returned agent's `sendToolApproval` to spread the shared
 * options in first, letting the caller's explicit options win. The injected
 * keys don't collide with `sendToolApproval`'s destructured parameters and
 * flow through its options merge into the resumed stream.
 */

interface MachineryLike {
  getAgent: () => object
  buildSharedRunOptions: () => Record<string, unknown>
}

interface PatchableAgent {
  sendToolApproval?: (options: Record<string, unknown>) => Promise<unknown>
}

export function patchApprovalRunBudget(session: { machinery: MachineryLike }): void {
  const machinery = session.machinery
  const patched = new WeakSet<object>()
  const origGetAgent = machinery.getAgent
  machinery.getAgent = () => {
    const agent = origGetAgent()
    const a = agent as PatchableAgent
    if (typeof a.sendToolApproval === 'function' && !patched.has(agent)) {
      const orig = a.sendToolApproval.bind(agent)
      a.sendToolApproval = (options) => orig({ ...machinery.buildSharedRunOptions(), ...options })
      patched.add(agent)
    }
    return agent
  }
}
