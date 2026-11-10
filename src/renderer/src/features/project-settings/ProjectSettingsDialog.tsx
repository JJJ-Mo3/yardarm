/**
 * Per-project .mastracode configuration: hooks, custom .md commands, agent
 * instructions, memory resource id, loaded plugins, and stored workflows.
 * Opened from the Sidebar gear or /hooks /commands /resource /skills /workflows.
 */
import React, { useEffect, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  BookOpenText,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  Lightbulb,
  Pin,
  Play,
  Plus,
  Puzzle,
  Settings2,
  Trash2,
  Variable,
  Webhook,
  Workflow
} from 'lucide-react'
import type { PluginConfigOption, RepoHostSetting } from '@shared/ipc-types'
import {
  MAX_NOTES,
  MAX_NOTE_BODY_CHARS,
  MAX_NOTE_TITLE_CHARS,
  MAX_PINNED_BYTES,
  parseTriggers
} from '@shared/knowledge-notes'
import { trpc } from '../../lib/trpc'
import { cn, timeAgo } from '../../lib/utils'
import {
  projectSettingsOpenAtom,
  projectSettingsTabAtom,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom,
  type ProjectSettingsTab
} from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Textarea } from '../../components/ui/textarea'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { ModelSelect } from '../../components/ModelSelect'

function GeneralTab({
  projectId,
  projectName,
  projectPath,
  projectArchived
}: {
  projectId: string
  projectName: string | null
  projectPath: string
  projectArchived: boolean
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const setOpen = useSetAtom(projectSettingsOpenAtom)
  const setSelectedProjectId = useSetAtom(selectedProjectIdAtom)
  const setChatId = useSetAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const confirmDialog = useConfirm()
  const [name, setName] = useState(projectName ?? '')
  const [deleteFiles, setDeleteFiles] = useState(false)

  // The dialog is shared across projects — resync when the target changes.
  useEffect(() => {
    setName(projectName ?? '')
  }, [projectName])
  useEffect(() => {
    setDeleteFiles(false)
  }, [projectId])

  const rename = trpc.projects.rename.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const setArchived = trpc.projects.setArchived.useMutation({
    onSuccess: (_res, vars) => {
      utils.projects.list.invalidate()
      if (vars.archived) {
        // Same exit path as remove: the project leaves the picker's active
        // list, so deselect it and close the dialog.
        setSelectedProjectId(null)
        setChatId(null)
        setSubchatId(null)
        setOpen(false)
      }
    }
  })
  const remove = trpc.projects.remove.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      setSelectedProjectId(null)
      setChatId(null)
      setSubchatId(null)
      setOpen(false)
    }
  })

  // Repository host override (GitHub vs GitLab) for PR/MR features.
  const settings = trpc.projects.getSettings.useQuery({ id: projectId })
  const detected = trpc.git.forgeInfo.useQuery({ cwd: projectPath }, { staleTime: 60_000 })
  const setRepoHost = trpc.projects.setRepoHost.useMutation({
    onSuccess: () => {
      utils.projects.getSettings.invalidate({ id: projectId })
      // Every Changes view / review picker (project root and worktrees) must re-resolve.
      utils.git.forgeInfo.invalidate()
    }
  })

  const trimmed = name.trim()
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-xs font-medium">Name</div>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmed && trimmed !== projectName) {
                rename.mutate({ id: projectId, name: trimmed })
              }
            }}
          />
          <Tip content="Rename this project everywhere in the app (the folder on disk keeps its name)">
            <span className="inline-flex">
              <Button
                size="sm"
                disabled={!trimmed || trimmed === projectName || rename.isPending}
                onClick={() => rename.mutate({ id: projectId, name: trimmed })}
              >
                {rename.isPending ? 'Saving…' : 'Save'}
              </Button>
            </span>
          </Tip>
        </div>
        {rename.error && (
          <div className="text-xs text-destructive selectable">{rename.error.message}</div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-xs font-medium">Path</div>
        <div className="font-mono text-[11px] text-muted-foreground selectable">{projectPath}</div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-medium">Repository host</div>
        <div className="text-[11px] text-muted-foreground">
          Used for pull/merge request features (create, review, comment). Auto-detect reads the
          origin remote; pick one explicitly for self-hosted instances it can&apos;t recognize.
        </div>
        <Tip content="Which forge this repo lives on — GitHub uses the gh CLI, GitLab uses glab. Auto-detect reads the origin remote URL">
          <span className="inline-flex">
            <select
              value={settings.data?.repoHost ?? 'auto'}
              disabled={settings.isLoading || setRepoHost.isPending}
              onChange={(e) =>
                setRepoHost.mutate({ id: projectId, repoHost: e.target.value as RepoHostSetting })
              }
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="auto">Auto-detect</option>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
          </span>
        </Tip>
        {(settings.data?.repoHost ?? 'auto') === 'auto' && detected.data && (
          <div className="text-[11px] text-muted-foreground">
            {detected.data.provider
              ? `Detected from origin: ${detected.data.provider === 'gitlab' ? 'GitLab' : 'GitHub'}`
              : 'No GitHub or GitLab remote detected.'}
          </div>
        )}
        {setRepoHost.error && (
          <div className="text-xs text-destructive selectable">{setRepoHost.error.message}</div>
        )}
      </div>

      <WorktreeSetupCard projectPath={projectPath} />

      <ReviewersCard projectId={projectId} />

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="text-xs font-medium">Archive</div>
        <div className="text-[11px] text-muted-foreground">
          Archiving hides this project from the active project list without touching anything on
          disk. It stays available under &ldquo;Archived&rdquo; in the project picker.
        </div>
        <Tip
          content={
            projectArchived
              ? 'Restore this project to the active project list'
              : 'Hide this project in the picker’s Archived group — nothing is deleted'
          }
        >
          <span className="inline-flex">
            <Button
              size="sm"
              variant="outline"
              disabled={setArchived.isPending}
              onClick={() => setArchived.mutate({ id: projectId, archived: !projectArchived })}
            >
              {setArchived.isPending
                ? 'Saving…'
                : projectArchived
                  ? 'Unarchive project'
                  : 'Archive project'}
            </Button>
          </span>
        </Tip>
        {setArchived.error && (
          <div className="text-xs text-destructive selectable">{setArchived.error.message}</div>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-destructive/40 p-3">
        <div className="text-xs font-medium text-destructive">Danger zone</div>
        <div className="text-[11px] text-muted-foreground">
          Removing the project deletes all its chats and their git worktrees, and stops any running
          agents and terminals.
        </div>
        <Tip content="Danger — permanently deletes the folder and everything in it from your disk, not just from Yardarm">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              className="accent-destructive"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
            />
            Also permanently delete the project folder from disk
          </label>
        </Tip>
        <Tip
          content={
            deleteFiles
              ? 'Remove this project and permanently delete its folder from disk'
              : 'Remove this project from Yardarm — deletes its chats and worktrees, keeps the folder on disk'
          }
        >
          <span className="inline-flex">
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                void confirmDialog({
                  title: 'Remove project?',
                  description: deleteFiles
                    ? `"${projectName ?? projectPath}" will be removed from Yardarm and its folder will be PERMANENTLY deleted from disk: ${projectPath}`
                    : `"${projectName ?? projectPath}" will be removed from Yardarm along with all its chats and worktrees. The folder on disk is kept.`,
                  confirmLabel: deleteFiles ? 'Remove and delete folder' : 'Remove project'
                }).then((ok) => {
                  if (ok) remove.mutate({ id: projectId, deleteFiles })
                })
              }}
            >
              {remove.isPending ? 'Removing…' : 'Remove project'}
            </Button>
          </span>
        </Tip>
        {remove.error && (
          <div className="text-xs text-destructive selectable">{remove.error.message}</div>
        )}
      </div>
    </div>
  )
}

