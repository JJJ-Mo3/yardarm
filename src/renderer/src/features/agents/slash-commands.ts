/**
 * Slash-command registry: builtins handled by the UI, custom .md commands
 * discovered per worktree via the agent host, and commands that only exist
 * in the mastracode TUI (listed so /help accounts for everything on
 * code.mastra.ai).
 */
import { useMemo } from 'react'
import { trpc } from '../../lib/trpc'

export type CommandKind = 'builtin' | 'custom' | 'cli-only'

export interface SlashCommandEntry {
  name: string
  description: string
  /** Usage hint shown in autocomplete/help, e.g. '<model-id>' */
  args?: string
  kind: CommandKind
}

export const BUILTIN_COMMANDS: SlashCommandEntry[] = [
  { name: 'plan', description: 'Switch to plan mode', kind: 'builtin' },
  { name: 'build', description: 'Switch to build mode', kind: 'builtin' },
  { name: 'fast', description: 'Switch to fast mode', kind: 'builtin' },
  { name: 'mode', description: 'Switch agent mode', args: '<build|plan|fast>', kind: 'builtin' },
  { name: 'model', description: 'Switch model', args: '<model-id>', kind: 'builtin' },
  { name: 'models', description: 'Pick a model', kind: 'builtin' },
  {
    name: 'think',
    description: 'Set thinking level',
    args: '<off|low|medium|high|xhigh>',
    kind: 'builtin'
  },
  { name: 'yolo', description: 'Toggle auto-approve (YOLO)', kind: 'builtin' },
  { name: 'permissions', description: 'Tool permission rules', kind: 'builtin' },
  { name: 'hooks', description: 'Configure lifecycle hooks', kind: 'builtin' },
  { name: 'commands', description: 'Manage custom .md commands', kind: 'builtin' },
  { name: 'resource', description: 'Show/set the memory resource id', kind: 'builtin' },
  { name: 'skills', description: 'List installed skills & plugins', kind: 'builtin' },
  { name: 'skill', description: 'Run a skill', args: '<name> [args]', kind: 'builtin' },
  { name: 'subagents', description: 'Manage subagents', kind: 'builtin' },
  { name: 'sandbox', description: 'Sandbox & session settings', kind: 'builtin' },
  {
    name: 'goal',
    description: 'Set or manage the goal (judge-evaluated objective)',
    args: '[objective|pause|resume|clear]',
    kind: 'builtin'
  },
  { name: 'om', description: 'Observational Memory status', kind: 'builtin' },
  { name: 'new', description: 'Start a new thread', kind: 'builtin' },
  { name: 'threads', description: 'List and switch threads', kind: 'builtin' },
  { name: 'thread', description: 'Thread operations', kind: 'builtin' },
  { name: 'name', description: 'Rename the current thread', args: '<title>', kind: 'builtin' },
  { name: 'clone', description: 'Clone the current thread', kind: 'builtin' },
  { name: 'cost', description: 'Show token usage', kind: 'builtin' },
  { name: 'diff', description: 'Open the Changes view', kind: 'builtin' },
  { name: 'theme', description: 'Open appearance settings', kind: 'builtin' },
  { name: 'settings', description: 'Open settings', kind: 'builtin' },
  { name: 'mcp', description: 'Configure MCP servers', kind: 'builtin' },
  { name: 'api-keys', description: 'Manage provider API keys', kind: 'builtin' },
  { name: 'login', description: 'Log in to a model provider', kind: 'builtin' },
  { name: 'logout', description: 'Log out of a model provider', kind: 'builtin' },
  { name: 'custom-providers', description: 'Manage custom providers', kind: 'builtin' },
  { name: 'help', description: 'Show all commands', kind: 'builtin' }
]

/**
 * Commands not (yet) wired to UI. Entries move to BUILTIN_COMMANDS as their
 * features land; the rest stay here so /help still accounts for them.
 */
export const CLI_ONLY_COMMANDS: SlashCommandEntry[] = [
  { name: 'thread:tag-dir', description: 'Tag threads by directory', kind: 'cli-only' },
  { name: 'review', description: 'Code review workflow', kind: 'cli-only' },
  { name: 'github', description: 'GitHub integration', kind: 'cli-only' },
  { name: 'observability', description: 'Observability integration', kind: 'cli-only' },
  { name: 'voice', description: 'Voice input', kind: 'cli-only' },
  { name: 'browser', description: 'Browser tool', kind: 'cli-only' },
  { name: 'setup', description: 'Onboarding wizard', kind: 'cli-only' },
  { name: 'update', description: 'Update the CLI', kind: 'cli-only' },
  { name: 'report-issue', description: 'Report an issue', kind: 'cli-only' },
  { name: 'exit', description: 'Exit the TUI', kind: 'cli-only' }
]

/** Builtins + custom .md commands for this subchat's worktree + CLI-only. */
export function useSlashCommands(subchatId: string | null): SlashCommandEntry[] {
  const custom = trpc.agent.listCommands.useQuery(
    { subchatId: subchatId ?? '' },
    { enabled: !!subchatId, staleTime: 30_000 }
  )
  return useMemo(() => {
    const customEntries: SlashCommandEntry[] = (custom.data ?? []).map((c) => ({
      name: c.name,
      description: c.description || 'Custom command',
      kind: 'custom' as const
    }))
    // Custom commands may shadow cli-only names, never builtins.
    const taken = new Set([...BUILTIN_COMMANDS, ...customEntries].map((c) => c.name))
    const cliOnly = CLI_ONLY_COMMANDS.filter((c) => !taken.has(c.name))
    return [...BUILTIN_COMMANDS, ...customEntries, ...cliOnly]
  }, [custom.data])
}
