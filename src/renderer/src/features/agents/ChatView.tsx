import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { KeyRound, Server, ShieldCheck } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import {
  debugEventsAtom,
  helpOpenAtom,
  mainTabAtom,
  onboardingForceOpenAtom,
  projectSettingsOpenAtom,
  projectSettingsTabAtom,
  selectedSubchatIdAtom,
  settingsOpenAtom,
  settingsTabAtom,
  splitSubchatIdAtom,
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
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAgentStream } from './use-agent-stream'
import { MessageList, INTERACTIVE_TOOLS } from './MessageList'
import { ApprovalCard } from './ApprovalCard'
import { PlanApprovalCard } from './PlanApprovalCard'
import { PromptInput } from './PromptInput'
import { QueuedPrompts } from './QueuedPrompts'
import { HelpDialog } from './HelpDialog'
import { CostPopover } from './CostPopover'
import { ThreadsPopover } from './ThreadsPopover'
import { PermissionsDialog } from './PermissionsDialog'
import { SandboxDialog } from './SandboxDialog'
import { PruneStorageDialog } from '../settings/PruneStorageDialog'
import { GoalBanner } from './GoalBanner'
import { TaskChecklist } from './TaskChecklist'
import { GoalPopover } from './GoalPopover'
import { OmStatusPopover } from './OmStatusPopover'
import { ModeSelector } from './ModeSelector'
import { ReviewPopover } from './ReviewPopover'
import { ReviewFollowupBar } from './ReviewFollowupBar'
import { useSlashCommands, type SlashCommandEntry } from './slash-commands'
import { buildReportIssuePrompt } from './report-issue-prompt'
import {
  buildLocalReviewPrompt,
  buildPlanFromReviewPrompt,
  buildPrCommentsPrompt,
  buildPrListPrompt,
  buildPrReviewPrompt,
  buildReviewMarker,
  buildShareReviewPrompt,
  findCompletedReview,
  parseReviewArgs
} from './review-prompts'
import { MODES, type Mode } from '../../../../shared/ui-message'

const THINKING = ['off', 'low', 'medium', 'high', 'xhigh'] as const

