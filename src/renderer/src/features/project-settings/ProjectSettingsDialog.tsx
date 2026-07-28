/**
 * Per-project .mastracode configuration: MCP servers, hooks, custom .md
 * commands, agent instructions, memory resource id, and loaded plugins.
 * Opened from the Sidebar gear or /hooks /commands /resource /skills.
 */
import React, { useEffect, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  BookOpenText,
  Bot,
  Database,
  ExternalLink,
  FileCode2,
  Puzzle,
  Server,
  Settings2,
  Trash2,
  Webhook
} from 'lucide-react'
import type { PluginConfigOption, RepoHostSetting } from '@shared/ipc-types'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
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
import { AgentsTab } from './AgentsTab'

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
 * Live per-server MCP status from this chat's agent, with OAuth actions for
 * servers that require authentication (SDK 1.0.1 MCP OAuth support).
 */
function McpStatusSection({ subchatId }: { subchatId: string | null }): React.JSX.Element {
  const utils = trpc.useUtils()
  const status = trpc.mcp.status.useQuery(
    { subchatId: subchatId ?? '' },
    { enabled: !!subchatId, refetchInterval: 5000 }
  )
  // Fallback links for in-flight OAuth flows (main already opened the browser).
  const [authUrls, setAuthUrls] = useState<Record<string, string>>({})
  trpc.mcp.onAuthUrl.useSubscription(undefined, {
    onData: (ev) => setAuthUrls((prev) => ({ ...prev, [ev.serverName]: ev.url }))
  })
  const invalidate = (): void => {
    if (subchatId) utils.mcp.status.invalidate({ subchatId })
  }
  const authenticate = trpc.mcp.authenticate.useMutation({ onSettled: invalidate })
  const cancelAuth = trpc.mcp.cancelAuth.useMutation({ onSettled: invalidate })
  const reconnect = trpc.mcp.reconnect.useMutation({ onSettled: invalidate })

  if (!subchatId) {
    return (
      <div className="rounded border border-border px-2 py-1.5 text-[11px] text-muted-foreground">
        Open a chat in this project to query live MCP server status.
      </div>
    )
  }
  const servers = status.data ?? []
  return (
    <div className="space-y-1.5">
      {status.error && (
        <div className="text-xs text-destructive selectable">{status.error.message}</div>
      )}
      {servers.length === 0 && !status.isLoading && !status.error && (
        <div className="text-[11px] text-muted-foreground">
          No MCP servers loaded by this chat&apos;s agent.
        </div>
      )}
      {servers.map((s) => {
        // The SDK resolves authentication with a status instead of rejecting;
        // a user-cancelled flow carries cancelled so its error isn't alarming.
        const statusEl = s.connecting ? (
          <span className="text-muted-foreground">Connecting…</span>
        ) : s.connected ? (
          <span className="text-green-600 dark:text-green-500">
            Connected · {s.toolCount} tool{s.toolCount === 1 ? '' : 's'}
          </span>
        ) : s.authenticating ? (
          <span className="text-amber-600 dark:text-amber-500">Authenticating…</span>
        ) : s.needsAuth ? (
          <span className="text-amber-600 dark:text-amber-500">Needs authentication</span>
        ) : s.cancelled ? (
          <span className="text-muted-foreground">Authentication cancelled</span>
        ) : s.error ? (
          <span className="text-destructive" title={s.error}>
            {s.error.length > 80 ? `${s.error.slice(0, 80)}…` : s.error}
          </span>
        ) : (
          <span className="text-muted-foreground">Not connected</span>
        )
        return (
          <div key={s.name} className="rounded border border-border px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={s.name}>
                {s.name}
              </span>
              <span className="text-[10px] text-muted-foreground">{s.transport}</span>
              {s.needsAuth && !s.authenticating && (
                <Tip content="Run the OAuth flow for this server in your browser, then reconnect it">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={authenticate.isPending}
                      onClick={() => authenticate.mutate({ subchatId, serverName: s.name })}
                    >
                      Authenticate
                    </Button>
                  </span>
                </Tip>
              )}
              {s.authenticating && (
                <Tip content="Cancel the pending authentication — the server returns to “needs authentication” and can be retried">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={cancelAuth.isPending}
                      onClick={() => cancelAuth.mutate({ subchatId, serverName: s.name })}
                    >
                      Cancel
                    </Button>
                  </span>
                </Tip>
              )}
              {!s.connected && !s.needsAuth && !s.authenticating && !s.connecting && (
                <Tip content="Retry the connection to this server">
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={reconnect.isPending}
                      onClick={() => reconnect.mutate({ subchatId, serverName: s.name })}
                    >
                      Reconnect
                    </Button>
                  </span>
                </Tip>
              )}
            </div>
            <div className="mt-0.5 text-[10px]">{statusEl}</div>
            {s.authenticating && authUrls[s.name] && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                Browser didn&apos;t open?{' '}
                <a
                  href={authUrls[s.name]}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  Open the authorization page
                </a>
              </div>
            )}
          </div>
        )
      })}
      {(authenticate.error ?? cancelAuth.error ?? reconnect.error) && (
        <div className="text-xs text-destructive selectable">
          {(authenticate.error ?? cancelAuth.error ?? reconnect.error)?.message}
        </div>
      )}
    </div>
  )
}