/**
 * Reviewer personas: named profiles (name + steering instructions) selectable
 * in the Review popover. Prompt-time only — no agent restart on change.
 */
function ReviewersCard({ projectId }: { projectId: string }): React.JSX.Element {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const reviewers = trpc.projects.reviewersGet.useQuery({ projectId })
  const save = trpc.projects.reviewersSet.useMutation({
    onSuccess: () => utils.projects.reviewersGet.invalidate({ projectId })
  })
  const [newName, setNewName] = useState('')
  const [newInstructions, setNewInstructions] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editInstructions, setEditInstructions] = useState('')

  // The dialog is shared across projects — reset forms when the target changes.
  useEffect(() => {
    setNewName('')
    setNewInstructions('')
    setEditingId(null)
  }, [projectId])

  const list = reviewers.data ?? []
  const canAdd = newName.trim().length > 0 && newInstructions.trim().length > 0 && !save.isPending
  const canSaveEdit =
    editName.trim().length > 0 && editInstructions.trim().length > 0 && !save.isPending

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="text-xs font-medium">Reviewer personas</div>
      <div className="text-[11px] text-muted-foreground">
        Named reviewer profiles selectable when starting a code review (⋯ → Review). The selected
        persona&apos;s instructions steer the review&apos;s perspective and tone.
      </div>

      {list.map((p) =>
        editingId === p.id ? (
          <div key={p.id} className="space-y-1.5 rounded-md border border-border p-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={100}
              placeholder="Persona name"
              className="h-6 text-[11px]"
            />
            <Textarea
              value={editInstructions}
              onChange={(e) => setEditInstructions(e.target.value)}
              maxLength={4000}
              placeholder="Reviewer instructions, e.g. act as a security auditor focused on injection and authz issues"
              className="min-h-16 text-[11px]"
            />
            <div className="flex gap-1.5">
              <Tip content="Save changes to this persona">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    disabled={!canSaveEdit}
                    onClick={() =>
                      save.mutate(
                        {
                          projectId,
                          reviewers: list.map((r) =>
                            r.id === p.id
                              ? {
                                  id: r.id,
                                  name: editName.trim(),
                                  instructions: editInstructions.trim()
                                }
                              : r
                          )
                        },
                        { onSuccess: () => setEditingId(null) }
                      )
                    }
                  >
                    Save
                  </Button>
                </span>
              </Tip>
              <Tip content="Discard changes">
                <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </Tip>
            </div>
          </div>
        ) : (
          <div key={p.id} className="flex items-start gap-2 rounded-md border border-border p-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium">{p.name}</div>
              <div
                className="line-clamp-2 text-[10px] text-muted-foreground"
                title={p.instructions}
              >
                {p.instructions}
              </div>
            </div>
            <Tip content="Edit this persona's name and instructions">
              <button
                onClick={() => {
                  setEditingId(p.id)
                  setEditName(p.name)
                  setEditInstructions(p.instructions)
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <Settings2 size={12} />
              </button>
            </Tip>
            <Tip content="Delete this persona">
              <button
                onClick={() => {
                  void confirmDialog({
                    title: 'Delete reviewer persona?',
                    description: `"${p.name}" will no longer be offered in the Review popover.`,
                    confirmLabel: 'Delete'
                  }).then((ok) => {
                    if (ok) save.mutate({ projectId, reviewers: list.filter((r) => r.id !== p.id) })
                  })
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            </Tip>
          </div>
        )
      )}

      <div className="space-y-1.5">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={100}
          placeholder="New persona name, e.g. Security auditor"
          className="h-6 text-[11px]"
        />
        <Textarea
          value={newInstructions}
          onChange={(e) => setNewInstructions(e.target.value)}
          maxLength={4000}
          placeholder="Reviewer instructions, e.g. act as a security auditor focused on injection and authz issues"
          className="min-h-16 text-[11px]"
        />
        <Tip content="Add this reviewer persona to the project">
          <span className="inline-flex">
            <Button
              size="sm"
              variant="outline"
              disabled={!canAdd || list.length >= 50}
              onClick={() => {
                save.mutate({
                  projectId,
                  reviewers: [
                    ...list,
                    {
                      id: crypto.randomUUID(),
                      name: newName.trim(),
                      instructions: newInstructions.trim()
                    }
                  ]
                })
                setNewName('')
                setNewInstructions('')
              }}
            >
              <Plus size={12} className="mr-1" /> Add persona
            </Button>
          </span>
        </Tip>
      </div>
      {save.error && (
        <div className="text-xs text-destructive selectable">{save.error.message}</div>
      )}
    </div>
  )
}

/**
 * Editor for .yardarm/worktree.json "setup-worktree" — shell commands run in
 * every newly created worktree (dependency install etc.). One per line.
 */
function WorktreeSetupCard({ projectPath }: { projectPath: string }): React.JSX.Element {
  const utils = trpc.useUtils()
  const setup = trpc.projectConfig.worktreeSetupGet.useQuery({ projectPath })
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (setup.data && !dirty) setText(setup.data.commands.join('\n'))
  }, [setup.data, dirty])
  // The dialog is shared across projects — resync when the target changes.
  useEffect(() => {
    setDirty(false)
  }, [projectPath])

  const save = trpc.projectConfig.worktreeSetupSet.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.projectConfig.worktreeSetupGet.invalidate({ projectPath })
    }
  })

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="text-xs font-medium">Worktree setup commands</div>
      <div className="text-[11px] text-muted-foreground">
        Shell commands run in every new chat worktree right after it is created — one per line (e.g.{' '}
        <code>npm install</code>). Each gets 5 minutes and failures are logged but don&apos;t block
        the chat. Saved to <code>.yardarm/worktree.json</code> in the repo.
      </div>
      <Textarea
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        className="font-mono text-[11px]"
        spellCheck={false}
        placeholder={'npm install'}
      />
      <Tip content="Write the commands to .yardarm/worktree.json — applies to worktrees created from now on">
        <span className="inline-flex">
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate({
                projectPath,
                commands: text.split('\n').map((c) => c.trim())
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </span>
      </Tip>
      {save.error && (
        <div className="text-xs text-destructive selectable">{save.error.message}</div>
      )}
    </div>
  )
}

