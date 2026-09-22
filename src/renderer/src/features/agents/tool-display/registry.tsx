/**
 * Per-tool display metadata for the compact tool rows: icon, verb-based
 * title (present tense while running, past tense when done, failure
 * phrasing on error), optional diff stats, and the expanded details view.
 * Unknown/MCP tools fall back to a humanized name plus generic details.
 * All arg reads are string-guarded so truncated stubs and partial JSON
 * (args stream as text) degrade to the bare verb.
 */
import {
  ArchiveRestore,
  Bell,
  Bot,
  FilePen,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderSearch,
  Globe,
  Info,
  Link2,
  ListChecks,
  Network,
  OctagonX,
  ScanSearch,
  Search,
  Send,
  Terminal,
  Trash2,
  Unlink,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type { ToolCallPart } from '../../../../../shared/ui-message'
import { diffStatsFor, type DiffStats } from './diff-stats'
import {
  CommandDetails,
  EditDetails,
  GenericDetails,
  OutputOnlyDetails,
  WriteDetails
} from './detail-views'

export type ToolPhase = 'pending' | 'waiting' | 'done' | 'failed'

export function phaseOf(status: ToolCallPart['status']): ToolPhase {
  if (status === 'success') return 'done'
  if (status === 'error') return 'failed'
  if (status === 'awaiting-approval' || status === 'suspended') return 'waiting'
  return 'pending' // input-streaming | running
}

export interface RowTitle {
  text: string
  /** Render the whole title in monospace (command rows). */
  mono?: boolean
  /** Muted trailing annotation, e.g. "12 matches". */
  suffix?: string
}

type Args = Record<string, unknown> | null

export interface ToolDescriptor {
  icon: LucideIcon
  title: (part: ToolCallPart, args: Args, phase: ToolPhase) => RowTitle
  stats: (args: Args) => DiffStats | null
  Details: React.ComponentType<{ part: ToolCallPart }>
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed
}

function firstLine(text: string): string {
  const idx = text.indexOf('\n')
  return idx >= 0 ? `${text.slice(0, idx)} …` : text
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function str(args: Args, key: string): string | null {
  const v = args?.[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Subject for cross-agent tools taking `ids: string[]` ("2 agent peers"). */
function peerSubject(args: Args): string | null {
  const ids = args?.ids
  if (!Array.isArray(ids)) return null
  return ids.length === 1 && typeof ids[0] === 'string'
    ? `agent ${truncate(ids[0], 24)}`
    : `${ids.length} agent peers`
}

/**
 * Verb-based title for a tool operating on a subject ("Reading foo.ts" →
 * "Read foo.ts" / "Failed to read foo.ts"). The subject is omitted when
 * args haven't parsed yet.
 */
function verbTitle(
  phase: ToolPhase,
  present: string,
  past: string,
  failed: string,
  subject: string | null
): RowTitle {
  const head = phase === 'done' ? past : phase === 'failed' ? failed : present
  return { text: subject !== null ? `${head} ${subject}` : `${head}…` }
}

/** Best-effort result count for search-style tools; null hides the suffix. */
function resultCount(part: ToolCallPart): number | null {
  try {
    const r = part.result
    if (Array.isArray(r)) return r.length
    if (r !== null && typeof r === 'object') {
      const obj = r as Record<string, unknown>
      for (const key of ['count', 'total']) {
        if (typeof obj[key] === 'number') return obj[key]
      }
      for (const key of ['matches', 'results', 'files']) {
        if (Array.isArray(obj[key])) return (obj[key] as unknown[]).length
      }
    }
    const out = typeof r === 'string' ? r : part.outputText
    if (typeof out === 'string' && out.length > 0) {
      let n = 0
      for (const line of out.split('\n')) if (line.trim().length > 0) n++
      return n
    }
  } catch {}
  return null
}

function countSuffix(
  part: ToolCallPart,
  phase: ToolPhase,
  singular: string,
  plural: string
): string | undefined {
  if (phase !== 'done') return undefined
  const n = resultCount(part)
  if (n === null || n === 0) return undefined
  return `${n} ${n === 1 ? singular : plural}`
}

/** Capitalized, space-separated rendering of an arbitrary tool name. */
export function humanizeToolName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ')
  return words.length > 0 ? words[0].toUpperCase() + words.slice(1) : name
}

const noStats = (): DiffStats | null => null

const webSearchDescriptor: ToolDescriptor = {
  icon: Globe,
  title: (_part, args, phase) => {
    const q = str(args, 'query')
    return verbTitle(
      phase,
      'Searching the web',
      'Searched the web',
      'Web search failed',
      q !== null ? `"${truncate(q, 60)}"` : null
    )
  },
  stats: noStats,
  Details: OutputOnlyDetails
}

const webExtractDescriptor: ToolDescriptor = {
  icon: Globe,
  title: (_part, args, phase) => {
    let subject: string | null = null
    const url = str(args, 'url')
    if (url !== null) {
      try {
        subject = new URL(url).hostname
      } catch {
        subject = truncate(url, 60)
      }
    } else if (Array.isArray(args?.urls)) {
      subject = `${args.urls.length} pages`
    }
    return verbTitle(phase, 'Fetching', 'Fetched', 'Failed to fetch', subject)
  },
  stats: noStats,
  Details: OutputOnlyDetails
}

const taskDescriptor: ToolDescriptor = {
  icon: ListChecks,
  title: (_part, _args, phase) =>
    verbTitle(phase, 'Updating', 'Updated', 'Failed to update', 'tasks'),
  stats: noStats,
  Details: GenericDetails
}

const DESCRIPTORS: Record<string, ToolDescriptor> = {
  view: {
    icon: FileText,
    title: (_part, args, phase) => {
      const path = str(args, 'path') ?? str(args, 'file_path')
      const title = verbTitle(
        phase,
        'Reading',
        'Read',
        'Failed to read',
        path !== null ? basename(path) : null
      )
      const range = args?.view_range
      if (Array.isArray(range) && range.length === 2 && range.every((n) => typeof n === 'number')) {
        title.suffix = `L${range[0]}-${range[1]}`
      }
      return title
    },
    stats: noStats,
    Details: OutputOnlyDetails
  },
  search_content: {
    icon: Search,
    title: (part, args, phase) => {
      const pattern = str(args, 'pattern') ?? str(args, 'query')
      const title = verbTitle(
        phase,
        'Searching',
        'Searched',
        'Search failed',
        pattern !== null ? `"${truncate(pattern, 60)}"` : null
      )
      title.suffix = countSuffix(part, phase, 'match', 'matches')
      return title
    },
    stats: noStats,
    Details: OutputOnlyDetails
  },
  find_files: {
    icon: FolderSearch,
    title: (part, args, phase) => {
      const pattern = str(args, 'pattern') ?? str(args, 'glob')
      const title = verbTitle(
        phase,
        'Finding files',
        'Found files',
        'Failed to find files',
        pattern !== null ? truncate(pattern, 60) : null
      )
      title.suffix = countSuffix(part, phase, 'result', 'results')
      return title
    },
    stats: noStats,
    Details: OutputOnlyDetails
  },
  execute_command: {
    icon: Terminal,
    title: (_part, args, phase) => {
      const command = str(args, 'command')
      if (command !== null) return { text: `$ ${truncate(firstLine(command), 120)}`, mono: true }
      return verbTitle(phase, 'Running', 'Ran', 'Failed to run', 'command')
    },
    stats: noStats,
    Details: CommandDetails
  },
  string_replace_lsp: {
    icon: FilePen,
    title: (_part, args, phase) => {
      const path = str(args, 'path')
      return verbTitle(
        phase,
        'Editing',
        'Edited',
        'Failed to edit',
        path !== null ? basename(path) : null
      )
    },
    stats: (args) => diffStatsFor('string_replace_lsp', args),
    Details: EditDetails
  },
  ast_smart_edit: {
    icon: FilePen,
    title: (_part, args, phase) => {
      const path = str(args, 'path')
      return verbTitle(
        phase,
        'Editing',
        'Edited',
        'Failed to edit',
        path !== null ? basename(path) : null
      )
    },
    stats: (args) => diffStatsFor('ast_smart_edit', args),
    Details: GenericDetails
  },
  write_file: {
    icon: FilePlus2,
    title: (_part, args, phase) => {
      const path = str(args, 'path')
      return verbTitle(
        phase,
        'Writing',
        'Wrote',
        'Failed to write',
        path !== null ? basename(path) : null
      )
    },
    stats: (args) => diffStatsFor('write_file', args),
    Details: WriteDetails
  },
  delete_file: {
    icon: Trash2,
    title: (_part, args, phase) => {
      const path = str(args, 'path')
      return verbTitle(
        phase,
        'Deleting',
        'Deleted',
        'Failed to delete',
        path !== null ? basename(path) : null
      )
    },
    stats: noStats,
    Details: GenericDetails
  },
  mkdir: {
    icon: FolderPlus,
    title: (_part, args, phase) => {
      const path = str(args, 'path')
      return verbTitle(
        phase,
        'Creating folder',
        'Created folder',
        'Failed to create folder',
        path !== null ? basename(path) : null
      )
    },
    stats: noStats,
    Details: GenericDetails
  },
  subagent: {
    icon: Bot,
    title: (_part, args, phase) => {
      const desc = str(args, 'description') ?? str(args, 'task')
      return verbTitle(
        phase,
        'Running subagent',
        'Ran subagent',
        'Subagent failed',
        desc !== null ? `"${truncate(desc, 60)}"` : null
      )
    },
    stats: noStats,
    Details: GenericDetails
  },
  file_stat: {
    icon: Info,
    title: (_part, args, phase) => {
      const path = str(args, 'path')
      return verbTitle(
        phase,
        'Inspecting',
        'Inspected',
        'Failed to inspect',
        path !== null ? basename(path) : null
      )
    },
    stats: noStats,
    Details: OutputOnlyDetails
  },
  lsp_inspect: {
    icon: ScanSearch,
    title: (_part, _args, phase) =>
      verbTitle(phase, 'Inspecting', 'Inspected', 'Failed to inspect', 'code'),
    stats: noStats,
    Details: OutputOnlyDetails
  },
  kill_process: {
    icon: OctagonX,
    title: (_part, args, phase) => {
      const pid = args?.pid
      const subject =
        typeof pid === 'string' || typeof pid === 'number' ? `process ${pid}` : 'process'
      return verbTitle(phase, 'Killing', 'Killed', 'Failed to kill', subject)
    },
    stats: noStats,
    Details: GenericDetails
  },
  get_process_output: {
    icon: Terminal,
    title: (_part, args, phase) => {
      const pid = args?.pid
      const subject =
        typeof pid === 'string' || typeof pid === 'number'
          ? `process output ${pid}`
          : 'process output'
      return verbTitle(phase, 'Reading', 'Read', 'Failed to read', subject)
    },
    stats: noStats,
    Details: OutputOnlyDetails
  },
  notification_inbox: {
    icon: Bell,
    title: (_part, _args, phase) =>
      verbTitle(phase, 'Checking', 'Checked', 'Failed to check', 'notifications'),
    stats: noStats,
    Details: OutputOnlyDetails
  },
  retrieve_full_output: {
    icon: ArchiveRestore,
    title: (_part, _args, phase) =>
      verbTitle(phase, 'Retrieving', 'Retrieved', 'Failed to retrieve', 'full output'),
    stats: noStats,
    Details: OutputOnlyDetails
  },
  agent_connections_list: {
    icon: Network,
    title: (_part, _args, phase) =>
      verbTitle(phase, 'Listing', 'Listed', 'Failed to list', 'agent peers'),
    stats: noStats,
    Details: OutputOnlyDetails
  },
  agent_connect: {
    icon: Link2,
    title: (_part, args, phase) =>
      verbTitle(phase, 'Connecting to', 'Connected to', 'Failed to connect to', peerSubject(args)),
    stats: noStats,
    Details: GenericDetails
  },
  agent_disconnect: {
    icon: Unlink,
    title: (_part, args, phase) =>
      verbTitle(phase, 'Disconnecting', 'Disconnected', 'Failed to disconnect', peerSubject(args)),
    stats: noStats,
    Details: GenericDetails
  },
  agent_signal_send: {
    icon: Send,
    title: (_part, args, phase) => {
      const target = str(args, 'targetId')
      const title = verbTitle(
        phase,
        'Signaling',
        'Signaled',
        'Failed to signal',
        target !== null ? `agent ${truncate(target, 24)}` : 'agent'
      )
      const summary = str(args, 'summary')
      if (summary !== null) title.suffix = truncate(summary, 60)
      return title
    },
    stats: noStats,
    Details: GenericDetails
  },
  'web-search': webSearchDescriptor,
  web_search: webSearchDescriptor,
  'web-extract': webExtractDescriptor,
  web_extract: webExtractDescriptor,
  task_write: taskDescriptor,
  task_update: taskDescriptor,
  task_complete: taskDescriptor,
  task_check: taskDescriptor
}

/** MCP/unknown tools: humanized name + a short peek at the arguments. */
function fallbackDescriptor(toolName: string): ToolDescriptor {
  return {
    icon: Wrench,
    title: (_part, args, phase) => {
      const name = humanizeToolName(toolName)
      const text =
        phase === 'failed' ? `${name} failed` : phase === 'done' ? name : `Running ${name}`
      let suffix: string | undefined
      if (args) {
        const pairs: string[] = []
        for (const [key, value] of Object.entries(args)) {
          if (typeof value !== 'string' || value.length === 0) continue
          pairs.push(`${key}: ${truncate(value, 40)}`)
          if (pairs.length === 2) break
        }
        if (pairs.length > 0) suffix = pairs.join(' · ')
      }
      return { text, suffix }
    },
    stats: noStats,
    Details: GenericDetails
  }
}

export function getToolDescriptor(toolName: string): ToolDescriptor {
  return DESCRIPTORS[toolName] ?? fallbackDescriptor(toolName)
}