function McpTab({
  projectPath,
  subchatId
}: {
  projectPath: string
  subchatId: string | null
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const servers = trpc.mcp.get.useQuery({ projectPath })
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (servers.data && !dirty) setText(JSON.stringify(servers.data, null, 2))
  }, [servers.data, dirty])

  const save = trpc.mcp.set.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.mcp.get.invalidate({ projectPath })
    }
  })

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        Edits <code>.mastracode/mcp.json</code> in this project (merged over global servers). This
        project&apos;s agents restart on save.
      </div>
      <Textarea
        rows={14}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
          setError(null)
        }}
        className="font-mono text-[11px]"
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <Tip content="Write .mastracode/mcp.json and restart this project's agents so the servers load">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => {
                try {
                  const parsed = JSON.parse(text) as Record<string, Record<string, unknown>>
                  save.mutate({ servers: parsed, projectPath })
                } catch {
                  setError('Invalid JSON')
                }
              }}
            >
              Save & restart agents
            </Button>
          </span>
        </Tip>
        {error && <span className="text-xs text-destructive">{error}</span>}
        {save.error && (
          <span className="text-xs text-destructive selectable">{save.error.message}</span>
        )}
      </div>
      <div className="pt-1 text-xs font-medium">Server status</div>
      <McpStatusSection subchatId={subchatId} />
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

function PluginsTab({ subchatId }: { subchatId: string | null }): React.JSX.Element {
  const utils = trpc.useUtils()
  const plugins = trpc.projectConfig.pluginsList.useQuery(
    { subchatId: subchatId ?? '' },
    { enabled: !!subchatId }
  )
  const [source, setSource] = useState<'local' | 'github'>('local')
  const [pathOrUrl, setPathOrUrl] = useState('')
  const [installScope, setInstallScope] = useState<'global' | 'project'>('project')
  const [configFor, setConfigFor] = useState<string | null>(null)
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
      id: 'mcp',
      label: 'MCP Servers',
      icon: <Server size={13} />,
      tip: 'External tool servers this project’s agents connect to'
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
      id: 'agents',
      label: 'Agents',
      icon: <Bot size={13} />,
      tip: 'Custom subagents the main agent can delegate tasks to'
    },
    {
      id: 'instructions',
      label: 'Instructions',
      icon: <BookOpenText size={13} />,
      tip: 'Project-specific instructions prepended to the agent’s system prompt'
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
              {tab === 'mcp' && <McpTab projectPath={projectPath} subchatId={subchatId} />}
              {tab === 'hooks' && <HooksTab projectPath={projectPath} subchatId={subchatId} />}
              {tab === 'commands' && <CommandsTab projectPath={projectPath} />}
              {tab === 'agents' && <AgentsTab projectPath={projectPath} />}
              {tab === 'instructions' && <InstructionsTab projectPath={projectPath} />}
              {tab === 'resource' && (
                <ResourceTab projectPath={projectPath} subchatId={subchatId} />
              )}
              {tab === 'plugins' && <PluginsTab subchatId={subchatId} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
