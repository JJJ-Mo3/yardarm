import React, { useEffect } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { FileCode2, FolderGit2, GitCompare, MessageSquare, Plus, TerminalSquare } from 'lucide-react'
import { trpc } from './lib/trpc'
import { cn } from './lib/utils'
import {
  mainTabAtom,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom,
  themeAtom,
  type MainTab
} from './lib/atoms'
import { useAppShortcuts } from './lib/shortcuts'
import { Button } from './components/ui/button'
import { Sidebar } from './features/sidebar/Sidebar'
import { BootErrorScreen } from './features/boot/BootErrorScreen'
import { ChatView } from './features/agents/ChatView'
import { ChangesView } from './features/changes/ChangesView'
import { TerminalView } from './features/terminal/TerminalView'
import { FilesView } from './features/file-viewer/FilesView'
import { SettingsDialog } from './features/settings/SettingsDialog'
import { ProjectSettingsDialog } from './features/project-settings/ProjectSettingsDialog'

const TABS: Array<{ id: MainTab; label: string; icon: React.ReactNode }> = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare size={13} /> },
  { id: 'changes', label: 'Changes', icon: <GitCompare size={13} /> },
  { id: 'terminal', label: 'Terminal', icon: <TerminalSquare size={13} /> },
  { id: 'files', label: 'Files', icon: <FileCode2 size={13} /> }
]

function useThemeEffect(): void {
  const theme = useAtomValue(themeAtom)
  useEffect(() => {
    const root = document.documentElement
    const apply = (dark: boolean): void => {
      root.classList.toggle('dark', dark)
    }
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches)
      const listener = (e: MediaQueryListEvent): void => apply(e.matches)
      mq.addEventListener('change', listener)
      return () => mq.removeEventListener('change', listener)
    }
    apply(theme === 'dark')
    return undefined
  }, [theme])
}

export default function App(): React.JSX.Element {
  useThemeEffect()
  useAppShortcuts()
  const setProjectId = useSetAtom(selectedProjectIdAtom)
  const projectId = useAtomValue(selectedProjectIdAtom)
  const chatId = useAtomValue(selectedChatIdAtom)
  const subchatId = useAtomValue(selectedSubchatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const [tab, setTab] = useAtom(mainTabAtom)

  const utils = trpc.useUtils()
  const projects = trpc.projects.list.useQuery()
  const addProject = trpc.projects.addViaDialog.useMutation({
    onSuccess: (p) => {
      utils.projects.list.invalidate()
      if (p) setProjectId(p.id)
    }
  })
  const chat = trpc.chats.get.useQuery({ id: chatId ?? '' }, { enabled: !!chatId })
  const preflight = trpc.system.preflight.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false
  })

  const project = (projects.data ?? []).find((p) => p.id === projectId) ?? null
  const cwd = chat.data?.worktreePath ?? project?.path ?? null

  // Hard gate: the app is useless if the bundled runtime can't boot.
  if (preflight.data && !preflight.data.ok) {
    return (
      <BootErrorScreen
        error={preflight.data.error}
        mastracodeVersion={preflight.data.mastracodeVersion}
        nodeVersion={preflight.data.nodeVersion}
        onRetry={() => preflight.refetch()}
        retrying={preflight.isFetching}
      />
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Tab bar / titlebar drag region */}
        <div className="titlebar-drag flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs cursor-pointer',
                tab === t.id
                  ? 'bg-accent font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          {chat.data && (
            <span className="truncate text-xs text-muted-foreground">
              {chat.data.title}
              {chat.data.branch ? ` · ${chat.data.branch}` : ''}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {projects.data && projects.data.length === 0 ? (
            // Onboarding: no projects yet.
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <FolderGit2 size={40} strokeWidth={1.25} className="text-muted-foreground" />
              <div className="space-y-1">
                <div className="text-lg font-semibold">Welcome to Yardarm</div>
                <div className="max-w-sm text-sm text-muted-foreground">
                  Yardarm runs Mastra Code agents against your local git repositories. Add a
                  project folder to start your first chat.
                </div>
              </div>
              <Button disabled={addProject.isPending} onClick={() => addProject.mutate()}>
                <Plus size={14} />
                Add project folder
              </Button>
              <div className="max-w-md text-[11px] leading-5 text-muted-foreground">
                Each chat can run in an isolated git worktree · @-mention files · / for slash
                commands · paste images into the composer · ⌘J toggles the terminal
              </div>
            </div>
          ) : !chatId || !subchatId ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <MessageSquare size={28} strokeWidth={1.5} />
              <div className="text-sm">
                {project ? 'Create or select a chat to get started' : 'Add a project to begin'}
              </div>
            </div>
          ) : (
            <>
              <div className={cn('flex h-full flex-col', tab !== 'chat' && 'hidden')}>
                {/* Subchat tabs (created by the Threads UI "open in new tab") */}
                {(chat.data?.subchats.length ?? 0) > 1 && (
                  <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1">
                    {chat.data!.subchats.map((sc, i) => (
                      <button
                        key={sc.id}
                        onClick={() => setSubchatId(sc.id)}
                        className={cn(
                          'rounded px-2 py-0.5 text-[11px] cursor-pointer',
                          subchatId === sc.id
                            ? 'bg-accent font-medium'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Tab {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <ChatView subchatId={subchatId} projectRoot={cwd} />
                </div>
              </div>
              {tab === 'changes' && cwd && <ChangesView cwd={cwd} />}
              {tab === 'terminal' && cwd && (
                <TerminalView id={`chat-${chatId}`} cwd={cwd} />
              )}
              {tab === 'files' && cwd && <FilesView root={cwd} />}
            </>
          )}
        </div>
      </div>
      <SettingsDialog />
      <ProjectSettingsDialog
        projectPath={project?.path ?? null}
        projectName={project?.name ?? null}
        subchatId={subchatId}
      />
    </div>
  )
}
