import React from 'react'
import { useAtomValue } from 'jotai'
import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { debugEventsAtom } from '../../lib/atoms'
import { Badge } from '../../components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import { useAgentStream } from './use-agent-stream'
import { MessageList } from './MessageList'
import { ApprovalCard } from './ApprovalCard'
import { PlanApprovalCard } from './PlanApprovalCard'
import { PromptInput } from './PromptInput'

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

  const meta = state.meta
  const busy = send.isPending

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
        {state.usage?.totalTokens != null && (
          <span className="text-[10px] text-muted-foreground">
            {Intl.NumberFormat().format(state.usage.totalTokens)} tok
          </span>
        )}
        <Badge>{state.status}</Badge>
      </div>

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
          if (confirm('Rollback files and history to before this message?')) {
            rollback.mutate({ subchatId, messageId })
          }
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
          {state.suspensions.map((s) => (
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

      <PromptInput
        disabled={busy}
        running={state.running}
        projectRoot={projectRoot}
        onSend={(content) => send.mutate({ subchatId, content })}
        onAbort={() => abort.mutate({ subchatId })}
        onSlashCommand={(cmd) => {
          if (cmd === 'plan' || cmd === 'build' || cmd === 'fast') {
            setMode.mutate({ subchatId, modeId: cmd })
          }
        }}
      />
    </div>
  )
}
