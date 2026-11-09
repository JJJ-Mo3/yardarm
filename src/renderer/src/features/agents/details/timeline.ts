/**
 * Pure derivation of the session timeline shown in the details panel:
 * chronological events (user prompts, marked runs, shell commands, file
 * changes, subagent runs, model switches, checkpoints) extracted from the
 * stored transcript. Reads/searches are deliberately omitted as noise.
 * All arg reads are string-guarded so clamp-truncated tool args degrade
 * to a path-less generic row instead of breaking the timeline.
 */
import type { StoredMessage } from '../../../../../shared/ui-message'

export type FileAction = 'edit' | 'write' | 'delete' | 'mkdir'

export type TimelineEventKind =
  'prompt' | 'marker' | 'command' | 'file' | 'subagent' | 'model' | 'checkpoint'

export interface TimelineEvent {
  id: string
  ts: number
  kind: TimelineEventKind
  label: string
  /** Worktree-relative path (file events with intact args; enables click-to-open). */
  path?: string
  action?: FileAction
  failed?: boolean
  /** Number of consecutive same-file operations collapsed into this row. */
  count?: number
}

/** Structural subset of the checkpoints router's CheckpointEntry. */
export interface TimelineCheckpoint {
  id: string
  name: string | null
  source: 'auto' | 'manual'
  createdAt: number
}

const FILE_TOOLS: Record<string, FileAction> = {
  string_replace_lsp: 'edit',
  ast_smart_edit: 'edit',
  write_file: 'write',
  delete_file: 'delete',
  mkdir: 'mkdir'
}

const GENERIC_FILE_LABELS: Record<FileAction, string> = {
  edit: 'Edited a file',
  write: 'Wrote a file',
  delete: 'Deleted a file',
  mkdir: 'Created a folder'
}

function str(args: unknown, key: string): string | null {
  if (args === null || typeof args !== 'object') return null
  const v = (args as Record<string, unknown>)[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

function firstLine(text: string): string {
  const idx = text.indexOf('\n')
  return idx >= 0 ? `${text.slice(0, idx)} …` : text
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** Chronological timeline events for one subchat's stored transcript. */
export function buildTimeline(
  messages: StoredMessage[],
  checkpoints?: TimelineCheckpoint[]
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let lastModelId: string | undefined

  const push = (event: TimelineEvent): void => {
    // Collapse consecutive operations on the same file into one row.
    const prev = events[events.length - 1]
    if (
      event.kind === 'file' &&
      prev?.kind === 'file' &&
      prev.action === event.action &&
      prev.path !== undefined &&
      prev.path === event.path
    ) {
      prev.count = (prev.count ?? 1) + 1
      return
    }
    events.push(event)
  }

  for (const message of messages) {
    if (message.role === 'user') {
      message.parts.forEach((part, i) => {
        if (part.type !== 'text' || !part.text.trim()) return
        push({
          id: `${message.id}:${i}`,
          ts: message.createdAt,
          kind: part.marker ? 'marker' : 'prompt',
          label: truncate(firstLine(part.text.trim()), 120)
        })
      })
      continue
    }
    if (message.modelId && message.modelId !== lastModelId) {
      push({
        id: `${message.id}:model`,
        ts: message.createdAt,
        kind: 'model',
        label: message.modelId
      })
      lastModelId = message.modelId
    }
    message.parts.forEach((part, i) => {
      if (part.type !== 'tool-call') return
      const id = `${message.id}:${i}`
      const ts = message.createdAt
      const failed = part.status === 'error'
      if (part.toolName === 'execute_command') {
        const command = str(part.args, 'command')
        push({
          id,
          ts,
          kind: 'command',
          label: command !== null ? `$ ${truncate(firstLine(command), 100)}` : 'Ran a command',
          failed
        })
        return
      }
      const action = FILE_TOOLS[part.toolName]
      if (action) {
        const path = str(part.args, 'path') ?? str(part.args, 'file_path') ?? undefined
        push({
          id,
          ts,
          kind: 'file',
          label: path ?? GENERIC_FILE_LABELS[action],
          path,
          action,
          failed
        })
        return
      }
      if (part.toolName === 'subagent') {
        const desc = str(part.args, 'description') ?? str(part.args, 'task')
        push({
          id,
          ts,
          kind: 'subagent',
          label: desc !== null ? `Subagent: ${truncate(firstLine(desc), 80)}` : 'Subagent run',
          failed
        })
      }
    })
  }

  for (const ck of checkpoints ?? []) {
    events.push({
      id: `ck:${ck.id}`,
      ts: ck.createdAt,
      kind: 'checkpoint',
      label: ck.name ?? (ck.source === 'auto' ? 'Auto checkpoint' : 'Checkpoint')
    })
  }

  // Stable sort: message-derived events keep transcript order on equal ts.
  return events.sort((a, b) => a.ts - b.ts)
}
