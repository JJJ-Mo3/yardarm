import React, { useEffect } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  FileCode2,
  FolderGit2,
  GitCompare,
  GitFork,
  MessageSquare,
  Plus,
  SquareChevronRight,
  SquareKanban,
  TerminalSquare
} from 'lucide-react'
import { trpc } from './lib/trpc'
import { cn } from './lib/utils'
import {
  addProjectOpenAtom,
  mainTabAtom,
  onboardingForceOpenAtom,
  selectedChatIdAtom,
  selectedProjectIdAtom,
  selectedSubchatIdAtom,
  themeAtom,
  type MainTab
} from './lib/atoms'
import { useAppShortcuts } from './lib/shortcuts'
import { Button } from './components/ui/button'
import { Tip } from './components/ui/tooltip'
import { Sidebar } from './features/sidebar/Sidebar'
import { BootErrorScreen } from './features/boot/BootErrorScreen'
import { OnboardingWizard } from './features/onboarding/OnboardingWizard'
import { ChatView } from './features/agents/ChatView'
import { useChatStatusTracker } from './features/agents/use-chat-status-tracker'
import { ChangesView } from './features/changes/ChangesView'
import { TerminalView } from './features/terminal/TerminalView'
import { FilesView } from './features/file-viewer/FilesView'
import { KanbanView } from './features/kanban/KanbanView'
import { SettingsDialog } from './features/settings/SettingsDialog'
import { ProjectSettingsDialog } from './features/project-settings/ProjectSettingsDialog'

