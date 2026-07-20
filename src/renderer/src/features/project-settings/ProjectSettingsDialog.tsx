/**
 * Per-project .mastracode configuration: MCP servers, hooks, custom .md
 * commands, agent instructions, memory resource id, and loaded plugins.
 * Opened from the Sidebar gear or /hooks /commands /resource /skills.
 */
import React, { useEffect, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  BookOpenText,
  Database,
  ExternalLink,
  FileCode2,
  Puzzle,
  Server,
  Settings2,
  Trash2,
  Webhook
} from 'lucide-react'
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
import { Textarea } from '../../components/ui/textarea'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'

function GeneralTab({
  projectId,
  projectName,
  projectPath
}: {
  projectId: string
  projectName: string | null
  projectPath: string
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const setOpen = useSetAtom(projectSettingsOpenAtom)
  const setSelectedProjectId = useSetAtom(selectedProjectIdAtom)
  const setChatId = useSetAtom(selectedChatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const confirmDialog = useConfirm()
  const [name, setName] = useState(projectName ?? '')

  // The dialog is shared across projects — resync when the target changes.
  useEffect(() => {
    setName(projectName ?? '')
  }, [projectName])

  const rename = trpc.projects.rename.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
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

      <div className="space-y-2 rounded-md border border-destructive/40 p-3">
        <div className="text-xs font-medium text-destructive">Danger zone</div>
        <div className="text-[11px] text-muted-foreground">
          Removing the project deletes all its chats and their git worktrees, and stops any
          running agents and terminals. The project folder itself is not deleted.
        </div>
        <Tip content="Remove this project from Yardarm — deletes its chats and worktrees, keeps the folder on disk">
          <span className="inline-flex">
            <Button
          size="sm"
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => {
            void confirmDialog({
              title: 'Remove project?',
              description: `"${projectName ?? projectPath}" will be removed from Yardarm along with all its chats and worktrees. The folder on disk is kept.`,
              confirmLabel: 'Remove project'
            }).then((ok) => {
              if (ok) remove.mutate({ id: projectId })
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

function McpTab({ projectPath }: { projectPath: string }): React.JSX.Element {
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
        Edits <code>.mastracode/mcp.json</code> in this project (merged over global servers).
        This project&apos;s agents restart on save.
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
        Edits <code>.mastracode/hooks.json</code> — shell commands run at lifecycle events
        (global hooks run first). Events: {hooks.data?.validEvents.join(', ')}
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
        The resource id tags this project&apos;s memory (threads, observations). Set the same id
        in two checkouts to share memory between them. Stored in{' '}
        <code>.mastracode/database.json</code>; this project&apos;s agents restart on save.
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
                <PluginConfigRow subchatId={subchatId} pluginId={p.id} scope={scope} />
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
  subchatId
}: {
  projectId: string | null
  projectPath: string | null
  projectName: string | null
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
      tip: 'Rename or remove this project'
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
                />
              )}
              {tab === 'mcp' && <McpTab projectPath={projectPath} />}
              {tab === 'hooks' && <HooksTab projectPath={projectPath} subchatId={subchatId} />}
              {tab === 'commands' && <CommandsTab projectPath={projectPath} />}
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