export function ChatView({
  subchatId,
  projectRoot,
  baseBranch,
  primary = true
}: {
  subchatId: string
  projectRoot: string | null
  /** The chat worktree's base branch, if known (feeds the review picker). */
  baseBranch: string | null
  /**
   * False for the right-hand split pane: global-overlay UI (threads popover,
   * help dialog — driven by app-wide atoms and Cmd+P) stays with the primary
   * pane so the split pane never hijacks those shortcuts.
   */
  primary?: boolean
}): React.JSX.Element {
  const state = useAgentStream(subchatId)
  const debug = useAtomValue(debugEventsAtom)
  const utils = trpc.useUtils()

  const send = trpc.agent.send.useMutation()
  const dismissQueued = trpc.agent.dismissQueued.useMutation()
  const approve = trpc.agent.approve.useMutation()
  const respondSuspension = trpc.agent.respondSuspension.useMutation()
  const abort = trpc.agent.abort.useMutation()
  const setMode = trpc.agent.setMode.useMutation()
  const setModel = trpc.agent.setModel.useMutation()
  const setThinking = trpc.agent.setThinking.useMutation()
  const setYolo = trpc.agent.setYolo.useMutation()
  // Repo host (GitHub/GitLab) for provider-aware review prompts and follow-up copy.
  const forge = trpc.git.forgeInfo.useQuery(
    { cwd: projectRoot ?? '' },
    { enabled: !!projectRoot, staleTime: 60_000 }
  )
  const provider = forge.data?.provider ?? null
  // Optimistic mode switching: show the requested mode immediately (pulsing)
  // until the session-meta round-trip confirms it or the mutation fails.
  const [pendingMode, setPendingMode] = useState<Mode | null>(null)
  // Post-rollback feedback: success confirmation or a partial-restore warning.
  const [rollbackNotice, setRollbackNotice] = useState<{ text: string; warn: boolean } | null>(null)
  // Rolled-back message text, handed to the prompt input for edit + resend.
  const [prefill, setPrefill] = useState<string | null>(null)
  // × on the red agent-error banner: hide errors up to this timestamp; a
  // newer error (larger ts) brings the banner back.
  const [dismissedErrorTs, setDismissedErrorTs] = useState(0)
  // Follow-up bar dismissal, keyed by the review marker's message id.
  const [dismissedReviewId, setDismissedReviewId] = useState<string | null>(null)
  const pendingRollbackText = useRef<string | null>(null)
  const rollback = trpc.chats.rollbackToMessage.useMutation({
    onSuccess: (res) => {
      utils.invalidate()
      setPrefill(pendingRollbackText.current)
      pendingRollbackText.current = null
      setRollbackNotice(
        res.warning
          ? { text: res.warning, warn: true }
          : {
              text: 'Rolled back — files and chat restored to just before that message. Your message is back in the input; edit it and resend.',
              warn: false
            }
      )
    }
  })
  // Filled in below once the action mutations exist; used by the reset effect.
  const actionMutationsRef = useRef<Array<[string, { reset: () => void }]>>([])
  useEffect(() => {
    setRollbackNotice(null)
    setPrefill(null)
    setPendingMode(null)
    setDismissedErrorTs(0)
    setDismissedReviewId(null)
    // Stale action errors must not follow the pane to another subchat.
    for (const [, m] of actionMutationsRef.current) m.reset()
  }, [subchatId])
  const confirmDialog = useConfirm()

  // Fork-from-message: the mutation clones the Mastra thread into a new
  // subchat of the same chat; switch this pane's selection to the fork.
  const setSelectedSubchatId = useSetAtom(selectedSubchatIdAtom)
  const setSplitSubchatId = useSetAtom(splitSubchatIdAtom)
  const fork = trpc.chats.fork.useMutation({
    onSuccess: async (res) => {
      // Refetch before switching panes: the split pane resets selections it
      // can't find in chat.data, so the fork must be in the lists first.
      await utils.invalidate()
      if (primary) setSelectedSubchatId(res.subchatId)
      else setSplitSubchatId(res.subchatId)
    }
  })

  // Stable callbacks for the memoized MessageList items: mutation objects
  // change identity every render but `.mutate` is referentially stable, and
  // the messages ref avoids depending on the streaming array.
  const messagesRef = useRef(state.messages)
  messagesRef.current = state.messages
  const { mutate: rollbackMutate } = rollback
  const { mutate: respondSuspensionMutate } = respondSuspension
  const handleRollback = useCallback(
    (messageId: string) => {
      void confirmDialog({
        title: 'Roll back to before this message?',
        description:
          'Files and chat are restored to the snapshot taken just before this message was sent. This message and everything after it are removed, and its text is placed back in the input so you can edit and resend it.',
        confirmLabel: 'Roll back'
      }).then((ok) => {
        if (!ok) return
        const msg = messagesRef.current.find((m) => m.id === messageId)
        // Marker sends (reviews) carry a label, not the user's words — don't
        // prefill the composer with it.
        pendingRollbackText.current =
          msg && !msg.parts.some((p) => p.type === 'text' && p.marker)
            ? msg.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
            : null
        rollbackMutate({ subchatId, messageId })
      })
    },
    [subchatId, confirmDialog, rollbackMutate]
  )
  const { mutate: forkMutate } = fork
  // Non-destructive (the source chat is untouched), so no confirm dialog.
  const handleFork = useCallback(
    (messageId: string) => forkMutate({ subchatId, messageId }),
    [subchatId, forkMutate]
  )
  const handleRespondSuspension = useCallback(
    (toolCallId: string, resumeData: unknown) =>
      respondSuspensionMutate({ subchatId, toolCallId, resumeData }),
    [subchatId, respondSuspensionMutate]
  )
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
  const goalUpdate = trpc.agent.goalUpdate.useMutation({ onSuccess: invalidateGoal })

  const commands = useSlashCommands(subchatId)
  const setMainTab = useSetAtom(mainTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setHelpOpen = useSetAtom(helpOpenAtom)
  const setProjectSettingsOpen = useSetAtom(projectSettingsOpenAtom)
  const setProjectSettingsTab = useSetAtom(projectSettingsTabAtom)
  const setForceOnboarding = useSetAtom(onboardingForceOpenAtom)
  const updatesCheck = trpc.updates.check.useMutation()
  const [costOpen, setCostOpen] = useState(false)
  const [threadsOpen, setThreadsOpen] = useAtom(threadsOpenAtom)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)
  // On failure the switch reverts (fail-visible meta) — open the dialog so the error is seen.
  const setSandbox = trpc.agent.setSandbox.useMutation({ onError: () => setSandboxOpen(true) })
  const [omOpen, setOmOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pruneOpen, setPruneOpen] = useState(false)

  const meta = state.meta
  const busy = send.isPending

  /** Send an expanded prompt with a compact transcript marker instead of a user bubble. */
  const sendMarked = (content: string, marker: string): void => {
    send.mutate({ subchatId, content, displayText: marker, displayKind: 'marker' })
  }

  // The just-finished review (if the last exchange was one) drives the
  // follow-up bar; hidden while running so it never overlaps a live run.
  const completedReview = useMemo(
    () => (state.running ? null : findCompletedReview(state.messages)),
    [state.running, state.messages]
  )

  const currentMode: Mode = (MODES as readonly string[]).includes(meta.mode ?? '')
    ? (meta.mode as Mode)
    : 'build'
  function changeMode(modeId: Mode): void {
    if (modeId === currentMode) return
    setPendingMode(modeId)
    setMode.mutate({ subchatId, modeId })
  }
  useEffect(() => {
    if (pendingMode && meta.mode === pendingMode) setPendingMode(null)
  }, [meta.mode, pendingMode])
  useEffect(() => {
    if (setMode.isError) setPendingMode(null)
  }, [setMode.isError])

  // tRPC-level failures (host not booting, IPC errors, …) never reach the
  // event stream, so surface them inline; × resets the mutation to dismiss.
  const actionMutations: Array<[string, { error: { message: string } | null; reset: () => void }]> =
    [
      ['send', send],
      ['dismiss', dismissQueued],
      ['approval', approve],
      ['response', respondSuspension],
      ['abort', abort],
      ['mode', setMode],
      ['model', setModel],
      ['thinking', setThinking],
      ['auto-approve', setYolo],
      ['rollback', rollback],
      ['fork', fork],
      ['command', runCommand],
      ['skill', runSkill],
      ['new thread', newThread],
      ['rename', renameThread],
      ['clone', cloneThread],
      ['set goal', goalSet],
      ['clear goal', goalClear],
      ['update goal', goalUpdate],
      ['update check', updatesCheck]
    ]
  actionMutationsRef.current = actionMutations
  const failedActions = actionMutations.filter(([, m]) => m.error)

  // Newest agent error from the event stream, unless the user dismissed it.
  const visibleErrors = state.infos
    .filter((i) => i.level === 'error' && i.ts > dismissedErrorTs)
    .slice(-1)

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
        changeMode(entry.name as Mode)
        return
      case 'mode':
        if (!(MODES as readonly string[]).includes(args)) {
          return `Usage: /mode <${MODES.join('|')}>`
        }
        changeMode(args as Mode)
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
        if (!primary) return 'Thread switching is available in the primary chat pane.'
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
      case 'review': {
        const parsed = parseReviewArgs(args)
        if (parsed.kind === 'invalid') return 'Usage: /review [<pr-number>|changes] [focus]'
        if (parsed.kind === 'pr') {
          sendMarked(
            buildPrReviewPrompt(parsed.prNumber, provider ?? 'github', parsed.focus),
            buildReviewMarker({ kind: 'pr', prNumber: parsed.prNumber }, provider ?? 'github')
          )
        } else if (parsed.kind === 'changes') {
          sendMarked(
            buildLocalReviewPrompt({ baseBranch: baseBranch ?? undefined, focus: parsed.focus }),
            buildReviewMarker({ kind: 'local' })
          )
        } else {
          // Deliberately not a parseable review marker — listing PRs is not a
          // review, so it must not trigger the follow-up bar.
          sendMarked(buildPrListPrompt(provider ?? 'github'), 'Review: list open PRs')
        }
        return
      }
      case 'theme':
      case 'settings':
        openSettings('appearance')
        return
      case 'mcp':
        openSettings('mcp')
        return
      case 'api-keys':
        openSettings('keys')
        return
      case 'login':
      case 'logout':
        // OAuth logins live on the Providers tab.
        openSettings('providers')
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
      case 'plugins':
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
        openSettings('agents')
        return
      case 'sandbox':
        setSandboxOpen(true)
        return
      case 'goal': {
        const objective = args.trim()
        if (!objective || objective === 'status') {
          setGoalOpen(true)
          return
        }
        if (objective === 'clear') {
          goalClear.mutate({ subchatId })
          return
        }
        if (objective === 'pause' || objective === 'resume') {
          goalUpdate.mutate({
            subchatId,
            status: objective === 'pause' ? 'paused' : 'active'
          })
          return
        }
        goalSet.mutate({ subchatId, objective })
        return
      }
      case 'om':
      case 'memory':
        setOmOpen(true)
        return
      case 'setup':
        setForceOnboarding(true)
        return
      case 'update':
        openSettings('about')
        updatesCheck.mutate()
        return
      case 'browser':
        openSettings('browser')
        return
      case 'report-issue':
        sendMarked(
          buildReportIssuePrompt(args.trim()),
          args.trim() ? `/report-issue ${args.trim()}` : '/report-issue'
        )
        return
      case 'github':
      case 'observability':
        openSettings('connectors')
        return
      case 'prune':
        setPruneOpen(true)
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
      {/* Header controls — wraps so narrow panes (split view) flow onto
          extra rows instead of overflowing the pane. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-3 py-2">
        <ModeSelector value={currentMode} pending={pendingMode} onChange={changeMode} />

        {(() => {
          const usable = (models.data ?? []).filter((m) => m.hasApiKey)
          const currentUnusable =
            meta.modelId && !usable.some((m) => m.id === meta.modelId) ? meta.modelId : null
          if (usable.length === 0 && !currentUnusable) return null
          return (
            <Select
              value={meta.modelId ?? ''}
              onValueChange={(modelId) => setModel.mutate({ subchatId, modelId })}
            >
              <Tip
                content="Model used for this chat (configure more in Settings → Models)"
                side="bottom"
              >
                <SelectTrigger className="max-w-56">
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
              </Tip>
              <SelectContent>
                {usable.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.id}
                  </SelectItem>
                ))}
                {currentUnusable && (
                  <SelectItem value={currentUnusable} disabled>
                    {currentUnusable} (no key)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )
        })()}

        {models.data && models.data.length > 0 && !models.data.some((m) => m.hasApiKey) && (
          <>
            <Tip
              content="No provider is authenticated — add an API key (OAuth logins are under Providers)"
              side="bottom"
            >
              <button
                className="flex items-center gap-1 rounded-md border border-amber-600/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500 hover:bg-amber-500/20 cursor-pointer"
                onClick={() => openSettings('keys')}
              >
                <KeyRound size={11} />
                Add API key
              </button>
            </Tip>
            <Tip
              content="Run a model on your own machine with Ollama, LM Studio, and more"
              side="bottom"
            >
              <button
                className="flex items-center gap-1 rounded-md border border-amber-600/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500 hover:bg-amber-500/20 cursor-pointer"
                onClick={() => openSettings('providers')}
              >
                <Server size={11} />
                Use a local model
              </button>
            </Tip>
          </>
        )}

        <Select
          value={meta.thinkingLevel ?? 'off'}
          onValueChange={(level) => setThinking.mutate({ subchatId, level })}
        >
          <Tip
            content="Extended thinking — higher levels let the model reason longer before answering (slower, better on hard problems)"
            side="bottom"
          >
            {/* Wide enough that the longest value ("think: medium") never wraps */}
            <SelectTrigger className="w-30 whitespace-nowrap">
              <SelectValue placeholder="Thinking" />
            </SelectTrigger>
          </Tip>
          <SelectContent>
            {THINKING.map((t) => (
              <SelectItem key={t} value={t}>
                think: {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tip
          content="Let the agent run tools and edit files without asking for approval each time"
          side="bottom"
        >
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-1">
            <Switch
              checked={meta.yolo ?? false}
              onCheckedChange={(yolo) => setYolo.mutate({ subchatId, yolo })}
            />
            auto-approve
          </label>
        </Tip>

        <Tip
          content={
            meta.isolationAvailable === false
              ? 'OS-level sandboxing is only supported on macOS (built-in seatbelt) and Linux (needs the bwrap package)'
              : meta.fullSandbox
                ? 'Full sandbox active — configure network and allowed paths via the shield or /sandbox'
                : "Run this chat's shell commands in an OS-level sandbox — writes contained to the worktree and allowed paths"
          }
          side="bottom"
        >
          <span className="inline-flex">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-1">
              <Switch
                checked={meta.fullSandbox ?? false}
                disabled={setSandbox.isPending || meta.isolationAvailable === false}
                onCheckedChange={(enabled) =>
                  setSandbox.mutate({
                    subchatId,
                    enabled,
                    allowNetwork: meta.sandboxNetwork ?? true
                  })
                }
              />
              sandbox
            </label>
          </span>
        </Tip>

        {meta.fullSandbox && (
          <Tip
            content={
              meta.sandboxNetwork === false
                ? 'Sandbox is active and network access is blocked — click to configure network access and allowed paths'
                : 'Sandbox is active — click to configure network access and allowed paths'
            }
            side="bottom"
          >
            <button
              className="flex items-center gap-1 rounded-md border border-emerald-600/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-500 hover:bg-emerald-500/20 cursor-pointer"
              onClick={() => setSandboxOpen(true)}
            >
              <ShieldCheck size={11} />
              {meta.sandboxNetwork === false && 'no net'}
            </button>
          </Tip>
        )}

        <div className="flex-1" />

        {state.approvals.length + state.suspensions.length > 0 && (
          <Tip content="Requests waiting for your approval below" side="bottom">
            <Badge className="border-amber-500/50 text-amber-500">
              {state.approvals.length + state.suspensions.length} pending
            </Badge>
          </Tip>
        )}
        {state.queuedPrompts.length > 0 && (
          <Tip
            content="Messages queued behind the active run — sent in order when it finishes; dismiss them above the composer"
            side="bottom"
          >
            <Badge className="border-sky-500/50 text-sky-500">
              {state.queuedPrompts.length} queued
            </Badge>
          </Tip>
        )}
        <GoalPopover
          subchatId={subchatId}
          live={state.goal}
          running={state.running}
          open={goalOpen}
          onOpenChange={setGoalOpen}
        />
        <ReviewPopover
          cwd={projectRoot}
          baseBranch={baseBranch}
          running={state.running}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          onReview={sendMarked}
        />
        {primary && (
          <ThreadsPopover subchatId={subchatId} open={threadsOpen} onOpenChange={setThreadsOpen} />
        )}
        <OmStatusPopover
          subchatId={subchatId}
          omEvents={state.omEvents}
          open={omOpen}
          onOpenChange={setOmOpen}
        />
        <CostPopover
          subchatId={subchatId}
          usage={state.usage}
          compressionSaved={meta.compressionSaved}
          compressionEnabled={meta.compressionEnabled}
          open={costOpen}
          onOpenChange={setCostOpen}
        />
        <Badge>{state.status}</Badge>
      </div>

      <GoalBanner subchatId={subchatId} live={state.goal} running={state.running} />

      <TaskChecklist key={subchatId} tasks={state.tasks} running={state.running} />

      <MessageList
        messages={state.messages}
        running={state.running}
        onRollback={handleRollback}
        onFork={handleFork}
        resetKey={subchatId}
        suspensions={state.suspensions}
        onRespondSuspension={handleRespondSuspension}
      />

      {/* Pending gates + errors. Interactive suspensions (ask_user /
          submit_plan / request_access) render inline in the transcript, so
          only unknown suspension tools fall back to this strip. */}
      {(state.approvals.length > 0 ||
        state.suspensions.some((s) => !INTERACTIVE_TOOLS.has(s.toolName)) ||
        visibleErrors.length > 0) && (
        <div className="px-4 pb-2 space-y-2">
          {visibleErrors.map((i) => (
            <div
              key={i.ts}
              className="flex items-start gap-2 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
            >
              <span className="min-w-0 flex-1 selectable">{i.text}</span>
              <Tip content="Dismiss this error">
                <button
                  className="shrink-0 cursor-pointer text-destructive/70 hover:text-destructive"
                  onClick={() => setDismissedErrorTs(i.ts)}
                >
                  ×
                </button>
              </Tip>
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
          {state.suspensions
            .filter((s) => !INTERACTIVE_TOOLS.has(s.toolName))
            .map((s) => (
              <PlanApprovalCard
                key={s.toolCallId}
                suspension={s}
                onResume={(resumeData) =>
                  respondSuspension.mutate({ subchatId, toolCallId: s.toolCallId, resumeData })
                }
              />
            ))}
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

      {rollbackNotice && (
        <div className="px-4 pb-2">
          <div
            className={
              rollbackNotice.warn
                ? 'flex items-start gap-2 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500'
                : 'flex items-start gap-2 rounded bg-accent px-2 py-1.5 text-xs text-muted-foreground'
            }
          >
            <span className="min-w-0 flex-1 selectable">{rollbackNotice.text}</span>
            <Tip content="Dismiss this notice">
              <button
                className="shrink-0 cursor-pointer opacity-70 hover:opacity-100"
                onClick={() => setRollbackNotice(null)}
              >
                ×
              </button>
            </Tip>
          </div>
        </div>
      )}

      {failedActions.length > 0 && (
        <div className="px-4 pb-2 space-y-1">
          {failedActions.map(([label, m], i) => (
            <div
              key={`${label}-${i}`}
              className="flex items-start gap-2 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
            >
              <span className="min-w-0 flex-1 selectable">
                {label} failed: {m.error?.message}
              </span>
              <Tip content="Dismiss this error">
                <button
                  className="shrink-0 cursor-pointer text-destructive/70 hover:text-destructive"
                  onClick={() => m.reset()}
                >
                  ×
                </button>
              </Tip>
            </div>
          ))}
        </div>
      )}

      {completedReview && completedReview.markerId !== dismissedReviewId && (
        <div className="px-4">
          <ReviewFollowupBar
            target={completedReview.target}
            cwd={projectRoot}
            provider={provider}
            busy={busy}
            shared={completedReview.shared}
            onAskForReview={() =>
              sendMarked(
                buildShareReviewPrompt(),
                buildReviewMarker(completedReview.target, provider ?? 'github')
              )
            }
            onPostComments={(prNumber) =>
              sendMarked(
                buildPrCommentsPrompt(provider ?? 'github', prNumber),
                'Review follow-up: post PR comments'
              )
            }
            onBuildPlan={() => {
              const go = (): void =>
                sendMarked(buildPlanFromReviewPrompt(), 'Review follow-up: build a plan')
              if (currentMode === 'plan') {
                go()
                return
              }
              setPendingMode('plan')
              setMode.mutate({ subchatId, modeId: 'plan' }, { onSuccess: go })
            }}
            onDismiss={() => setDismissedReviewId(completedReview.markerId)}
          />
        </div>
      )}

      <QueuedPrompts
        items={state.queuedPrompts}
        onDismiss={(id) => dismissQueued.mutate({ subchatId, id })}
      />

      <PromptInput
        disabled={busy}
        running={state.running}
        projectRoot={projectRoot}
        commands={commands}
        onSend={(content, files) => {
          setRollbackNotice(null)
          // The main process queues this behind an active run (dismissable,
          // flushed in order on run end) or sends immediately when idle.
          send.mutate({ subchatId, content, files })
        }}
        onAbort={() => abort.mutate({ subchatId })}
        onSlashCommand={handleSlashCommand}
        prefill={prefill}
        onPrefillConsumed={() => setPrefill(null)}
      />
      {primary && <HelpDialog commands={commands} />}
      <PermissionsDialog
        subchatId={subchatId}
        open={permissionsOpen}
        onOpenChange={setPermissionsOpen}
      />
      <SandboxDialog
        subchatId={subchatId}
        meta={meta}
        open={sandboxOpen}
        onOpenChange={setSandboxOpen}
      />
      <PruneStorageDialog open={pruneOpen} onOpenChange={setPruneOpen} />
    </div>
  )
}