const TABS: Array<{ id: MainTab; label: string; icon: React.ReactNode; tip: string }> = [
  {
    id: 'chat',
    label: 'Chat',
    icon: <MessageSquare size={13} />,
    tip: 'Talk to the agent — send prompts, review its replies, and approve tool calls'
  },
  {
    id: 'changes',
    label: 'Changes',
    icon: <GitCompare size={13} />,
    tip: 'Review diffs of what the agent changed, then stage, commit, and push'
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: <TerminalSquare size={13} />,
    tip: 'Shell in the chat worktree (or project root) — ⌘J toggles it'
  },
  {
    id: 'files',
    label: 'Files',
    icon: <FileCode2 size={13} />,
    tip: 'Browse and read files in the chat worktree (or project root)'
  },
  {
    id: 'cli',
    label: 'CLI',
    icon: <SquareChevronRight size={13} />,
    tip: 'Interactive Mastra Code CLI in the chat worktree — it sees the same threads as this chat. Avoid running the chat and the CLI on the same thread at once.'
  },
  {
    id: 'kanban',
    label: 'Kanban',
    icon: <SquareKanban size={13} />,
    tip: 'Board of this project’s chats grouped by live agent status — click a card to open it'
  }
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

/** Shown in Changes/Terminal/Files when no project (and thus no cwd) is selected. */
function SelectProjectPane(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FolderGit2 size={28} strokeWidth={1.5} />
      <div className="text-sm">Select a project to use this tab</div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  useThemeEffect()
  useAppShortcuts()
  useChatStatusTracker()
  const projectId = useAtomValue(selectedProjectIdAtom)
  const setAddProjectOpen = useSetAtom(addProjectOpenAtom)
  const chatId = useAtomValue(selectedChatIdAtom)
  const subchatId = useAtomValue(selectedSubchatIdAtom)
  const setSubchatId = useSetAtom(selectedSubchatIdAtom)
  const [tab, setTab] = useAtom(mainTabAtom)
  const [forceOnboarding, setForceOnboarding] = useAtom(onboardingForceOpenAtom)

  const projects = trpc.projects.list.useQuery()
  const chat = trpc.chats.get.useQuery({ id: chatId ?? '' }, { enabled: !!chatId })
  const preflight = trpc.system.preflight.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false
  })
  const mastraSettings = trpc.mastraSettings.get.useQuery(undefined, {
    refetchOnWindowFocus: false
  })

  const project = (projects.data ?? []).find((p) => p.id === projectId) ?? null
  const cwd = chat.data?.worktreePath ?? project?.path ?? null

  // Hard gate: the app is useless if the bundled runtime can't boot. Covers
  // both a failed preflight result and the query itself erroring.
  if (preflight.error || (preflight.data && !preflight.data.ok)) {
    return (
      <BootErrorScreen
        error={preflight.data?.error ?? preflight.error?.message}
        mastracodeVersion={preflight.data?.mastracodeVersion ?? null}
        nodeVersion={preflight.data?.nodeVersion ?? null}
        onRetry={() => preflight.refetch()}
        retrying={preflight.isFetching}
      />
    )
  }

  // First-run onboarding: same gate as the mastracode CLI (shared settings.json).
  const ob = mastraSettings.data?.onboarding
  const needsOnboarding =
    mastraSettings.data !== undefined &&
    (!(ob?.completedAt || ob?.skippedAt) || (ob?.version ?? 0) < 1)
  if (preflight.data?.ok && (needsOnboarding || forceOnboarding)) {
    return <OnboardingWizard onDone={() => setForceOnboarding(false)} />
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Tab bar / titlebar drag region */}
        <div className="titlebar-drag flex h-10 shrink-0 items-center gap-1 border-b border-border px-3">
          {TABS.map((t) => (
            <Tip key={t.id} content={t.tip} side="bottom">
              <button
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
            </Tip>
          ))}
        </div>

        <div className="min-h-0 flex-1">
          {projects.data && projects.data.length === 0 ? (
            // Onboarding: no projects yet.
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <FolderGit2 size={40} strokeWidth={1.25} className="text-muted-foreground" />
              <div className="space-y-1">
                <div className="text-lg font-semibold">Welcome to Yardarm</div>
                <div className="max-w-sm text-sm text-muted-foreground">
                  Yardarm runs Mastra Code agents against your local git repositories. Add a project
                  folder to start your first chat.
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setAddProjectOpen('local')}>
                  <Plus size={14} />
                  Add project folder
                </Button>
                <Button variant="outline" onClick={() => setAddProjectOpen('clone')}>
                  <GitFork size={14} />
                  Clone from GitHub
                </Button>
              </div>
              <div className="max-w-md text-[11px] leading-5 text-muted-foreground">
                Each chat can run in an isolated git worktree · @-mention files · / for slash
                commands · paste images into the composer · ⌘J toggles the terminal
              </div>
            </div>
          ) : (
            <>
              {/* Chat tab — kept mounted (hidden) so the stream state survives tab switches. */}
              <div className={cn('flex h-full flex-col', tab !== 'chat' && 'hidden')}>
                {chatId && subchatId ? (
                  <>
                    {/* Subchat tabs (created by the Threads UI "open in new tab") */}
                    {(chat.data?.subchats.length ?? 0) > 1 && (
                      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1">
                        {chat.data!.subchats.map((sc, i) => (
                          <Tip
                            key={sc.id}
                            content="Switch to this conversation tab (each tab has its own transcript)"
                            side="bottom"
                          >
                            <button
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
                          </Tip>
                        ))}
                      </div>
                    )}
                    <div className="min-h-0 flex-1">
                      <ChatView subchatId={subchatId} projectRoot={cwd} />
                    </div>
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <MessageSquare size={28} strokeWidth={1.5} />
                    <div className="text-sm">
                      {project
                        ? 'Create or select a chat to get started'
                        : 'Select a project to begin'}
                    </div>
                  </div>
                )}
              </div>
              {/* Changes / Terminal / Files work at the project level too: they
                  use the chat's worktree when one is open, else the project root. */}
              {tab === 'changes' &&
                (cwd ? (
                  <ChangesView
                    cwd={cwd}
                    merge={
                      chat.data?.worktreePath &&
                      chat.data.branch &&
                      chat.data.baseBranch &&
                      chat.data.branch !== chat.data.baseBranch &&
                      project
                        ? {
                            projectPath: project.path,
                            branch: chat.data.branch,
                            baseBranch: chat.data.baseBranch
                          }
                        : null
                    }
                  />
                ) : (
                  <SelectProjectPane />
                ))}
              {tab === 'terminal' &&
                (cwd ? (
                  <TerminalView id={chatId ? `chat-${chatId}` : `project-${projectId}`} cwd={cwd} />
                ) : (
                  <SelectProjectPane />
                ))}
              {tab === 'files' && (cwd ? <FilesView root={cwd} /> : <SelectProjectPane />)}
              {tab === 'cli' &&
                (cwd ? (
                  <TerminalView
                    id={chatId ? `cli-chat-${chatId}` : `cli-project-${projectId}`}
                    cwd={cwd}
                    kind="mastracode"
                  />
                ) : (
                  <SelectProjectPane />
                ))}
              {tab === 'kanban' &&
                (projectId ? <KanbanView projectId={projectId} /> : <SelectProjectPane />)}
            </>
          )}
        </div>
      </div>
      <SettingsDialog />
      <ProjectSettingsDialog
        projectId={project?.id ?? null}
        projectPath={project?.path ?? null}
        projectName={project?.name ?? null}
        subchatId={subchatId}
      />
    </div>
  )
}
