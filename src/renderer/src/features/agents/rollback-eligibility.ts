/**
 * Pure eligibility scans for the per-message pills. Rollback: a user message
 * gets a pill iff rolling back to before it would actually revert something —
 * i.e. a change-capable tool call ran (or is running) in any later message.
 * Tool calls that errored, were declined at the approval gate, or never
 * executed don't count: they changed nothing. Fork: there must be prior
 * assistant history to fork.
 */
import type { StoredMessage } from '../../../../shared/ui-message'

/**
 * Tools known to never change project files. Any other tool (write/edit/
 * delete/mkdir/execute_command/subagent, MCP and plugin tools) is treated as
 * change-capable.
 */
const READONLY_TOOLS = new Set([
  'view',
  'find_files',
  'file_stat',
  'search_content',
  'lsp_inspect',
  'get_process_output',
  'kill_process',
  'web_search',
  'web-search',
  'web_extract',
  'web-extract',
  'notification_inbox',
  'ask_user',
  'submit_plan',
  'request_access',
  'task_write',
  'task_update',
  'task_complete',
  'task_check'
])

/**
 * Ids of user messages whose fork pill should render: forking splits the
 * conversation just before the message, so it needs a real (non-info)
 * assistant message somewhere earlier to anchor the cloned thread's cut.
 */
export function computeForkEligible(messages: StoredMessage[]): Set<string> {
  const eligible = new Set<string>()
  let anyAssistantBefore = false
  for (const m of messages) {
    if (m.role === 'user') {
      if (anyAssistantBefore) eligible.add(m.id)
    } else if (m.role === 'assistant' && m.parts.some((p) => p.type !== 'info')) {
      anyAssistantBefore = true
    }
  }
  return eligible
}

/** Ids of user messages whose rollback pill should render. */
export function computeRollbackEligible(messages: StoredMessage[]): Set<string> {
  const eligible = new Set<string>()
  let anyChangeAfter = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') {
      if (anyChangeAfter) eligible.add(m.id)
    } else if (!anyChangeAfter) {
      anyChangeAfter = m.parts.some(
        (p) =>
          p.type === 'tool-call' &&
          !READONLY_TOOLS.has(p.toolName) &&
          (p.status === 'success' || p.status === 'running')
      )
    }
  }
  return eligible
}