function HooksTab({
  projectPath,
  subchatId
}: {
  projectPath: string
  subchatId: string | null
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const hooks = trpc.projectConfig.hooksGet.useQuery({ projectPath })
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (hooks.data && !dirty) setText(JSON.stringify(hooks.data.config, null, 2))
  }, [hooks.data, dirty])

  const save = trpc.projectConfig.hooksSet.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.projectConfig.hooksGet.invalidate({ projectPath })
    }
  })
  const reload = trpc.projectConfig.hooksReload.useMutation()

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        Edits <code>.mastracode/hooks.json</code> — shell commands run at lifecycle events (global
        hooks run first). Events: {hooks.data?.validEvents.join(', ')}
      </div>
      <Textarea
        rows={12}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        className="font-mono text-[11px]"
        spellCheck={false}
        placeholder={'{\n  "PostToolUse": [{ "type": "command", "command": "..." }]\n}'}
      />
      <div className="flex items-center gap-2">
        <Tip content="Write the hooks to .mastracode/hooks.json">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate({ projectPath, json: text })}
            >
              Save
            </Button>
          </span>
        </Tip>
        <Tip
          content={
            subchatId
              ? 'Apply the saved hooks to the running agent without a restart'
              : 'Open a chat in this project to reload hooks live'
          }
        >
          <span className="inline-flex">
            <Button
              size="sm"
              variant="outline"
              disabled={!subchatId || reload.isPending}
              onClick={() => subchatId && reload.mutate({ subchatId })}
            >
              {reload.isSuccess ? 'Reloaded' : 'Reload in agent'}
            </Button>
          </span>
        </Tip>
        {(save.error ?? reload.error) && (
          <span className="text-xs text-destructive selectable">
            {(save.error ?? reload.error)?.message}
          </span>
        )}
      </div>
    </div>
  )
}

function CommandsTab({ projectPath }: { projectPath: string }): React.JSX.Element {
  const utils = trpc.useUtils()
  const list = trpc.projectConfig.commandsList.useQuery({ projectPath })
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [newName, setNewName] = useState('')
  const confirmDialog = useConfirm()

  const file = trpc.projectConfig.commandRead.useQuery(
    { projectPath, relPath: selected ?? '' },
    { enabled: selected !== null }
  )
  useEffect(() => {
    if (file.data && !dirty) setText(file.data.content)
  }, [file.data, dirty])

  const invalidate = (): void => {
    utils.projectConfig.commandsList.invalidate({ projectPath })
    // Slash-command autocomplete caches the merged list per subchat.
    utils.agent.listCommands.invalidate()
  }
  const write = trpc.projectConfig.commandWrite.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.projectConfig.commandRead.invalidate({ projectPath, relPath: selected ?? '' })
      invalidate()
    }
  })
  const create = trpc.projectConfig.commandCreate.useMutation({
    onSuccess: (info) => {
      setNewName('')
      invalidate()
      setSelected(info.relPath)
      setDirty(false)
    }
  })
  const remove = trpc.projectConfig.commandDelete.useMutation({
    onSuccess: () => {
      setSelected(null)
      invalidate()
    }
  })
  const openInEditor = trpc.projectConfig.openInEditor.useMutation()

  const selectFile = (relPath: string): void => {
    setSelected(relPath)
    setDirty(false)
    setText('')
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        Markdown prompts in <code>.mastracode/commands/</code> become <code>/name</code> slash
        commands in this project&apos;s chats.
      </div>
      <div className="space-y-1">
        {(list.data ?? []).map((c) => (
          <div
            key={c.relPath}
            className={cn(
              'group flex cursor-pointer items-center gap-2 rounded px-2 py-1',
              selected === c.relPath ? 'bg-accent' : 'hover:bg-accent/50'
            )}
            onClick={() => selectFile(c.relPath)}
          >
            <span className="font-mono text-[11px]">/{c.name}</span>
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
              {c.description ?? ''}
            </span>
            <Tip content="Open this command file in your system editor">
              <button
                className="hidden group-hover:block text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  openInEditor.mutate({ path: c.path })
                }}
              >
                <ExternalLink size={11} />
              </button>
            </Tip>
            <Tip content={`Delete this command — /${c.name} disappears from this project's chats`}>
              <button
                className="hidden group-hover:block text-muted-foreground hover:text-destructive cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  void confirmDialog({
                    title: `Delete /${c.name}?`,
                    description: 'The command file will be removed from .mastracode/commands.',
                    confirmLabel: 'Delete'
                  }).then((ok) => {
                    if (ok) remove.mutate({ projectPath, relPath: c.relPath })
                  })
                }}
              >
                <Trash2 size={11} />
              </button>
            </Tip>
          </div>
        ))}
        {(list.data ?? []).length === 0 && (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">No custom commands yet.</div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="new-command-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="font-mono text-[11px]"
        />
        <Tip content="Create a new command file — it becomes a /slash command in this project's chats">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!newName.trim() || create.isPending}
              onClick={() => create.mutate({ projectPath, name: newName.trim() })}
            >
              Create
            </Button>
          </span>
        </Tip>
      </div>
      {selected !== null && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] text-muted-foreground">{selected}</div>
          <Textarea
            rows={10}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setDirty(true)
            }}
            className="font-mono text-[11px]"
            spellCheck={false}
          />
          <Button
            size="sm"
            disabled={!dirty || write.isPending}
            onClick={() => write.mutate({ projectPath, relPath: selected, content: text })}
          >
            Save
          </Button>
        </div>
      )}
      {(create.error ?? write.error ?? remove.error) && (
        <div className="text-xs text-destructive selectable">
          {(create.error ?? write.error ?? remove.error)?.message}
        </div>
      )}
    </div>
  )
}

function InstructionsTab({ projectPath }: { projectPath: string }): React.JSX.Element {
  const utils = trpc.useUtils()
  const info = trpc.projectConfig.instructionsGet.useQuery({ projectPath })
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (info.data && !dirty) setText(info.data.content ?? '')
  }, [info.data, dirty])

  const save = trpc.projectConfig.instructionsSet.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.projectConfig.instructionsGet.invalidate({ projectPath })
    }
  })

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        <code>.mastracode/agent-instructions.md</code> is prepended to the agent&apos;s system
        prompt for this project.
        {info.data && info.data.legacyFiles.length > 0 && (
          <> Also found: {info.data.legacyFiles.join(', ')} (honored by the SDK).</>
        )}
      </div>
      <Textarea
        rows={14}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        className="font-mono text-[11px]"
        spellCheck={false}
        placeholder="Project-specific instructions for the agent…"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ projectPath, content: text })}
        >
          Save
        </Button>
        {save.error && (
          <span className="text-xs text-destructive selectable">{save.error.message}</span>
        )}
      </div>
    </div>
  )
}

function ResourceTab({
  projectPath,
  subchatId
}: {
  projectPath: string
  subchatId: string | null
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const stored = trpc.projectConfig.resourceIdGet.useQuery({ projectPath })
  const live = trpc.projectConfig.resourceInfo.useQuery(
    { subchatId: subchatId ?? '' },
    { enabled: !!subchatId }
  )
  const [value, setValue] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (stored.data && !dirty) setValue(stored.data.resourceId ?? '')
  }, [stored.data, dirty])

  const save = trpc.projectConfig.resourceIdSet.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.projectConfig.resourceIdGet.invalidate({ projectPath })
    }
  })

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        The resource id tags this project&apos;s memory (threads, observations). Set the same id in
        two checkouts to share memory between them. Stored in <code>.mastracode/database.json</code>
        ; this project&apos;s agents restart on save.
      </div>
      {live.data && (
        <div className="text-[11px]">
          <span className="text-muted-foreground">Live session resource:</span>{' '}
          <span className="font-mono selectable">{live.data.resourceId}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          placeholder="auto-detected (leave empty for default)"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setDirty(true)
          }}
          className="font-mono text-[11px]"
        />
        <Tip content="Save the resource id and restart this project's agents so memory reattaches">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate({ projectPath, resourceId: value.trim() || null })}
            >
              Save & restart
            </Button>
          </span>
        </Tip>
      </div>
      {save.error && (
        <div className="text-xs text-destructive selectable">{save.error.message}</div>
      )}
    </div>
  )
}

