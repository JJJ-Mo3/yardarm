/**
 * Shared marker for the agent host's stall-watchdog abort message, so the
 * session manager can recognize a stall error and auto-continue the run
 * (one retry per user prompt) instead of leaving it waiting for a new user
 * message. The host embeds the marker verbatim in the error it posts;
 * changing the phrase requires changing both sides, which is why it lives
 * here as a constant.
 */
export const STALL_ERROR_MARKER = 'the run looks stalled and was stopped'

/** Whether an agent error message came from the host's stall watchdog. */
export function isStallError(text: string): boolean {
  return text.includes(STALL_ERROR_MARKER)
}
