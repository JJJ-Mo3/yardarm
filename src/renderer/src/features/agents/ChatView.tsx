import React, { useEffect, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { CheckCircle2, Circle, CircleDot, KeyRound } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import {
  debugEventsAtom,
  helpOpenAtom,
  mainTabAtom,
  projectSettingsOpenAtom,
  projectSettingsTabAtom,
  settingsOpenAtom,
  settingsTabAtom,
  threadsOpenAtom,
  type ProjectSettingsTab,
  type SettingsTab
} from '../../lib/atoms'
import { Badge } from '../../components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAgentStream } from './use-agent-stream'
import { MessageList } from './MessageList'
import { ApprovalCard } from './ApprovalCard'
import { PlanApprovalCard } from './PlanApprovalCard'
import { AskUserCard } from './AskUserCard'
import { PromptInput } from './PromptInput'
import { HelpDialog } from './HelpDialog'
import { CostPopover } from './CostPopover'
import { ThreadsPopover } from './ThreadsPopover'
import { PermissionsDialog } from './PermissionsDialog'
import { SandboxDialog } from './SandboxDialog'
import { GoalBanner } from './GoalBanner'
import { OmStatusPopover } from './OmStatusPopover'
import { useSlashCommands, type SlashCommandEntry } from './slash-commands'

const MODES = ['build', 'plan', 'fast'] as const
const THINKING = ['off', 'low', 'medium', 'high', 'xhigh'] as const

export function ChatView({
  subchatId,
  projectRoot
}: {
  subchatId: string
  projectRoot: string | null
}): React.JSX.Element {
  const state = useAgentStream(subchatId)
  const debug = useAtomValue(debugEventsAtom)
  const utils = trpc.useUtils()

  const send = trpc.agent.send.useMutation()
  const followUp = trpc.agent.followUp.useMutation()
  const approve = trpc.agent.approve.useMutation()
  const respondSuspension = trpc.agent.respondSuspension.useMutation()
  const abort = trpc.agent.abort.useMutation()
  const setMode = trpc.agent.setMode.useMutation()
  const setModel = trpc.agent.setModel.useMutation()
  const setThinking = trpc.agent.setThinking.useMutation()
  const setYolo = trpc.agent.setYolo.useMutation()
  const rollback = trpc.chats.rollbackToMessage.useMutation({
    onSuccess: () => utils.invalidate()
  })
  const models = trpc.agent.listModels.useQuery({ subchatId }, { staleTime: 60_000 })
  const runCommand = trpc.agent.runCommand.useMutation()
  const runSkill = trpc.agent.runSkill.useMutation()
  const skills = trpc.agent.listSkills.useQuery({ subchatId }, { staleTime: 30_000 })
  const invalidateThreads = (): void => {
    utils.agent.listThreads.invalidate({ subchatId })
  }
  const newThread = trpc.agent.newThread.useMutation({ onSuccess: invalidateThreads })
  const renameThread = trpc.agent.renameThread.useMutation({ onSuccess: invalidateThreads })
  const cloneThread = trpc.agent.cloneThread.useMutation({ onSuccess: invalidateThreads })
  const invalidateGoal = (): void => {
    utils.agent.goalGet.invalidate({ subchatId })
  }
  const goalSet = trpc.agent.goalSet.useMutation({ onSuccess: invalidateGoal })
  const goalClear = trpc.agent.goalClear.useMutation({ onSuccess: invalidateGoal })

  const commands = useSlashCommands(subchatId)
  const setMainTab = useSetAtom(mainTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setHelpOpen = useSetAtom(helpOpenAtom)
  const setProjectSettingsOpen = useSetAtom(projectSettingsOpenAtom)
  const setProjectSettingsTab = useSetAtom(projectSettingsTabAtom)
  const [costOpen, setCostOpen] = useState(false)
  const [threadsOpen, setThreadsOpen] = useAtom(threadsOpenAtom)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [omOpen, setOmOpen] = useState(false)
  const confirmDialog = useConfirm()

  const meta = state.meta
  const busy = send.isPending || followUp.isPending

  // OS notification when a run finishes while the window is unfocused,
  // honoring the mastracode `notifications` session-state setting.
  const sessionState = trpc.agent.stateGet.useQuery({ subchatId }, { staleTime: 30_000 })
  const notifyMode = sessionState.data?.notifications
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !state.running) {
      const wants = notifyMode === 'system' || notifyMode === 'both'
      if (wants && !document.hasFocus() && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('Yardarm', { body: 'Agent run finished', silent: false })
        } else if (Notification.permission === 'default') {
          void Notification.requestPermission()
        }
      }
    }
    wasRunning.current = state.running
  }, [state.running, notifyMode])

  function openSettings(tab: SettingsTab): void {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }

  function openProjectSettings(tab: ProjectSettingsTab): void {
    setProjectSettingsTab(tab)
    setProjectSettingsOpen(true)
  }

  function handleSlashCommand(entry: SlashCommandEntry, args: string): string | void {
    if (entry.kind === 'custom') {
      runCommand.mutate({ subchatId, name: entry.name, args })
      return
    }
    switch (entry.name) {
      case 'plan':
      case 'build':
      case 'fast':
        setMode.mutate({ subchatId, modeId: entry.name })
        return
      case 'mode':
        if (!(MODES as readonly string[]).includes(args)) {
          return `Usage: /mode <${MODES.join('|')}>`
        }
        setMode.mutate({ subchatId, modeId: args })
        return
      case 'model':
      case 'models': {
        if (!args) return 'Pick a model from the header dropdown, or use /model <model-id>.'
        const match = (models.data ?? []).find((m) => m.id === args)
        if (!match) return `Unknown model: ${args}. See the header dropdown for available ids.`
        if (!match.hasApiKey) return `No API key for ${args} — add one under /api-keys.`
        setModel.mutate({ subchatId, modelId: args })
        return
      }
      case 'think':
        if (!(THINKING as readonly string[]).includes(args)) {
          return `Usage: /think <${THINKING.join('|')}>`
        }
        setThinking.mutate({ subchatId, level: args })
        return
      case 'yolo':
        setYolo.mutate({ subchatId, yolo: !(meta.yolo ?? false) })
        return
      case 'new':
        newThread.mutate({ subchatId })
        return
      case 'threads':
      case 'thread':
        setThreadsOpen(true)
        return
      case 'name':
        if (!args.trim()) return 'Usage: /name <new thread title>'
        renameThread.mutate({ subchatId, title: args.trim() })
        return
      case 'clone':
        cloneThread.mutate({ subchatId })
        return
      case 'cost':
        setCostOpen(true)
        return
      case 'diff':
        setMainTab('changes')
        return
      case 'theme':
      case 'settings':
        openSettings('appearance')
        return
      case 'mcp':
        openSettings('mcp')
        return
      case 'api-keys':
      case 'login':
      case 'logout':
        openSettings('keys')
        return
      case 'custom-providers':
        openSettings('providers')
        return
      case 'permissions':
        setPermissionsOpen(true)
        return
      case 'hooks':
        openProjectSettings('hooks')
        return
      case 'commands':
        openProjectSettings('commands')
        return
      case 'resource':
        openProjectSettings('resource')
        return
      case 'skills':
        openProjectSettings('plugins')
        return
      case 'skill': {
        const trimmed = args.trim()
        const name = trimmed.split(/\s+/)[0] ?? ''
        const rest = trimmed.slice(name.length).trim()
        const available = skills.data ?? []
        if (!name) {
          if (available.length === 0) return 'No user-invocable skills found in this worktree.'
          return `Usage: /skill <name> [args]. Available: ${available.map((s) => s.name).join(', ')}`
        }
        if (available.length > 0 && !available.some((s) => s.name === name)) {
          return `Unknown skill: ${name}. Available: ${available.map((s) => s.name).join(', ')}`
        }
        runSkill.mutate({ subchatId, name, args: rest })
        return
      }
      case 'subagents':
        openSettings('models')
        return
      case 'sandbox':
        setSandboxOpen(true)
        return
      case 'goal': {
        const objective = args.trim()
        if (!objective) {
          return 'Usage: /goal <objective> — the judge evaluates it after each run. /goal clear removes it.'
        }
        if (objective === 'clear') {
          goalClear.mutate({ subchatId })
          return
        }
        goalSet.mutate({ subchatId, objective })
        return
      }
      case 'om':
        setOmOpen(true)
        return
      case 'help':
        setHelpOpen(true)
        return
      default:
        return `Not wired yet: /${entry.name}`
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header controls */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Select
          value={meta.mode ?? 'build'}
          onValueChange={(modeId) => setMode.mutate({ subchatId, modeId })}
        >
          <SelectTrigger className="w-20 capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m} value={m} className="capitalize">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={meta.modelId ?? ''}
          onValueChange={(modelId) => setModel.mutate({ subchatId, modelId })}
        >
          <SelectTrigger className="max-w-56">
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            {(models.data ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id} disabled={!m.hasApiKey}>
                {m.id}
                {!m.hasApiKey ? ' (no key)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {models.data && models.data.length > 0 && !models.data.some((m) => m.hasApiKey) && (
          <button
            title="No provider is authenticated — add an API key or log in"
            className="flex items-center gap-1 rounded-md border border-amber-600/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500 hover:bg-amber-500/20 cursor-pointer"
            onClick={() => openSettings('keys')}
          >
            <KeyRound size={11} />
            Add API key
          </button>
        )}

        <Select
          value={meta.thinkingLevel ?? 'off'}
          onValueChange={(level) => setThinking.mutate({ subchatId, level })}
        >
          <SelectTrigger className="w-24">
            <SelectValue placeholder="Thinking" />
          </SelectTrigger>
          <SelectContent>
            {THINKING.map((t) => (
              <SelectItem key={t} value={t}>
                think: {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-1">
          <Switch
            checked={meta.yolo ?? false}
            onCheckedChange={(yolo) => setYolo.mutate({ subchatId, yolo })}
          />
          auto-approve
        </label>

        <div className="flex-1" />

        {state.approvals.length + state.suspensions.length > 0 && (
          <Badge className="border-amber-500/50 text-amber-500">
            {state.approvals.length + state.suspensions.length} pending
          </Badge>
        )}
        {state.queued > 0 && (
          <Badge
            className="border-sky-500/50 text-sky-500"
            title="Messages queued behind the active run"
          >
            {state.queued} queued
          </Badge>
        )}
        <ThreadsPopover subchatId={subchatId} open={threadsOpen} onOpenChange={setThreadsOpen} />
        <OmStatusPopover
          subchatId={subchatId}
          omEvents={state.omEvents}
          open={omOpen}
          onOpenChange={setOmOpen}
        />
        <CostPopover
          subchatId={subchatId}
          usage={state.usage}
          open={costOpen}
          onOpenChange={setCostOpen}
        />
        <Badge>{state.status}</Badge>
      </div>

      <GoalBanner subchatId={subchatId} live={state.goal} />

      {/* Task list */}
      {state.tasks.length > 0 && (
        <div className="border-b border-border px-4 py-2 space-y-0.5 max-h-32 overflow-y-auto">
          {state.tasks.map((t, i) => (
            <div key={t.id ?? i} className="flex items-center gap-1.5 text-[11px]">
              {t.status === 'completed' ? (
                <CheckCircle2 size={11} className="text-green-500 shrink-0" />
              ) : t.status === 'in_progress' ? (
                <CircleDot size={11} className="text-blue-400 shrink-0" />
              ) : (
                <Circle size={11} className="text-muted-foreground shrink-0" />
              )}
              <span className={t.status === 'completed' ? 'text-muted-foreground line-through' : ''}>
                {t.content ?? ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <MessageList
        messages={state.messages}
        running={state.running}
        onRollback={(messageId) => {
          void confirmDialog({
            title: 'Rollback to checkpoint?',
            description: 'Files and chat history will be restored to before this message.',
            confirmLabel: 'Rollback'
          }).then((ok) => {
            if (ok) rollback.mutate({ subchatId, messageId })
          })
        }}
      />

      {/* Pending gates + errors */}
      {(state.approvals.length > 0 ||
        state.suspensions.length > 0 ||
        state.infos.some((i) => i.level === 'error')) && (
        <div className="px-4 pb-2 space-y-2">
          {state.infos
            .filter((i) => i.level === 'error')
            .slice(-1)
            .map((i) => (
              <div key={i.ts} className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5 selectable">
                {i.text}
              </div>
            ))}
          {state.approvals.map((a) => (
            <ApprovalCard
              key={a.toolCallId}
              approval={a}
              onDecide={(decision, opts) =>
                approve.mutate({
                  subchatId,
                  toolCallId: a.toolCallId,
                  decision,
                  feedback: opts?.feedback,
                  alwaysAllowToolName: opts?.alwaysAllowToolName
                })
              }
            />
          ))}
          {state.suspensions.map((s) =>
            s.toolName === 'ask_user' ? (
              <AskUserCard
                key={s.toolCallId}
                suspension={s}
                onResume={(resumeData) =>
                  respondSuspension.mutate({ subchatId, toolCallId: s.toolCallId, resumeData })
                }
              />
            ) : (
              <PlanApprovalCard
                key={s.toolCallId}
                suspension={s}
                onResume={(resumeData) =>
                  respondSuspension.mutate({ subchatId, toolCallId: s.toolCallId, resumeData })
                }
              />
            )
          )}
        </div>
      )}

      {debug && state.rawEvents.length > 0 && (
        <div className="max-h-32 overflow-y-auto border-t border-border bg-card px-3 py-1 font-mono text-[10px] text-muted-foreground selectable">
          {state.rawEvents.slice(-20).map((e, i) => (
            <div key={i} className="truncate">
              {JSON.stringify(e)}
            </div>
          ))}
        </div>
      )}

      <PromptInput
        disabled={busy}
        running={state.running}
        projectRoot={projectRoot}
        commands={commands}
        onSend={(content, files) => {
          // followUp() queues behind the active run but doesn't accept files.
          if (state.running) followUp.mutate({ subchatId, content })
          else send.mutate({ subchatId, content, files })
        }}
        onAbort={() => abort.mutate({ subchatId })}
        onSlashCommand={handleSlashCommand}
      />
      <HelpDialog commands={commands} />
      <PermissionsDialog
        subchatId={subchatId}
        open={permissionsOpen}
        onOpenChange={setPermissionsOpen}
      />
      <SandboxDialog subchatId={subchatId} open={sandboxOpen} onOpenChange={setSandboxOpen} />
    </div>
  )
}
