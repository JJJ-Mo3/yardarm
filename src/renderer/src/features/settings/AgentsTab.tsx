/**
 * Custom subagents editor (Settings → Agents). Manages the .md definitions
 * in ~/.mastracode/agents (global, the default scope) and per-project
 * .mastracode/agents (picked from existing projects) that the main agent can
 * delegate tasks to via the `subagent` tool. Saving restarts the affected
 * agent hosts so definitions take effect. A Templates section lists the
 * built-in catalog (team roles + domain specialists) with one-click add;
 * added templates become ordinary editable files and existing files are
 * never overwritten.
 */
import React, { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { selectedProjectIdAtom } from '../../lib/atoms'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'
import { ModelSelect } from '../../components/ModelSelect'
import { useConfirm } from '../../components/ConfirmDialog'

type Scope = 'global' | 'project'

const TEMPLATE_GROUPS = [
  ['role', 'Role subagents'],
  ['specialist', 'Domain specialists']
] as const

interface EditorState {
  name: string
  description: string
  instructions: string
  model: string
  maxSteps: string
  forked: boolean
}

const EMPTY_EDITOR: EditorState = {
  name: '',
  description: '',
  instructions: '',
  model: '',
  maxSteps: '',
  forked: false
}

export function AgentsTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const confirmDialog = useConfirm()
  const currentProjectId = useAtomValue(selectedProjectIdAtom)
  const [scope, setScope] = useState<Scope>('global')
  const [projectId, setProjectId] = useState<string | null>(currentProjectId)
  const [selected, setSelected] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR)
  const [dirty, setDirty] = useState(false)
  const [newId, setNewId] = useState('')

  const projects = trpc.projects.list.useQuery()
  const activeProjects = (projects.data ?? []).filter((p) => !p.archived)
  const project = activeProjects.find((p) => p.id === projectId) ?? null
  const projectPath = project?.path
  const scopeReady = scope === 'global' || !!projectPath

  const scopeInput = { scope, projectPath: scope === 'project' ? projectPath : undefined }
  const list = trpc.projectConfig.agentsList.useQuery(scopeInput, { enabled: scopeReady })
  const catalog = trpc.projectConfig.agentDefaultsCatalog.useQuery(undefined, {
    staleTime: Infinity
  })
  const models = trpc.agent.listModels.useQuery(undefined, { staleTime: 60_000 })
  const file = trpc.projectConfig.agentRead.useQuery(
    { ...scopeInput, id: selected ?? '' },
    { enabled: selected !== null && scopeReady }
  )
  useEffect(() => {
    if (file.data && !dirty) {
      const p = file.data.parsed
      setEditor({
        name: p?.name ?? selected ?? '',
        description: p?.description ?? '',
        instructions: p?.instructions ?? '',
        model: p?.model ?? '',
        maxSteps: p?.maxSteps ? String(p.maxSteps) : '',
        forked: p?.forked ?? false
      })
    }
  }, [file.data, dirty, selected])

  const invalidate = (): void => {
    utils.projectConfig.agentsList.invalidate()
  }
  const write = trpc.projectConfig.agentWrite.useMutation({
    onSuccess: () => {
      setDirty(false)
      utils.projectConfig.agentRead.invalidate()
      invalidate()
    }
  })
  const create = trpc.projectConfig.agentCreate.useMutation({
    onSuccess: (info) => {
      setNewId('')
      invalidate()
      selectAgent(info.id)
    }
  })
  const remove = trpc.projectConfig.agentDelete.useMutation({
    onSuccess: () => {
      setSelected(null)
      invalidate()
    }
  })
  const openInEditor = trpc.projectConfig.openInEditor.useMutation()
  const installDefaults = trpc.projectConfig.agentsInstallDefaults.useMutation({
    onSuccess: () => invalidate()
  })

  const selectAgent = (id: string): void => {
    setSelected(id)
    setDirty(false)
    setEditor(EMPTY_EDITOR)
  }
  const addTemplates = (ids: string[]): void => {
    installDefaults.mutate(
      { ...scopeInput, ids },
      { onSuccess: () => (ids.length === 1 ? selectAgent(ids[0]) : undefined) }
    )
  }
  const switchScope = (next: Scope): void => {
    setScope(next)
    setSelected(null)
    setDirty(false)
  }
  const switchProject = (id: string): void => {
    setProjectId(id)
    setSelected(null)
    setDirty(false)
  }
  const edit = (patch: Partial<EditorState>): void => {
    setEditor((e) => ({ ...e, ...patch }))
    setDirty(true)
  }

  const installedIds = new Set((list.data ?? []).map((a) => a.id))
  const templates = (catalog.data ?? []).filter((t) => !installedIds.has(t.id))

  const maxStepsNum = Number.parseInt(editor.maxSteps, 10)
  const save = (): void => {
    if (!selected) return
    write.mutate({
      ...scopeInput,
      id: selected,
      name: editor.name.trim() || selected,
      description: editor.description.trim(),
      instructions: editor.instructions,
      model: editor.model || undefined,
      maxSteps: Number.isInteger(maxStepsNum) && maxStepsNum > 0 ? maxStepsNum : undefined,
      forked: editor.forked || undefined
    })
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        Markdown files in <code>~/.mastracode/agents/</code> (global) or a project&apos;s{' '}
        <code>.mastracode/agents/</code> define <b>subagents</b> — helpers the main agent can
        delegate tasks to (it picks one by its description via the <code>subagent</code> tool).
      </div>
      <div className="flex items-center gap-1">
        {(
          [
            ['global', 'Global', 'Agents in ~/.mastracode/agents — available in every project'],
            ['project', 'Project', "Agents in a project's .mastracode/agents — that project only"]
          ] as Array<[Scope, string, string]>
        ).map(([id, label, tip]) => (
          <Tip key={id} content={tip}>
            <button
              onClick={() => switchScope(id)}
              className={cn(
                'rounded px-2 py-1 text-[11px] cursor-pointer',
                scope === id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50'
              )}
            >
              {label}
            </button>
          </Tip>
        ))}
        {scope === 'project' && activeProjects.length > 0 && (
          <Tip content="Which project's .mastracode/agents to manage">
            <span className="inline-flex">
              <select
                value={project?.id ?? ''}
                onChange={(e) => switchProject(e.target.value)}
                className="ml-1 rounded border border-border bg-background px-2 py-1 text-[11px]"
              >
                {!project && <option value="">Select a project…</option>}
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id} title={p.path}>
                    {p.name}
                  </option>
                ))}
              </select>
            </span>
          </Tip>
        )}
      </div>
      {!scopeReady && (
        <div className="px-2 py-2 text-[11px] text-muted-foreground">
          {activeProjects.length === 0
            ? 'No projects yet — add a project first to create project-specific subagents.'
            : 'Select a project to manage its subagents.'}
        </div>
      )}
      <div className="space-y-1">
        {scopeReady &&
          (list.data ?? []).map((a) => (
            <div
              key={a.id}
              className={cn(
                'group flex cursor-pointer items-center gap-2 rounded px-2 py-1',
                selected === a.id ? 'bg-accent' : 'hover:bg-accent/50'
              )}
              onClick={() => selectAgent(a.id)}
            >
              <span className="font-mono text-[11px]">{a.id}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                {a.description ?? ''}
              </span>
              <Tip content="Open this agent file in your system editor">
                <button
                  className="hidden group-hover:block text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    openInEditor.mutate({ path: a.path })
                  }}
                >
                  <ExternalLink size={11} />
                </button>
              </Tip>
              <Tip content="Delete this subagent — the agent hosts restart without it">
                <button
                  className="hidden group-hover:block text-muted-foreground hover:text-destructive cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    void confirmDialog({
                      title: `Delete subagent "${a.id}"?`,
                      description:
                        'The definition file will be removed and the affected agent hosts restarted.',
                      confirmLabel: 'Delete'
                    }).then((ok) => {
                      if (ok) remove.mutate({ ...scopeInput, id: a.id })
                    })
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </Tip>
            </div>
          ))}
        {scopeReady && (list.data ?? []).length === 0 && (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">
            No custom subagents yet — create one below, or add a ready-made one from the templates.
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="new-agent-id"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          className="font-mono text-[11px]"
        />
        <Tip content="Create a new subagent definition file (ids explore/plan/execute/general are reserved)">
          <span className="inline-flex">
            <Button
              size="sm"
              disabled={!newId.trim() || !scopeReady || create.isPending}
              onClick={() => create.mutate({ ...scopeInput, id: newId.trim() })}
            >
              Create
            </Button>
          </span>
        </Tip>
      </div>
      {scopeReady && templates.length > 0 && (
        <div className="space-y-1 pt-2">
          <div className="text-[11px] font-medium">Templates</div>
          <div className="text-[10px] text-muted-foreground">
            Ready-made subagents, added to{' '}
            {scope === 'global' ? (
              <code>~/.mastracode/agents</code>
            ) : (
              <code>.mastracode/agents</code>
            )}{' '}
            as ordinary files you can edit like any other agent. Adding restarts{' '}
            {scope === 'project' ? "this project's" : 'all'} agent hosts.
          </div>
          {TEMPLATE_GROUPS.map(([group, label]) => {
            const entries = templates.filter((t) => t.group === group)
            if (entries.length === 0) return null
            return (
              <div key={group} className="space-y-0.5">
                <div className="flex items-center justify-between pt-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <Tip
                    content={`Add all ${entries.length} remaining ${label.toLowerCase()} — existing agents are never overwritten`}
                  >
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-2 text-[10px]"
                        disabled={installDefaults.isPending}
                        onClick={() => addTemplates(entries.map((t) => t.id))}
                      >
                        Add all
                      </Button>
                    </span>
                  </Tip>
                </div>
                {entries.map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/50"
                  >
                    <span className="font-mono text-[11px]">{t.id}</span>
                    <span
                      className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
                      title={t.description}
                    >
                      {t.description}
                    </span>
                    <Tip
                      content={`Add the ${t.name} template as an editable ${t.id}.md — the agent hosts restart with it`}
                    >
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 gap-1 px-2 text-[10px]"
                          disabled={installDefaults.isPending}
                          onClick={() => addTemplates([t.id])}
                        >
                          <Plus size={10} />
                          Add
                        </Button>
                      </span>
                    </Tip>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {selected !== null && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="font-mono text-[10px] text-muted-foreground">{selected}.md</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-[11px] font-medium">Name</div>
              <Input
                value={editor.name}
                onChange={(e) => edit({ name: e.target.value })}
                placeholder={selected}
                className="text-[11px]"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-medium">Max steps</div>
              <Input
                type="number"
                min={1}
                value={editor.maxSteps}
                onChange={(e) => edit({ maxSteps: e.target.value })}
                placeholder="(default)"
                className="text-[11px]"
              />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium">Description</div>
            <Input
              value={editor.description}
              onChange={(e) => edit({ description: e.target.value })}
              placeholder="When should the main agent delegate to this subagent?"
              className="text-[11px]"
            />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium">Model</div>
            <ModelSelect
              value={editor.model}
              onChange={(model) => edit({ model })}
              models={models.data ?? []}
              placeholder="(default: chat model)"
            />
          </div>
          <div className="flex items-center gap-2">
            <Tip content="Forked subagents inherit the parent conversation so far; instructions and model above are ignored">
              <span className="inline-flex">
                <Switch checked={editor.forked} onCheckedChange={(forked) => edit({ forked })} />
              </span>
            </Tip>
            <span className="text-[11px]">Forked — inherits the parent conversation</span>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium">Instructions</div>
            <Textarea
              rows={10}
              value={editor.instructions}
              onChange={(e) => edit({ instructions: e.target.value })}
              className="font-mono text-[11px]"
              spellCheck={false}
            />
          </div>
          <Tip content="Write the definition and restart the affected agent hosts">
            <span className="inline-flex">
              <Button
                size="sm"
                disabled={!dirty || !editor.description.trim() || write.isPending}
                onClick={save}
              >
                {write.isPending ? 'Saving…' : 'Save'}
              </Button>
            </span>
          </Tip>
          <div className="text-[10px] text-muted-foreground">
            Saving restarts {scope === 'project' ? "this project's" : 'all'} agent hosts so the new
            definition takes effect.
          </div>
        </div>
      )}
      {(create.error ?? write.error ?? remove.error ?? installDefaults.error) && (
        <div className="text-xs text-destructive selectable">
          {(create.error ?? write.error ?? remove.error ?? installDefaults.error)?.message}
        </div>
      )}
    </div>
  )
}
