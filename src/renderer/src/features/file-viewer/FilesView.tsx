/**
 * IDE tab: file tree + editable multi-tab Monaco editor rooted at the chat
 * worktree (or project root). Buffers are uncontrolled (`defaultValue`) with
 * a reconcile effect as the single place model content is set
 * programmatically; clean buffers auto-refresh when the agent changes files
 * on disk (4s poll of the active tab, mtime-compared) and saves go through an
 * mtime conflict check (Overwrite / Reload / Cancel). files.write reports
 * each save to every chat working on this root. Tab state lives in a
 * per-root atom and the view stays mounted, so dirty buffers survive
 * tab/chat switches. When a chat is open, language-server diagnostics for
 * the active file (fetched from its agent host on open/save/external
 * change) feed Monaco markers and a collapsible problems panel.
 */
import React, { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Info,
  RefreshCw,
  Save,
  X,
  XCircle
} from 'lucide-react'
import { useAtom, useAtomValue } from 'jotai'
import type { LspDiagnosticInfo, LspDiagnosticsResult } from '@shared/ipc-types'
import '../../lib/monaco-setup'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { mainTabAtom, themeAtom } from '../../lib/atoms'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import {
  activateTab,
  applyDiskUpdate,
  closeTab,
  editorTabsAtom,
  emptyTabsState,
  markSaved,
  openTab,
  setDirty,
  type TabsState
} from './editor-tabs'

function languageFor(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    sql: 'sql'
  }
  return ext ? map[ext] : undefined
}

function SeverityIcon({
  severity
}: {
  severity: LspDiagnosticInfo['severity']
}): React.JSX.Element {
  if (severity === 'error') return <XCircle size={12} className="shrink-0 text-red-500" />
  if (severity === 'warning')
    return <AlertTriangle size={12} className="shrink-0 text-yellow-500" />
  return <Info size={12} className="shrink-0 text-blue-400" />
}

function DirNode({
  root,
  path,
  name,
  depth,
  selected,
  onSelect
}: {
  root: string
  path: string
  name: string
  depth: number
  selected: string | null
  onSelect: (path: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const children = trpc.files.tree.useQuery({ root, dir: path, depth: 0 }, { enabled: open })

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: depth * 12 + 8 }}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] hover:bg-accent cursor-pointer"
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-muted-foreground" />
        )}
        <Folder size={12} className="shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </button>
      {open && children.isLoading && (
        <div
          style={{ paddingLeft: (depth + 1) * 12 + 8 }}
          className="px-2 py-1 text-[12px] text-muted-foreground"
        >
          Loading…
        </div>
      )}
      {open && children.error && (
        <div
          style={{ paddingLeft: (depth + 1) * 12 + 8 }}
          className="px-2 py-1 text-[12px] text-destructive"
          title={children.error.message}
        >
          Failed to read directory
        </div>
      )}
      {open &&
        (children.data ?? []).map((n) =>
          n.type === 'dir' ? (
            <DirNode
              key={n.path}
              root={root}
              path={n.path}
              name={n.name}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <FileNodeRow
              key={n.path}
              path={n.path}
              name={n.name}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          )
        )}
    </div>
  )
}

function FileNodeRow({
  path,
  name,
  depth,
  selected,
  onSelect
}: {
  path: string
  name: string
  depth: number
  selected: string | null
  onSelect: (path: string) => void
}): React.JSX.Element {
  return (
    <button
      onClick={() => onSelect(path)}
      style={{ paddingLeft: depth * 12 + 8 + 13 }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] cursor-pointer',
        selected === path ? 'bg-accent' : 'hover:bg-accent'
      )}
    >
      <FileText size={12} className="shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </button>
  )
}

