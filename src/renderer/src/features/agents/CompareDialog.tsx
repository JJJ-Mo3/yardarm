/**
 * Compare models dialog (`/compare` or ⌘K → "Compare models…"): one prompt,
 * 2–4 models. Starting creates one new worktree chat per model in the current
 * project (titled "<prompt summary> — <model>"), sends the same prompt to
 * each, and opens them side by side in the split view. Each compared chat
 * then offers "Keep this one" (CompareKeepBar) to archive the others.
 */
import React, { useEffect, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Columns3, Loader2, Plus, X } from 'lucide-react'
import {
  COMPARE_MAX_MODELS,
  COMPARE_MIN_MODELS,
  normalizeCompareModels,
  planCompareLayout
} from '@shared/compare'
import { trpc } from '../../lib/trpc'
import {
  compareAtom,
  compareModelsAtom,
  mainTabAtom,
  MAX_SPLIT_PANES,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom,
  splitPanesAtom
} from '../../lib/atoms'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { ModelSelect } from '../../components/ModelSelect'

export function CompareDialog(): React.JSX.Element {
  const [state, setState] = useAtom(compareAtom)
  const projectId = useAtomValue(selectedProjectIdAtom)
  const [savedModels, setSavedModels] = useAtom(compareModelsAtom)
  const setChatId = useSetAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const setSplitPanes = useSetAtom(splitPanesAtom)
  const setTab = useSetAtom(mainTabAtom)
  const confirmDialog = useConfirm()
  const utils = trpc.useUtils()

  const [prompt, setPrompt] = useState('')
  const [models, setModels] = useState<string[]>(['', ''])
  const [phase, setPhase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const available = trpc.agent.listModels.useQuery(undefined, {
    enabled: state.open,
    staleTime: 60_000
  })
  const create = trpc.compare.create.useMutation()
  const send = trpc.compare.send.useMutation()
  const approveSetup = trpc.chats.approveSetup.useMutation()

  // Fresh form on every open: the prompt from `/compare <prompt>` and the
  // models picked last time.
  useEffect(() => {
    if (!state.open) return
    setPrompt(state.prompt)
    setError(null)
    setPhase(null)
    const remembered = savedModels.slice(0, COMPARE_MAX_MODELS)
    setModels(
      remembered.length >= COMPARE_MIN_MODELS ? remembered : [...remembered, '', ''].slice(0, 2)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open])

  const busy = phase !== null
  const picked = normalizeCompareModels(models)
  const canStart = !!projectId && prompt.trim().length > 0 && picked.ok && !busy

  const close = (): void => {
    if (!busy) setState({ open: false, prompt: '' })
  }

  const start = async (): Promise<void> => {
    if (!projectId || !picked.ok) return
    setError(null)
    const text = prompt.trim()
    try {
      setPhase('Creating a worktree chat per model…')
      const created = await create.mutateAsync({
        projectId,
        prompt: text,
        modelIds: picked.modelIds
      })
      setSavedModels(picked.modelIds)
      const problems = created.failed.map((f) => `${f.modelId}: ${f.error}`)
      if (created.chats.length === 0) {
        throw new Error(`No chat could be created. ${problems.join(' · ')}`)
      }

      // Setup commands come from a repo file — run them only once approved.
      if (created.pendingSetupCommands.length > 0) {
        const ok = await confirmDialog({
          title: 'Run worktree setup commands?',
          description:
            'This project defines setup commands in .yardarm/worktree.json. They have not been ' +
            'approved yet (or changed since), so they were not run:\n\n' +
            created.pendingSetupCommands.join('\n') +
            '\n\nApprove to run them in each compared worktree before the agents start.',
          confirmLabel: 'Approve and run',
          cancelLabel: 'Skip',
          destructive: false
        })
        if (ok) {
          setPhase('Running worktree setup commands…')
          for (const chat of created.chats) {
            try {
              await approveSetup.mutateAsync({
                chatId: chat.chatId,
                commands: created.pendingSetupCommands
              })
            } catch (err) {
              problems.push(
                `setup in "${chat.title}": ${err instanceof Error ? err.message : String(err)}`
              )
            }
          }
        }
      }

      // Lay the chats out side by side. The lists must contain the new chats
      // first — split panes drop selections they cannot find.
      await utils.chats.list.invalidate()
      const layout = planCompareLayout(created.chats, MAX_SPLIT_PANES)
      if (layout.primary) {
        setChatId(layout.primary.chatId)
        setSubchatId(layout.primary.subchatId)
      }
      setSplitPanes(
        layout.panes.map((c) => ({
          key: crypto.randomUUID(),
          chatId: c.chatId,
          subchatId: c.subchatId
        }))
      )
      setTab('chat')

      setPhase('Starting the agents…')
      const sent = await send.mutateAsync({ groupId: created.groupId, prompt: text })
      for (const f of sent.failed) {
        const title = created.chats.find((c) => c.chatId === f.chatId)?.title ?? f.chatId
        problems.push(`send to "${title}": ${f.error}`)
      }
      setPhase(null)
      if (problems.length > 0) {
        setError(`Started with problems — ${problems.join(' · ')}`)
        return
      }
      setState({ open: false, prompt: '' })
    } catch (err) {
      setPhase(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      void utils.chats.list.invalidate()
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="flex items-center gap-2">
          <Columns3 size={14} />
          Compare models
        </DialogTitle>
        <DialogDescription className="mb-3 text-xs">
          Runs the same prompt with each model in its own new worktree chat and opens the chats side
          by side. Afterwards, “Keep this one” in any of them archives the others.
        </DialogDescription>
        {!projectId && (
          <div className="mb-2 text-xs text-muted-foreground">Select a project first.</div>
        )}
        <Textarea
          autoFocus
          rows={5}
          value={prompt}
          disabled={busy}
          aria-label="Prompt to compare"
          placeholder="Prompt to send to every model…"
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] text-muted-foreground">
            Models ({COMPARE_MIN_MODELS}–{COMPARE_MAX_MODELS}, each different)
          </div>
          {models.map((m, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <ModelSelect
                value={m}
                onChange={(v) => setModels((prev) => prev.map((p, j) => (j === i ? v : p)))}
                models={available.data ?? []}
                placeholder={`Model ${i + 1}`}
                tip="Model for one compared chat — type to filter"
              />
              <Tip
                content={
                  models.length > COMPARE_MIN_MODELS
                    ? 'Remove this model from the comparison'
                    : `A comparison needs at least ${COMPARE_MIN_MODELS} models`
                }
              >
                <span className="inline-flex shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove model ${i + 1}`}
                    disabled={busy || models.length <= COMPARE_MIN_MODELS}
                    onClick={() => setModels((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X size={12} />
                  </Button>
                </span>
              </Tip>
            </div>
          ))}
          <Tip
            content={
              models.length < COMPARE_MAX_MODELS
                ? 'Add another model to the comparison'
                : `Compare at most ${COMPARE_MAX_MODELS} models at once`
            }
          >
            <span className="inline-flex">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || models.length >= COMPARE_MAX_MODELS}
                onClick={() => setModels((prev) => [...prev, ''])}
              >
                <Plus size={12} />
                Add model
              </Button>
            </span>
          </Tip>
          {available.error && (
            <div className="selectable text-xs text-destructive">
              Could not list models: {available.error.message}
            </div>
          )}
        </div>
        {error && <div className="selectable mt-3 text-xs text-destructive">{error}</div>}
        <div className="mt-4 flex items-center justify-end gap-2">
          {phase && (
            <span className="mr-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              {phase}
            </span>
          )}
          <Tip content="Close without starting a comparison">
            <span className="inline-flex">
              <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
                Cancel
              </Button>
            </span>
          </Tip>
          <Tip
            content={
              !projectId
                ? 'Select a project first'
                : !prompt.trim()
                  ? 'Enter the prompt to compare'
                  : !picked.ok
                    ? picked.error
                    : 'Create one worktree chat per model, send the prompt to each, and open them side by side'
            }
          >
            <span className="inline-flex">
              <Button size="sm" disabled={!canStart} onClick={() => void start()}>
                <Columns3 size={13} />
                Start comparison
              </Button>
            </span>
          </Tip>
        </div>
      </DialogContent>
    </Dialog>
  )
}
