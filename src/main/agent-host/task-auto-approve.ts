/**
 * SDK quirk workaround: @mastra/code-sdk's permissions module declares the
 * agent's task-list tools (task_write/task_update/task_complete/task_check)
 * in ALWAYS_ALLOW_TOOLS — its getToolCategory returns null for them and its
 * own resolveApproval maps null category to "allow". But the session's real
 * approval gate is @mastra/core's resolveToolApproval, which only consults
 * the injected category resolver on the category branch: a null category
 * skips that branch entirely and falls through to the default "ask". So the
 * SDK's intended always-allow never happens, and every task-list update
 * surfaces as an approval prompt in the UI (the CLI's other null-category
 * tools — ask_user, submit_plan — dodge this via the suspension path).
 *
 * We can't patch node_modules (packaging re-stages the runtime from npm), so
 * the agent host auto-approves instead: when a tool_approval_required event
 * arrives for a task tool, respond with 'approve' in-process and skip
 * forwarding the event to the UI. This is timing-safe because the core gate
 * arms the approval promise before emitting the event. An explicit per-tool
 * policy set by the user (including 'ask') is respected and still prompts.
 */

/** Tools the SDK intends to run without approval but whose gate says "ask". */
export const AUTO_APPROVE_TOOLS: ReadonlySet<string> = new Set([
  'task_write',
  'task_update',
  'task_complete',
  'task_check'
])

/**
 * Auto-approve only when the tool is a task tool and the user has no explicit
 * per-tool policy for it (an explicit 'ask' must keep prompting; explicit
 * 'allow'/'deny' are resolved by the gate and never reach the event).
 */
export function shouldAutoApprove(
  toolName: string,
  explicitToolPolicy: string | undefined
): boolean {
  return AUTO_APPROVE_TOOLS.has(toolName) && explicitToolPolicy === undefined
}
