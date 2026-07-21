/**
 * SDK quirk workaround: @mastra/code-sdk's permissions module declares its
 * interactive/planning tools (ask_user, task_write, task_update,
 * task_complete, task_check, submit_plan, request_access) in
 * ALWAYS_ALLOW_TOOLS — its getToolCategory returns null for them and its own
 * resolveApproval maps null category to "allow". But the session's real
 * approval gate is @mastra/core's resolveToolApproval, which only consults
 * the injected category resolver on the category branch: a null category
 * skips that branch entirely and falls through to the default "ask". So the
 * SDK's intended always-allow never happens, and these tools surface as
 * approval prompts in the UI (most visibly every task-list update).
 *
 * Auto-approving the interactive tools is safe because approval and
 * suspension are separate consent surfaces: the real user decision happens at
 * the suspension card (ask_user's question, submit_plan's plan review,
 * request_access's sandbox grant), which still appears. The SDK's own
 * headless autoApprovePolicy handles them the same way — approve the tool
 * call, answer at the suspension.
 *
 * We can't patch node_modules (packaging re-stages the runtime from npm), so
 * the agent host auto-approves instead: when a tool_approval_required event
 * arrives for one of these tools, respond with 'approve' in-process and skip
 * forwarding the event to the UI. This is timing-safe because the core gate
 * arms the approval promise before emitting the event. An explicit per-tool
 * policy set by the user (including 'ask') is respected and still prompts.
 */

/**
 * The SDK's ALWAYS_ALLOW_TOOLS: tools it intends to run without approval but
 * whose gate says "ask".
 */
export const AUTO_APPROVE_TOOLS: ReadonlySet<string> = new Set([
  'ask_user',
  'task_write',
  'task_update',
  'task_complete',
  'task_check',
  'submit_plan',
  'request_access'
])

/**
 * Auto-approve only when the tool is always-allowed by SDK intent and the
 * user has no explicit per-tool policy for it (an explicit 'ask' must keep
 * prompting; explicit 'allow'/'deny' are resolved by the gate and never reach
 * the event).
 */
export function shouldAutoApprove(
  toolName: string,
  explicitToolPolicy: string | undefined
): boolean {
  return AUTO_APPROVE_TOOLS.has(toolName) && explicitToolPolicy === undefined
}