export function FilesView({
  root,
  subchatId
}: {
  root: string
  subchatId: string | null
}): React.JSX.Element {
  const theme = useAtomValue(themeAtom)
  const mainTab = useAtomValue(mainTabAtom)
  const confirm = useConfirm()
  const utils = trpc.useUtils()
  const tree = trpc.files.tree.useQuery({ root, dir: '', depth: 0 })
  const write = trpc.files.write.useMutation()
  const [allTabs, setAllTabs] = useAtom(editorTabsAtom)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const saveRef = useRef<() => void>(() => {})
  const [diags, setDiags] = useState<{
    path: string
    result: LspDiagnosticsResult
    loading: boolean
  } | null>(null)
  const [problemsOpen, setProblemsOpen] = useState(false)
  const diagSeq = useRef(0)
  // Bumped when Monaco mounts so the marker effect re-runs: diagnostics can
  // arrive before the first editor instance exists.
  const [editorEpoch, setEditorEpoch] = useState(0)

  const state = allTabs[root] ?? emptyTabsState
  const activeTab = state.tabs.find((t) => t.path === state.activePath) ?? null

  const update = (fn: (s: TabsState) => TabsState): void => {
    setAllTabs((prev) => {
      const cur = prev[root] ?? emptyTabsState
      const next = fn(cur)
      return next === cur ? prev : { ...prev, [root]: next }
    })
  }

  const openFile = async (path: string): Promise<void> => {
    if (state.tabs.some((t) => t.path === path)) {
      update((s) => activateTab(s, path))
      return
    }
    try {
      const data = await utils.files.read.fetch({ root, path })
      update((s) =>
        openTab(s, {
          path,
          kind: data.binary ? 'binary' : data.tooLarge ? 'tooLarge' : 'text',
          savedContent: data.content ?? '',
          mtimeMs: data.mtimeMs,
          dirty: false
        })
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Language-server diagnostics for the active file, fetched from the chat's
  // agent host (whose cwd is this root). Sequenced so a stale response can't
  // overwrite a newer file's results.
  const refreshDiagnostics = async (path: string): Promise<void> => {
    if (!subchatId) return
    const seq = ++diagSeq.current
    setDiags((d) => ({
      path,
      result: d?.path === path ? d.result : { diagnostics: [] },
      loading: true
    }))
    try {
      const result = await utils.files.diagnostics.fetch({ subchatId, root, path })
      if (seq === diagSeq.current) setDiags({ path, result, loading: false })
    } catch (err) {
      if (seq === diagSeq.current) {
        setDiags({
          path,
          result: {
            diagnostics: [],
            unavailableReason: err instanceof Error ? err.message : String(err)
          },
          loading: false
        })
      }
    }
  }

  // Also refresh the read-query cache, or the poller's stale entry (old
  // content, old mtime) would look like an external change right after the
  // save and briefly revert the buffer.
  const recordSaved = (path: string, content: string, mtimeMs: number): void => {
    utils.files.read.setData(
      { root, path },
      { path, content, tooLarge: false, binary: false, mtimeMs }
    )
    update((s) => markSaved(s, path, content, mtimeMs))
    void refreshDiagnostics(path)
  }

  const save = async (): Promise<void> => {
    if (!activeTab || activeTab.kind !== 'text' || !activeTab.dirty) return
    const ed = editorRef.current
    if (!ed) return
    const path = activeTab.path
    const content = ed.getValue()
    try {
      const res = await write.mutateAsync({
        root,
        path,
        content,
        baseMtimeMs: activeTab.mtimeMs
      })
      if (res.ok) {
        recordSaved(path, content, res.mtimeMs)
        return
      }
      const deleted = res.mtimeMs === null
      const overwrite = await confirm({
        title: deleted ? 'File was deleted on disk' : 'File changed on disk',
        description:
          'Another process (likely the agent) modified this file since you opened it. ' +
          'Overwrite it with your version?',
        confirmLabel: 'Overwrite'
      })
      if (overwrite) {
        // No baseMtimeMs: force the write past the conflict check.
        const forced = await write.mutateAsync({ root, path, content })
        if (forced.ok) recordSaved(path, content, forced.mtimeMs)
        return
      }
      if (!deleted) {
        const reload = await confirm({
          title: 'Reload from disk?',
          description: 'Discard your edits and load the version currently on disk.',
          confirmLabel: 'Reload'
        })
        if (reload) {
          const fresh = await utils.files.read.fetch({ root, path })
          const freshContent = fresh.content
          if (freshContent !== null) {
            update((s) => applyDiskUpdate(s, path, freshContent, fresh.mtimeMs, true))
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => {
    saveRef.current = () => void save()
  })

  const requestClose = async (path: string): Promise<void> => {
    const tab = state.tabs.find((t) => t.path === path)
    if (!tab) return
    if (tab.dirty) {
      const ok = await confirm({
        title: 'Discard unsaved changes?',
        description: `${path} has unsaved edits.`,
        confirmLabel: 'Discard'
      })
      if (!ok) return
    }
    update((s) => closeTab(s, path))
  }

  // Watch the active file for external changes (usually the agent). Clean
  // buffers adopt the disk version; dirty buffers are left alone and the
  // conflict is surfaced at save time. Paused while the IDE tab is hidden.
  const poll = trpc.files.read.useQuery(
    { root, path: activeTab?.path ?? '' },
    {
      enabled: activeTab?.kind === 'text',
      refetchInterval: mainTab === 'files' ? 4000 : false
    }
  )
  useEffect(() => {
    const data = poll.data
    if (!data || !activeTab || activeTab.kind !== 'text') return
    if (data.path !== activeTab.path || data.content === null) return
    if (activeTab.dirty || data.mtimeMs === activeTab.mtimeMs) return
    const content = data.content
    update((s) => applyDiskUpdate(s, data.path, content, data.mtimeMs))
    // The file changed on disk (usually the agent) — markers are stale now.
    void refreshDiagnostics(data.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- update is stable per render
  }, [poll.data, activeTab])

  // Fetch diagnostics when a text file becomes active.
  const activePath = activeTab?.kind === 'text' ? activeTab.path : null
  useEffect(() => {
    if (!activePath || !subchatId) {
      setDiags(null)
      return
    }
    void refreshDiagnostics(activePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only on file/chat/root switch
  }, [activePath, subchatId, root])

  // Project the active file's diagnostics onto its Monaco model as markers.
  const activeDiags = diags && diags.path === activePath ? diags : null
  useEffect(() => {
    const monaco = monacoRef.current
    const model = editorRef.current?.getModel()
    if (!monaco || !model) return
    const severities: Record<LspDiagnosticInfo['severity'], number> = {
      error: monaco.MarkerSeverity.Error,
      warning: monaco.MarkerSeverity.Warning,
      info: monaco.MarkerSeverity.Info,
      hint: monaco.MarkerSeverity.Hint
    }
    const list = activeDiags && !activeDiags.loading ? activeDiags.result.diagnostics : []
    monaco.editor.setModelMarkers(
      model,
      'yardarm-lsp',
      list.map((d) => ({
        startLineNumber: d.line,
        startColumn: d.col,
        endLineNumber: d.endLine,
        endColumn: d.endCol,
        severity: severities[d.severity],
        message: d.message,
        ...(d.source ? { source: d.source } : {})
      }))
    )
  }, [activeDiags, activePath, editorEpoch])

  // Reconcile effect: the single place buffer content is set programmatically.
  // Covers external refreshes, reload-from-disk, and reopening a path whose
  // stale global Monaco model outlived its closed tab.
  useEffect(() => {
    if (!activeTab || activeTab.kind !== 'text' || activeTab.dirty) return
    const model = editorRef.current?.getModel()
    if (model && model.getValue() !== activeTab.savedContent) {
      model.setValue(activeTab.savedContent)
    }
  }, [activeTab])

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    setEditorEpoch((n) => n + 1)
    // Registered on the editor (not window) so an always-mounted IDE view
    // can't steal Cmd+S while another main tab is visible.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
  }

  const problems = activeDiags && !activeDiags.loading ? activeDiags.result.diagnostics : []
  const errorCount = problems.filter((d) => d.severity === 'error').length
  const warningCount = problems.filter((d) => d.severity === 'warning').length
  const unavailable =
    activeDiags && !activeDiags.loading ? activeDiags.result.unavailableReason : undefined

  const goToProblem = (d: LspDiagnosticInfo): void => {
    const ed = editorRef.current
    if (!ed) return
    ed.setPosition({ lineNumber: d.line, column: d.col })
    ed.revealPositionInCenter({ lineNumber: d.line, column: d.col })
    ed.focus()
  }

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border py-1">
        {tree.error && (
          <div className="px-3 py-2 text-[12px] text-destructive">
            Failed to read project folder: {tree.error.message}
          </div>
        )}
        {(tree.data ?? []).map((n) =>
          n.type === 'dir' ? (
            <DirNode
              key={n.path}
              root={root}
              path={n.path}
              name={n.name}
              depth={0}
              selected={state.activePath}
              onSelect={(p) => void openFile(p)}
            />
          ) : (
            <FileNodeRow
              key={n.path}
              path={n.path}
              name={n.name}
              depth={0}
              selected={state.activePath}
              onSelect={(p) => void openFile(p)}
            />
          )
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {state.tabs.length > 0 && (
          <div className="flex h-8 shrink-0 items-center border-b border-border">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
              {state.tabs.map((t) => (
                <div
                  key={t.path}
                  className={cn(
                    'group flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[12px]',
                    state.activePath === t.path ? 'bg-accent' : 'hover:bg-accent/50'
                  )}
                >
                  <Tip content={t.path}>
                    <button
                      onClick={() => update((s) => activateTab(s, t.path))}
                      className="cursor-pointer truncate"
                    >
                      {t.path.split('/').pop()}
                    </button>
                  </Tip>
                  <Tip content={t.dirty ? 'Close (unsaved changes)' : 'Close'}>
                    <button
                      onClick={() => void requestClose(t.path)}
                      className="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {t.dirty ? (
                        <>
                          <span className="text-[9px] group-hover:hidden">●</span>
                          <X size={11} className="hidden group-hover:block" />
                        </>
                      ) : (
                        <X size={11} />
                      )}
                    </button>
                  </Tip>
                </div>
              ))}
            </div>
            <div className="px-1.5">
              <Tip content="Save the active file to disk (⌘S)">
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={!activeTab?.dirty || write.isPending}
                    onClick={() => saveRef.current()}
                  >
                    <Save size={13} />
                  </Button>
                </span>
              </Tip>
            </div>
          </div>
        )}
        {error && (
          <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <Tip content="Dismiss this error">
              <button
                onClick={() => setError(null)}
                className="cursor-pointer rounded p-0.5 hover:bg-destructive/20"
              >
                <X size={12} />
              </button>
            </Tip>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {activeTab ? (
            activeTab.kind === 'binary' ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Binary file
              </div>
            ) : activeTab.kind === 'tooLarge' ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                File too large to edit
              </div>
            ) : (
              <Editor
                height="100%"
                path={`${root}/${activeTab.path}`}
                defaultLanguage={languageFor(activeTab.path)}
                defaultValue={activeTab.savedContent}
                theme={theme === 'light' ? 'vs' : 'vs-dark'}
                onMount={handleMount}
                onChange={(v) => {
                  const val = v ?? ''
                  update((s) => {
                    const tab = s.tabs.find((t) => t.path === activeTab.path)
                    if (!tab) return s
                    return setDirty(s, tab.path, val !== tab.savedContent)
                  })
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  renderWhitespace: 'none'
                }}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Select a file to edit
            </div>
          )}
        </div>
        {subchatId && activeTab?.kind === 'text' && (
          <div className="shrink-0 border-t border-border">
            <div className="flex h-7 items-center gap-1 px-1.5">
              <Tip content={problemsOpen ? 'Hide the problems list' : 'Show the problems list'}>
                <button
                  onClick={() => setProblemsOpen((o) => !o)}
                  className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] hover:bg-accent"
                >
                  {problemsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {activeDiags?.loading ? (
                    <span className="text-muted-foreground">Checking…</span>
                  ) : unavailable ? (
                    <span className="truncate text-muted-foreground">Diagnostics unavailable</span>
                  ) : problems.length === 0 ? (
                    <>
                      <CheckCircle2 size={12} className="text-green-500" />
                      <span className="text-muted-foreground">No problems</span>
                    </>
                  ) : (
                    <>
                      {errorCount > 0 && (
                        <span className="flex items-center gap-1">
                          <XCircle size={12} className="text-red-500" />
                          {errorCount}
                        </span>
                      )}
                      {warningCount > 0 && (
                        <span className="flex items-center gap-1">
                          <AlertTriangle size={12} className="text-yellow-500" />
                          {warningCount}
                        </span>
                      )}
                      {problems.length - errorCount - warningCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Info size={12} className="text-blue-400" />
                          {problems.length - errorCount - warningCount}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </Tip>
              <div className="flex-1" />
              <Tip content="Re-run language-server diagnostics for this file">
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    disabled={activeDiags?.loading ?? false}
                    onClick={() => activeTab && void refreshDiagnostics(activeTab.path)}
                  >
                    <RefreshCw size={11} className={cn(activeDiags?.loading && 'animate-spin')} />
                  </Button>
                </span>
              </Tip>
            </div>
            {problemsOpen && (
              <div className="max-h-40 overflow-y-auto border-t border-border py-0.5">
                {unavailable ? (
                  <div className="px-3 py-1.5 text-[11px] text-muted-foreground">{unavailable}</div>
                ) : problems.length === 0 ? (
                  <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
                    {activeDiags?.loading
                      ? 'Waiting for the language server…'
                      : 'No problems reported for this file.'}
                  </div>
                ) : (
                  problems.map((d, i) => (
                    <Tip key={i} content={d.message}>
                      <button
                        onClick={() => goToProblem(d)}
                        className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-0.5 text-left text-[11px] hover:bg-accent"
                      >
                        <SeverityIcon severity={d.severity} />
                        <span className="min-w-0 flex-1 truncate">{d.message}</span>
                        {d.source && (
                          <span className="shrink-0 text-muted-foreground">{d.source}</span>
                        )}
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {d.line}:{d.col}
                        </span>
                      </button>
                    </Tip>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
