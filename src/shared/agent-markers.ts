/**
 * The agent's reply text carries three kinds of machine-readable marker lines
 * (confidence rating, suggested knowledge note, follow-up suggestions) that the
 * transcript renders as chips and cards. Every other surface that shows reply
 * text — remote messages, sidebar snippets, exports — must drop them all.
 */
import { stripConfidenceLine } from './confidence'
import { stripFollowUpLines } from './follow-ups'
import { stripSuggestedKnowledgeLine } from './knowledge-notes'

export function stripAgentMarkers(text: string): string {
  return stripFollowUpLines(stripSuggestedKnowledgeLine(stripConfidenceLine(text)))
}
