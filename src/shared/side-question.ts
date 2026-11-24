/**
 * Side questions (`/btw`): quick questions about the CURRENT chat answered in
 * a hidden per-chat helper conversation, so nothing is added to the chat's own
 * thread. Pure builders for the compact digest of the chat's recent messages
 * that seeds each question, the read-only prompt, and the transcript marker.
 */
import { stripAgentMarkers } from './agent-markers'

export const SIDE_CHAT_TITLE = 'Side questions'
export const SIDE_QUESTION_MAX = 8000

/** Total characters of chat digest included with one question. */
export const DIGEST_MAX_CHARS = 12_000
/** Newest messages considered for the digest. */
export const DIGEST_MAX_MESSAGES = 40
/** Characters kept from any single message. */
export const DIGEST_MESSAGE_MAX_CHARS = 1500

const MARKER_MAX = 80

interface DigestMessage {
  role: string
  parts: unknown
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text
}

/** User/assistant text of one message (no tools, reasoning or info lines). */
function messageText(message: DigestMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return ''
  if (!Array.isArray(message.parts)) return ''
  const texts: string[] = []
  for (const part of message.parts) {
    if (!part || typeof part !== 'object') continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type !== 'text' || typeof p.text !== 'string') continue
    const text = (message.role === 'assistant' ? stripAgentMarkers(p.text) : p.text).trim()
    if (text) texts.push(text)
  }
  return texts.join('\n')
}

/**
 * Compact, size-capped digest of a chat's recent conversation: user and
 * assistant text only, agent marker lines stripped, newest messages favored
 * (older ones are dropped first when the budget runs out), returned in
 * chronological order as `User:` / `Assistant:` blocks. '' when the chat has
 * no text yet.
 */
export function buildChatDigest(
  messages: DigestMessage[],
  opts: { maxChars?: number; maxMessages?: number; perMessageMax?: number } = {}
): string {
  const maxChars = opts.maxChars ?? DIGEST_MAX_CHARS
  const maxMessages = opts.maxMessages ?? DIGEST_MAX_MESSAGES
  const perMessageMax = opts.perMessageMax ?? DIGEST_MESSAGE_MAX_CHARS
  const blocks: string[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0 && blocks.length < maxMessages; i--) {
    const text = messageText(messages[i])
    if (!text) continue
    const label = messages[i].role === 'user' ? 'User' : 'Assistant'
    const remaining = maxChars - used
    // Leave room for at least a meaningful excerpt, or stop.
    if (remaining < label.length + 40) break
    const block = `${label}: ${clip(text, Math.min(perMessageMax, remaining - label.length - 2))}`
    blocks.push(block)
    used += block.length + 2
  }
  return blocks.reverse().join('\n\n')
}

/** Transcript marker line for a side question, e.g. `Side question: why X?`. */
export function buildSideQuestionMarker(question: string): string {
  const q = question.trim().replace(/\s+/g, ' ')
  return `Side question: ${clip(q, MARKER_MAX)}`
}

/**
 * Prompt for one side question: read-only rules, the digest of the main
 * chat's recent conversation (re-sent with every question so follow-ups see
 * its latest state), and the question itself.
 */
export function buildSideQuestionPrompt(question: string, digest: string): string {
  const context = digest
    ? `Recent conversation in the main chat (oldest first; long messages are cut short, tool activity is omitted):

<main-chat>
${digest.replace(/<\/main-chat>/gi, '</main-chat >')}
</main-chat>`
    : 'The main chat has no messages yet.'
  return `You are answering a quick side question about another conversation (the "main chat") that is going on in this same working directory. The user asked it on the side so the main chat is not interrupted.

This is strictly read-only:
- Do not create, modify, or delete any files, and do not run commands that change state (no installs, no builds that write artifacts, no git commands that mutate the repo). The main chat's agent may be editing these files right now.
- Reading files and searching the code is fine when the question needs it, but keep it brief — prefer answering from the conversation below.
- Do not continue or take over the main chat's task, and do not submit a plan. Just answer the question.

${context}

Side question: ${question.trim()}

Answer directly and concisely as your reply in this conversation. If the conversation above does not contain enough to answer, say what is missing.
`
}
