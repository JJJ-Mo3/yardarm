/**
 * Feedback splitting for submit_plan rejection resumes.
 *
 * The SDK's designed rejection flow (what the mastracode CLI does) sends the
 * rejection resume with NO feedback — the tool result tells the model to stop
 * and wait — and delivers the user's revision notes as the next user message.
 * Stuffing feedback into the resume instead lets the run continue straight
 * into the SDK's PlanRejectionAbortProcessor, which aborts it before the
 * model can revise anything. So the session manager strips the feedback out
 * of the resume and delivers it via the prompt queue (which flushes once the
 * run ends), giving the model a fresh turn to revise and resubmit the plan.
 */

export interface PlanRejectionSplit {
  /** Resume payload to forward to the host (feedback removed when split). */
  resumeData: unknown
  /** Trimmed feedback to deliver as the next user message, if any. */
  feedback: string | null
}

/**
 * Split user feedback out of a submit_plan rejection resume. Everything else
 * (other tools, approvals, resumes without string feedback) passes through
 * untouched.
 */
export function splitPlanRejectionFeedback(
  toolName: string | undefined,
  resumeData: unknown
): PlanRejectionSplit {
  if (toolName !== 'submit_plan' || !resumeData || typeof resumeData !== 'object') {
    return { resumeData, feedback: null }
  }
  const data = resumeData as Record<string, unknown>
  if (data.action !== 'rejected' || typeof data.feedback !== 'string') {
    return { resumeData, feedback: null }
  }
  const feedback = data.feedback.trim()
  const rest = { ...data }
  delete rest.feedback
  return { resumeData: rest, feedback: feedback.length > 0 ? feedback : null }
}