/** Schema-declared plugin settings rendered as typed fields (boolean/string/model). */
function PluginConfigForm({
  subchatId,
  pluginId,
  scope,
  schema,
  values
}: {
  subchatId: string
  pluginId: string
  scope: 'global' | 'project'
  schema: Record<string, PluginConfigOption>
  values: Record<string, string | boolean | undefined>
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const setConfig = trpc.projectConfig.pluginSetConfig.useMutation({
    onSuccess: (list) => utils.projectConfig.pluginsList.setData({ subchatId }, list)
  })
  const needsModels = Object.values(schema).some((o) => o.type === 'model')
  const models = trpc.agent.listModels.useQuery(
    { subchatId },
    { enabled: needsModels, staleTime: 60_000 }
  )
  const save = (key: string, value: string | boolean): void =>
    setConfig.mutate({ subchatId, pluginId, scope, key, value })
  return (
    <div className="mt-1.5 space-y-1.5">
      {Object.entries(schema).map(([key, opt]) => {
        const current = values[key] ?? opt.default
        const label = opt.label ?? key
        const tip = opt.description ?? `Set the plugin's ${label} option`
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="w-36 shrink-0 truncate text-[10px] text-muted-foreground" title={key}>
              {label}
            </span>
            {opt.type === 'boolean' ? (
              <Tip content={tip}>
                <span className="inline-flex">
                  <Switch
                    checked={current === true || current === 'true'}
                    disabled={setConfig.isPending}
                    onCheckedChange={(v) => save(key, v)}
                  />
                </span>
              </Tip>
            ) : opt.type === 'model' ? (
              <Tip content={tip}>
                <span className="inline-flex min-w-0 flex-1">
                  <ModelSelect
                    value={typeof current === 'string' ? current : ''}
                    onChange={(v) => save(key, v)}
                    models={models.data ?? []}
                    placeholder="(default model)"
                  />
                </span>
              </Tip>
            ) : (
              <Tip content={tip}>
                <span className="inline-flex min-w-0 flex-1">
                  <Input
                    className="h-6 font-mono text-[10px]"
                    defaultValue={typeof current === 'string' ? current : ''}
                    placeholder={typeof opt.default === 'string' ? opt.default : undefined}
                    onBlur={(e) => {
                      const v = e.target.value
                      if (v !== (typeof current === 'string' ? current : '')) save(key, v)
                    }}
                  />
                </span>
              </Tip>
            )}
          </div>
        )
      })}
      {setConfig.error && (
        <div className="text-[10px] text-destructive selectable">{setConfig.error.message}</div>
      )}
    </div>
  )
}

function PluginConfigRow({
  subchatId,
  pluginId,
  scope
}: {
  subchatId: string
  pluginId: string
  scope: 'global' | 'project'
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const setConfig = trpc.projectConfig.pluginSetConfig.useMutation({
    onSuccess: (list) => {
      utils.projectConfig.pluginsList.setData({ subchatId }, list)
      setKey('')
      setValue('')
    }
  })
  return (
    <div className="mt-1.5 flex gap-1.5">
      <Input
        placeholder="config key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="h-6 font-mono text-[10px]"
      />
      <Input
        placeholder="value (true/false for booleans)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-6 font-mono text-[10px]"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[10px]"
        disabled={!key.trim() || setConfig.isPending}
        onClick={() => {
          const raw = value.trim()
          const parsed: string | boolean = raw === 'true' ? true : raw === 'false' ? false : raw
          setConfig.mutate({ subchatId, pluginId, scope, key: key.trim(), value: parsed })
        }}
      >
        Set
      </Button>
      {setConfig.error && (
        <span className="text-[10px] text-destructive selectable">{setConfig.error.message}</span>
      )}
    </div>
  )
}

/**
 * Scaffold a new plugin skeleton on disk (SDK scaffoldPlugin — the CLI's
 * `plugin scaffold`), then install the created directory into this chat's
 * agent so it shows up in the list immediately.
 */
function ScaffoldPluginDialog({
  subchatId,
  projectPath,
  open,
  onOpenChange
}: {
  subchatId: string
  projectPath: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [targetDir, setTargetDir] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>('project')

  const install = trpc.projectConfig.pluginInstall.useMutation({
    onSuccess: (list) => {
      utils.projectConfig.pluginsList.setData({ subchatId }, list)
      setName('')
      setId('')
      setTargetDir('')
      onOpenChange(false)
    }
  })
  const scaffold = trpc.projectConfig.pluginScaffold.useMutation({
    onSuccess: (result) =>
      install.mutate({ subchatId, source: 'local', pathOrUrl: result.path, scope })
  })

  const busy = scaffold.isPending || install.isPending
  const error = scaffold.error ?? install.error
  const close = (next: boolean): void => {
    if (busy) return
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Create plugin</DialogTitle>
        <div className="space-y-3">
          <div className="text-[11px] text-muted-foreground">
            Scaffolds a plugin skeleton (manifest, example tool, skill and command) into a new
            directory, then installs it into this chat&apos;s agent. Edit the files afterwards —
            relative paths resolve against the project root.
          </div>
          <div className="space-y-1">
            <div className="text-xs">Directory</div>
            <Input
              placeholder=".mastracode/plugins/my-plugin or /absolute/path"
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              className="font-mono text-[11px]"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <div className="text-xs">Name (optional)</div>
              <Input
                placeholder="My Plugin"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-[11px]"
              />
            </div>
            <div className="flex-1 space-y-1">
              <div className="text-xs">Id (optional)</div>
              <Input
                placeholder="my-plugin (defaults from directory)"
                value={id}
                onChange={(e) => setId(e.target.value)}
                className="font-mono text-[11px]"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs">Install scope</span>
            <Tip content="Install the new plugin for this project only, or globally for every project on this machine">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'global' | 'project')}
                className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
              >
                <option value="project">project</option>
                <option value="global">global</option>
              </select>
            </Tip>
          </div>
          {error && <div className="text-xs text-destructive selectable">{error.message}</div>}
          <div className="flex justify-end gap-2">
            <Tip content="Close without creating a plugin">
              <span className="inline-flex">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => close(false)}>
                  Cancel
                </Button>
              </span>
            </Tip>
            <Tip content="Scaffold the plugin files and install them into this chat's agent">
              <span className="inline-flex">
                <Button
                  size="sm"
                  disabled={!targetDir.trim() || busy}
                  onClick={() =>
                    scaffold.mutate({
                      targetDir: targetDir.trim(),
                      id: id.trim() || undefined,
                      name: name.trim() || undefined,
                      projectRoot: projectPath ?? undefined
                    })
                  }
                >
                  {scaffold.isPending
                    ? 'Creating…'
                    : install.isPending
                      ? 'Installing…'
                      : 'Create & install'}
                </Button>
              </span>
            </Tip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PluginsTab({
  subchatId,
  projectPath
}: {
  subchatId: string | null
  projectPath: string | null
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const plugins = trpc.projectConfig.pluginsList.useQuery(
    { subchatId: subchatId ?? '' },
    { enabled: !!subchatId }
  )
  const [source, setSource] = useState<'local' | 'github'>('local')
  const [pathOrUrl, setPathOrUrl] = useState('')
  const [installScope, setInstallScope] = useState<'global' | 'project'>('project')
  const [configFor, setConfigFor] = useState<string | null>(null)
  const [scaffoldOpen, setScaffoldOpen] = useState(false)
  const confirmDialog = useConfirm()

  const onList = (list: NonNullable<typeof plugins.data>): void => {
    utils.projectConfig.pluginsList.setData({ subchatId: subchatId ?? '' }, list)
  }
  const install = trpc.projectConfig.pluginInstall.useMutation({
    onSuccess: (list) => {
      setPathOrUrl('')
      onList(list)
    }
  })
  const uninstall = trpc.projectConfig.pluginUninstall.useMutation({ onSuccess: onList })
  const setEnabled = trpc.projectConfig.pluginSetEnabled.useMutation({ onSuccess: onList })

  if (!subchatId) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Open a chat in this project to manage the plugins its agent loads.
      </div>
    )
  }
  const mutationError = install.error ?? uninstall.error ?? setEnabled.error
  const busy = install.isPending || uninstall.isPending || setEnabled.isPending
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        Plugins add tools, skills and commands to this chat&apos;s agent. Project scope installs to{' '}
        <code>.mastracode/plugins</code>; global to the shared app data dir.
      </div>
      <div className="flex gap-1.5">
        <Tip content="Where the plugin comes from — a folder on this machine or a GitHub repository">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as 'local' | 'github')}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="local">local path</option>
            <option value="github">github</option>
          </select>
        </Tip>
        <Input
          placeholder={source === 'local' ? '/path/to/plugin' : 'https://github.com/org/repo'}
          value={pathOrUrl}
          onChange={(e) => setPathOrUrl(e.target.value)}
          className="font-mono text-[11px]"
        />
        <Tip content="Install for this project only, or globally for every project on this machine">
          <select
            value={installScope}
            onChange={(e) => setInstallScope(e.target.value as 'global' | 'project')}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="project">project</option>
            <option value="global">global</option>
          </select>
        </Tip>
        <Tip content="Install the plugin and load its tools, skills, and commands into this chat's agent">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!pathOrUrl.trim() || busy}
              onClick={() =>
                install.mutate({
                  subchatId,
                  source,
                  pathOrUrl: pathOrUrl.trim(),
                  scope: installScope
                })
              }
            >
              {install.isPending ? 'Installing…' : 'Install'}
            </Button>
          </span>
        </Tip>
      </div>
      <Tip content="Scaffold a brand-new plugin (manifest + example tool, skill and command) and install it">
        <span className="inline-flex">
          <Button size="sm" variant="outline" onClick={() => setScaffoldOpen(true)}>
            Create plugin…
          </Button>
        </span>
      </Tip>
      <ScaffoldPluginDialog
        subchatId={subchatId}
        projectPath={projectPath}
        open={scaffoldOpen}
        onOpenChange={setScaffoldOpen}
      />
      {plugins.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {plugins.error && (
        <div className="text-xs text-destructive selectable">{plugins.error.message}</div>
      )}
      {mutationError && (
        <div className="text-xs text-destructive selectable">{mutationError.message}</div>
      )}
      <div className="space-y-1.5">
        {(plugins.data ?? []).map((p) => {
          const scope = (p.scope === 'global' ? 'global' : 'project') as 'global' | 'project'
          const enabled = p.status !== 'disabled'
          return (
            <div key={`${p.scope}:${p.id}`} className="rounded border border-border px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {p.name ?? p.id}
                </span>
                <span
                  className={cn(
                    'rounded px-1 py-0.5 text-[9px] uppercase',
                    p.status === 'active'
                      ? 'bg-green-500/15 text-green-500'
                      : p.status === 'error'
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-accent'
                  )}
                >
                  {p.status}
                </span>
                <span className="text-[10px] text-muted-foreground">{p.scope}</span>
                <Tip
                  content={
                    enabled
                      ? 'Disable this plugin — its tools, skills, and commands unload'
                      : 'Enable this plugin — its tools, skills, and commands load'
                  }
                >
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                    disabled={busy}
                    onClick={() =>
                      setEnabled.mutate({ subchatId, pluginId: p.id, scope, enabled: !enabled })
                    }
                  >
                    {enabled ? 'disable' : 'enable'}
                  </button>
                </Tip>
                <Tip content="Set configuration key/value pairs for this plugin">
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => setConfigFor(configFor === p.id ? null : p.id)}
                  >
                    config
                  </button>
                </Tip>
                <Tip content="Uninstall this plugin and delete its files">
                  <button
                    className="text-muted-foreground hover:text-destructive cursor-pointer"
                    disabled={busy}
                    onClick={() => {
                      void confirmDialog({
                        title: 'Uninstall plugin?',
                        description: `${p.name ?? p.id} will be removed (${scope} scope).`,
                        confirmLabel: 'Uninstall'
                      }).then((ok) => {
                        if (ok) uninstall.mutate({ subchatId, pluginId: p.id, scope })
                      })
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </Tip>
              </div>
              {p.description && (
                <div className="text-[10px] text-muted-foreground">{p.description}</div>
              )}
              <div className="text-[10px] text-muted-foreground">
                {p.toolNames.length} tools · {p.skillCount} skills · {p.commandCount} commands
              </div>
              {p.error && <div className="text-[10px] text-destructive selectable">{p.error}</div>}
              {configFor === p.id && (
                <>
                  {p.configSchema && Object.keys(p.configSchema).length > 0 && (
                    <PluginConfigForm
                      subchatId={subchatId}
                      pluginId={p.id}
                      scope={scope}
                      schema={p.configSchema}
                      values={p.configValues ?? {}}
                    />
                  )}
                  <PluginConfigRow subchatId={subchatId} pluginId={p.id} scope={scope} />
                </>
              )}
            </div>
          )
        })}
        {plugins.data?.length === 0 && (
          <div className="text-[11px] text-muted-foreground">No plugins loaded.</div>
        )}
      </div>
    </div>
  )
}

/**
 * View/edit dialog for a stored workflow's JSON definition. Save goes through
 * the same validated addDynamicWorkflow upsert the agent's save-workflow tool
 * uses, so bad references or schemas are rejected before anything is stored.
 */
function WorkflowDefinitionDialog({
  subchatId,
  workflowId,
  onClose
}: {
  subchatId: string
  workflowId: string | null
  onClose: () => void
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const def = trpc.projectConfig.workflowGet.useQuery(
    { subchatId, workflowId: workflowId ?? '' },
    { enabled: workflowId !== null }
  )
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const save = trpc.projectConfig.workflowSave.useMutation({
    onSuccess: () => {
      setDirty(false)
      void utils.projectConfig.workflowsList.invalidate({ subchatId })
      onClose()
    }
  })

  // Sync the fetched definition into the editor until the user starts editing.
  useEffect(() => {
    if (!dirty) setText(def.data?.definitionJson ?? '')
  }, [def.data, dirty])

  let jsonError: string | null = null
  if (text.trim()) {
    try {
      JSON.parse(text)
    } catch {
      jsonError = 'Not valid JSON yet — fix the syntax to enable Save.'
    }
  } else {
    jsonError = 'Definition is empty.'
  }

  return (
    <Dialog
      open={workflowId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setDirty(false)
          save.reset()
          onClose()
        }
      }}
    >
      <DialogContent className="max-h-[80vh] max-w-2xl space-y-2 overflow-y-auto">
        <DialogTitle className="font-mono text-xs">{workflowId}</DialogTitle>
        {def.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {def.error && (
          <div className="text-xs text-destructive selectable">{def.error.message}</div>
        )}
        {!def.isLoading && !def.error && (
          <>
            <Textarea
              rows={18}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setDirty(true)
              }}
              className="font-mono text-[10px]"
              spellCheck={false}
            />
            <div className="flex items-center gap-2">
              <Tip content="Validate the definition and save it — the workflow is updated immediately, no restart needed">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    disabled={!dirty || jsonError !== null || save.isPending}
                    onClick={() => save.mutate({ subchatId, definitionJson: text })}
                  >
                    {save.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </span>
              </Tip>
              {dirty && jsonError && (
                <span className="text-[10px] text-muted-foreground">{jsonError}</span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Saving fully validates the definition (structure, agent/tool references, schema flow).
              Saving under a changed id creates a new workflow — the original keeps its id.
            </div>
            {save.error && (
              <div className="text-xs text-destructive selectable">{save.error.message}</div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Stored chat-built workflows: list, run (with optional JSON input), inspect
 * and edit the stored definition, delete. Creation is chat-driven — the agent
 * saves workflows during a conversation.
 */
function WorkflowsTab({ subchatId }: { subchatId: string | null }): React.JSX.Element {
  const utils = trpc.useUtils()
  const workflows = trpc.projectConfig.workflowsList.useQuery(
    { subchatId: subchatId ?? '' },
    { enabled: !!subchatId }
  )
  const [runFor, setRunFor] = useState<string | null>(null)
  const [defFor, setDefFor] = useState<string | null>(null)
  const [inputJson, setInputJson] = useState('')
  const confirmDialog = useConfirm()

  const run = trpc.projectConfig.workflowRun.useMutation()
  const remove = trpc.projectConfig.workflowDelete.useMutation({
    onSuccess: () => utils.projectConfig.workflowsList.invalidate({ subchatId: subchatId ?? '' })
  })

  if (!subchatId) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Open a chat in this project to manage its stored workflows.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        Workflows are reusable multi-step routines the agent builds for you — ask in chat (e.g.
        &ldquo;create a workflow that&hellip;&rdquo;) and it appears here to re-run on demand.
      </div>
      {workflows.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {workflows.error && (
        <div className="text-xs text-destructive selectable">{workflows.error.message}</div>
      )}
      {remove.error && (
        <div className="text-xs text-destructive selectable">{remove.error.message}</div>
      )}
      <div className="space-y-1.5">
        {(workflows.data ?? []).map((w) => (
          <div key={w.id} className="rounded border border-border px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{w.id}</span>
              <span
                className={cn(
                  'rounded px-1 py-0.5 text-[9px] uppercase',
                  w.status === 'active' ? 'bg-green-500/15 text-green-500' : 'bg-accent'
                )}
              >
                {w.status}
              </span>
              <Tip content="View and edit this workflow's stored JSON definition">
                <button
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => setDefFor(w.id)}
                >
                  <FileCode2 size={11} />
                </button>
              </Tip>
              <Tip
                content={
                  runFor === w.id
                    ? 'Hide the run form'
                    : 'Run this workflow now (optionally with JSON input)'
                }
              >
                <button
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => {
                    setRunFor(runFor === w.id ? null : w.id)
                    setInputJson('')
                    run.reset()
                  }}
                >
                  <Play size={11} />
                </button>
              </Tip>
              <Tip content="Delete this stored workflow">
                <button
                  className="text-muted-foreground hover:text-destructive cursor-pointer"
                  disabled={remove.isPending}
                  onClick={() => {
                    void confirmDialog({
                      title: 'Delete workflow?',
                      description: `"${w.id}" will be removed from workflow storage.`,
                      confirmLabel: 'Delete'
                    }).then((ok) => {
                      if (ok) remove.mutate({ subchatId, workflowId: w.id })
                    })
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </Tip>
            </div>
            {w.description && (
              <div className="text-[10px] text-muted-foreground">{w.description}</div>
            )}
            {(w.stepCount !== undefined || w.updatedAt !== undefined) && (
              <div className="text-[10px] text-muted-foreground">
                {w.stepCount !== undefined && `${w.stepCount} step${w.stepCount === 1 ? '' : 's'}`}
                {w.stepCount !== undefined && w.updatedAt !== undefined && ' · '}
                {w.updatedAt !== undefined && `updated ${timeAgo(w.updatedAt)}`}
              </div>
            )}
            {runFor === w.id && (
              <div className="mt-1.5 space-y-1.5">
                <Textarea
                  rows={2}
                  value={inputJson}
                  onChange={(e) => setInputJson(e.target.value)}
                  className="font-mono text-[10px]"
                  spellCheck={false}
                  placeholder='Optional JSON input, e.g. {"target": "src/"}'
                />
                <Tip content="Run the workflow to completion and show each step's outcome">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      disabled={run.isPending}
                      onClick={() =>
                        run.mutate({
                          subchatId,
                          workflowId: w.id,
                          inputJson: inputJson.trim() || undefined
                        })
                      }
                    >
                      {run.isPending ? 'Running…' : 'Run workflow'}
                    </Button>
                  </span>
                </Tip>
                {run.error && (
                  <div className="text-[10px] text-destructive selectable">{run.error.message}</div>
                )}
                {run.data && (
                  <div className="space-y-0.5 rounded bg-accent/40 p-1.5 text-[10px]">
                    <div>
                      Status: <span className="font-medium">{run.data.status}</span>
                    </div>
                    {run.data.steps.map((s, i) => (
                      <div key={`${s.id}-${i}`} className="font-mono">
                        {s.id}: {s.status}
                      </div>
                    ))}
                    {run.data.error && (
                      <div className="text-destructive selectable">{run.data.error}</div>
                    )}
                    {run.data.resultJson && (
                      <pre className="overflow-x-auto whitespace-pre-wrap font-mono selectable">
                        {run.data.resultJson}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {workflows.data?.length === 0 && (
          <div className="text-[11px] text-muted-foreground">
            No workflows yet. Ask the agent in chat to create one — e.g. &ldquo;create a workflow
            that runs the tests, fixes failures, and summarizes the changes&rdquo;.
          </div>
        )}
      </div>
      <WorkflowDefinitionDialog
        subchatId={subchatId}
        workflowId={defFor}
        onClose={() => setDefFor(null)}
      />
    </div>
  )
}

/**
 * User-authored knowledge notes (distinct from the SDK's experimental
 * knowledge base, which is agent memory). Pinned note bodies ride in the
 * system prompt of every run; the rest are listed by title and fetched on
 * demand via the knowledge_note_lookup tool. Edits apply at the next host
 * boot, so saving restarts the project's running chats.
 */
function KnowledgeTab({
  projectId,
  projectPath
}: {
  projectId: string
  projectPath: string
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const notes = trpc.knowledgeNotes.list.useQuery({ projectId })

  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newTriggers, setNewTriggers] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editTriggers, setEditTriggers] = useState('')

  const invalidate = (): void => void utils.knowledgeNotes.list.invalidate({ projectId })
  const create = trpc.knowledgeNotes.create.useMutation({
    onSuccess: () => {
      setNewTitle('')
      setNewBody('')
      setNewTriggers('')
      invalidate()
    }
  })
  const update = trpc.knowledgeNotes.update.useMutation({
    onSuccess: () => {
      setEditingId(null)
      invalidate()
    }
  })
  const remove = trpc.knowledgeNotes.delete.useMutation({ onSuccess: invalidate })

  const rows = notes.data ?? []
  const pinnedBytes = rows
    .filter((n) => n.pinned && n.enabled)
    .reduce((sum, n) => sum + new TextEncoder().encode(n.body).length, 0)
  const mutating = create.isPending || update.isPending || remove.isPending
  const mutationError = create.error ?? update.error ?? remove.error

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Durable project facts the agent should always know (conventions, commands, pitfalls). Pinned
        notes are included in every run&apos;s system prompt; unpinned notes are listed by title and
        fetched on demand. Unpinned notes can also carry trigger keywords — a prompt mentioning one
        injects the note into that send. Changes apply to the next run — running chats in this
        project restart. Not the same as the agent&apos;s own knowledge base (memory it gathers
        itself).
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="text-xs font-medium">Add note</div>
        <Input
          placeholder="Title (e.g. Always use pnpm)"
          value={newTitle}
          maxLength={MAX_NOTE_TITLE_CHARS}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <Textarea
          placeholder="Note body — one durable, self-contained fact"
          value={newBody}
          maxLength={MAX_NOTE_BODY_CHARS}
          rows={3}
          onChange={(e) => setNewBody(e.target.value)}
        />
        <Input
          placeholder="Trigger keywords, comma-separated (optional — e.g. deploy, staging)"
          value={newTriggers}
          maxLength={500}
          onChange={(e) => setNewTriggers(e.target.value)}
        />
        <Tip content="Save this note — it reaches the agent on its next run (running chats in this project restart)">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!newTitle.trim() || !newBody.trim() || mutating}
              onClick={() =>
                create.mutate({
                  projectId,
                  projectPath,
                  title: newTitle.trim(),
                  body: newBody.trim(),
                  pinned: false,
                  source: 'user',
                  triggers: newTriggers.trim() || undefined
                })
              }
            >
              {create.isPending ? 'Adding…' : 'Add note'}
            </Button>
          </span>
        </Tip>
      </div>

      {mutationError && (
        <div className="text-xs text-destructive selectable">{mutationError.message}</div>
      )}

      {rows.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {rows.length}/{MAX_NOTES} notes · pinned budget {pinnedBytes}/{MAX_PINNED_BYTES} bytes
          {pinnedBytes > MAX_PINNED_BYTES
            ? ' — overflowing pinned notes are demoted to on-demand lookup'
            : ''}
        </div>
      )}

      <div className="space-y-2">
        {notes.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!notes.isLoading && rows.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No notes yet. The agent can also propose notes — look for &ldquo;Suggested
            knowledge&rdquo; cards after its replies.
          </div>
        )}
        {rows.map((n) =>
          editingId === n.id ? (
            <div key={n.id} className="space-y-2 rounded-md border border-border p-3">
              <Input
                value={editTitle}
                maxLength={MAX_NOTE_TITLE_CHARS}
                onChange={(e) => setEditTitle(e.target.value)}
              />
              <Textarea
                value={editBody}
                maxLength={MAX_NOTE_BODY_CHARS}
                rows={4}
                onChange={(e) => setEditBody(e.target.value)}
              />
              <Input
                placeholder="Trigger keywords, comma-separated (optional)"
                value={editTriggers}
                maxLength={500}
                onChange={(e) => setEditTriggers(e.target.value)}
              />
              <div className="flex gap-2">
                <Tip content="Save changes — applies to the next run; running chats restart">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      disabled={!editTitle.trim() || !editBody.trim() || update.isPending}
                      onClick={() =>
                        update.mutate({
                          id: n.id,
                          projectPath,
                          title: editTitle.trim(),
                          body: editBody.trim(),
                          pinned: n.pinned,
                          enabled: n.enabled,
                          triggers: editTriggers.trim() || undefined
                        })
                      }
                    >
                      {update.isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </span>
                </Tip>
                <Tip content="Discard these edits">
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </Tip>
              </div>
            </div>
          ) : (
            <div key={n.id} className="space-y-1.5 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <button
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium cursor-pointer"
                  title={n.title}
                  onClick={() => {
                    setEditingId(n.id)
                    setEditTitle(n.title)
                    setEditBody(n.body)
                    setEditTriggers(n.triggers ?? '')
                  }}
                >
                  {n.title}
                </button>
                {n.source === 'suggested' && (
                  <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    suggested
                  </span>
                )}
                <Tip
                  content={
                    n.pinned
                      ? 'Pinned: included in every run’s system prompt. Click to unpin (fetched on demand instead)'
                      : 'Unpinned: listed by title, body fetched on demand. Click to pin into every prompt'
                  }
                >
                  <span className="inline-flex">
                    <Button
                      size="icon"
                      variant={n.pinned ? 'secondary' : 'ghost'}
                      disabled={mutating}
                      onClick={() =>
                        update.mutate({
                          id: n.id,
                          projectPath,
                          title: n.title,
                          body: n.body,
                          pinned: !n.pinned,
                          enabled: n.enabled,
                          triggers: n.triggers ?? undefined
                        })
                      }
                    >
                      <Pin size={13} />
                    </Button>
                  </span>
                </Tip>
                <Tip
                  content={
                    n.enabled ? 'On — the agent sees this note' : 'Off — hidden from the agent'
                  }
                >
                  <span className="inline-flex">
                    <Switch
                      checked={n.enabled}
                      disabled={mutating}
                      onCheckedChange={(checked) =>
                        update.mutate({
                          id: n.id,
                          projectPath,
                          title: n.title,
                          body: n.body,
                          pinned: n.pinned,
                          enabled: checked,
                          triggers: n.triggers ?? undefined
                        })
                      }
                    />
                  </span>
                </Tip>
                <Tip content="Delete this note permanently">
                  <span className="inline-flex">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={mutating}
                      onClick={() => {
                        void confirmDialog({
                          title: 'Delete knowledge note?',
                          description: `“${n.title}” will be removed. Running chats in this project restart.`,
                          confirmLabel: 'Delete'
                        }).then((ok) => {
                          if (ok) remove.mutate({ id: n.id, projectPath })
                        })
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </span>
                </Tip>
              </div>
              <div className="line-clamp-2 whitespace-pre-wrap text-[11px] text-muted-foreground selectable">
                {n.body}
              </div>
              {n.triggers && !n.pinned && (
                <div className="flex flex-wrap gap-1">
                  {parseTriggers(n.triggers).map((kw) => (
                    <span
                      key={kw}
                      className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      title="Trigger keyword — prompts mentioning it inject this note"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}

/** One editable env-var row in the Environment tab (local state only). */
interface EnvRow {
  key: string
  value: string
  secret: boolean
  reveal: boolean
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_ENV_KEYS = ['PATH', 'YARDARM_BOOT']

function EnvironmentTab({ projectId }: { projectId: string }): React.JSX.Element {
  const utils = trpc.useUtils()
  const stored = trpc.projects.envGet.useQuery({ projectId })
  const [rows, setRows] = useState<EnvRow[] | null>(null)
  const [saved, setSaved] = useState(false)
  const save = trpc.projects.envSet.useMutation({
    onSuccess: () => {
      setSaved(true)
      void utils.projects.envGet.invalidate({ projectId })
    }
  })

  // Seed the editable rows from the stored list once per mount (the tab is
  // keyed by projectId, so a project switch remounts and re-seeds).
  useEffect(() => {
    if (stored.data && rows === null) {
      setRows(
        stored.data.map((v) => ({ key: v.key, value: v.value, secret: !!v.secret, reveal: false }))
      )
    }
  }, [stored.data, rows])

  const list = rows ?? []
  const entries = list.filter((r) => r.key.trim() !== '' || r.value !== '')
  const keys = entries.map((r) => r.key.trim())
  const badKey = keys.find((k) => !ENV_KEY_RE.test(k) || RESERVED_ENV_KEYS.includes(k))
  const hasDuplicates = new Set(keys).size !== keys.length
  const validationError =
    badKey !== undefined
      ? RESERVED_ENV_KEYS.includes(badKey)
        ? `"${badKey}" is reserved by the app`
        : `Invalid name "${badKey}" — use letters, digits, and _ (not starting with a digit)`
      : hasDuplicates
        ? 'Duplicate variable names'
        : null

  function edit(index: number, patch: Partial<EnvRow>): void {
    setSaved(false)
    setRows(list.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        Environment variables added to this project&apos;s agent and terminal processes. Saving
        restarts the project&apos;s active agents; terminals pick changes up on their next session.
        Values are stored in plaintext in the app database — &ldquo;secret&rdquo; only masks them
        here.
      </div>

      {stored.isLoading && rows === null && (
        <div className="text-xs text-muted-foreground">Loading…</div>
      )}

      <div className="space-y-1.5">
        {list.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              placeholder="NAME"
              value={r.key}
              maxLength={100}
              onChange={(e) => edit(i, { key: e.target.value })}
              className="w-40 shrink-0 font-mono text-xs"
            />
            <Input
              placeholder="value"
              type={r.secret && !r.reveal ? 'password' : 'text'}
              value={r.value}
              maxLength={10_000}
              onChange={(e) => edit(i, { value: e.target.value })}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            {r.secret && (
              <Tip content={r.reveal ? 'Hide the value' : 'Show the value'}>
                <button
                  onClick={() => edit(i, { reveal: !r.reveal })}
                  className="rounded p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {r.reveal ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </Tip>
            )}
            <Tip content="Mask this value in the UI (it is still stored in plaintext)">
              <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={r.secret}
                  onChange={(e) => edit(i, { secret: e.target.checked, reveal: false })}
                />
                Secret
              </label>
            </Tip>
            <Tip content="Remove this variable (takes effect on Save)">
              <button
                onClick={() => {
                  setSaved(false)
                  setRows(list.filter((_, j) => j !== i))
                }}
                className="rounded p-1 text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 size={13} />
              </button>
            </Tip>
          </div>
        ))}
        {!stored.isLoading && list.length === 0 && (
          <div className="text-xs text-muted-foreground">No variables yet.</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Tip content="Add an environment variable row">
          <span className="inline-flex">
            <Button
              size="sm"
              variant="outline"
              disabled={rows === null || list.length >= 100}
              onClick={() => {
                setSaved(false)
                setRows([...list, { key: '', value: '', secret: false, reveal: false }])
              }}
            >
              <Plus size={13} className="mr-1" />
              Add variable
            </Button>
          </span>
        </Tip>
        <Tip content="Save the variable list — restarts this project's active agents so running chats pick the values up">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={rows === null || validationError !== null || save.isPending}
              onClick={() =>
                save.mutate({
                  projectId,
                  envVars: entries.map((r) => ({
                    key: r.key.trim(),
                    value: r.value,
                    secret: r.secret || undefined
                  }))
                })
              }
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </span>
        </Tip>
        {saved && !save.isPending && (
          <span className="text-[11px] text-muted-foreground">Saved</span>
        )}
      </div>

      {validationError && (
        <div className="text-xs text-destructive selectable">{validationError}</div>
      )}
      {save.error && (
        <div className="text-xs text-destructive selectable">{save.error.message}</div>
      )}
    </div>
  )
}

export function ProjectSettingsDialog({
  projectId,
  projectPath,
  projectName,
  projectArchived,
  subchatId
}: {
  projectId: string | null
  projectPath: string | null
  projectName: string | null
  projectArchived: boolean
  subchatId: string | null
}): React.JSX.Element {
  const [open, setOpen] = useAtom(projectSettingsOpenAtom)
  const [tab, setTab] = useAtom(projectSettingsTabAtom)

  const tabs: Array<{
    id: ProjectSettingsTab
    label: string
    icon: React.ReactNode
    tip: string
  }> = [
    {
      id: 'general',
      label: 'General',
      icon: <Settings2 size={13} />,
      tip: 'Rename, archive, or remove this project'
    },
    {
      id: 'hooks',
      label: 'Hooks',
      icon: <Webhook size={13} />,
      tip: 'Shell commands run at agent lifecycle events'
    },
    {
      id: 'commands',
      label: 'Commands',
      icon: <FileCode2 size={13} />,
      tip: 'Custom /slash commands from markdown prompt files'
    },
    {
      id: 'instructions',
      label: 'Instructions',
      icon: <BookOpenText size={13} />,
      tip: 'Project-specific instructions prepended to the agent’s system prompt'
    },
    {
      id: 'knowledge',
      label: 'Knowledge',
      icon: <Lightbulb size={13} />,
      tip: 'Durable project notes for the agent — pinned ones ride in every prompt'
    },
    {
      id: 'environment',
      label: 'Environment',
      icon: <Variable size={13} />,
      tip: 'Env vars added to this project’s agent and terminal processes'
    },
    {
      id: 'resource',
      label: 'Resource',
      icon: <Database size={13} />,
      tip: 'Memory resource id — share agent memory across checkouts'
    },
    {
      id: 'plugins',
      label: 'Plugins',
      icon: <Puzzle size={13} />,
      tip: 'Install and manage plugins that add tools, skills, and commands'
    },
    {
      id: 'workflows',
      label: 'Workflows',
      icon: <Workflow size={13} />,
      tip: 'Run and manage reusable multi-step workflows the agent built in chat'
    }
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Project settings{projectName ? ` — ${projectName}` : ''}</DialogTitle>
        {!projectPath ? (
          <div className="text-xs text-muted-foreground">Select a project first.</div>
        ) : (
          <div className="flex gap-4">
            <div className="w-36 shrink-0 space-y-0.5">
              {tabs.map((t) => (
                <Tip key={t.id} content={t.tip} side="right">
                  <button
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs cursor-pointer',
                      tab === t.id ? 'bg-accent font-medium' : 'hover:bg-accent/50'
                    )}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                </Tip>
              ))}
            </div>
            <div className="min-h-64 max-h-[65vh] min-w-0 flex-1 overflow-y-auto pr-1">
              {tab === 'general' && projectId && (
                <GeneralTab
                  projectId={projectId}
                  projectName={projectName}
                  projectPath={projectPath}
                  projectArchived={projectArchived}
                />
              )}
              {tab === 'hooks' && <HooksTab projectPath={projectPath} subchatId={subchatId} />}
              {tab === 'commands' && <CommandsTab projectPath={projectPath} />}
              {tab === 'instructions' && <InstructionsTab projectPath={projectPath} />}
              {tab === 'knowledge' && projectId && (
                <KnowledgeTab projectId={projectId} projectPath={projectPath} />
              )}
              {tab === 'environment' && projectId && (
                <EnvironmentTab key={projectId} projectId={projectId} />
              )}
              {tab === 'resource' && (
                <ResourceTab projectPath={projectPath} subchatId={subchatId} />
              )}
              {tab === 'plugins' && <PluginsTab subchatId={subchatId} projectPath={projectPath} />}
              {tab === 'workflows' && <WorkflowsTab subchatId={subchatId} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
