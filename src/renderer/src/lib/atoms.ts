import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { SubchatStatusInfo } from '../../../shared/ui-message'

export type MainTab =
  'chat' | 'changes' | 'terminal' | 'files' | 'cli' | 'kanban' | 'analytics' | 'preview' | 'guide'
export type Theme = 'light' | 'dark' | 'system'

export const selectedProjectIdAtom = atomWithStorage<string | null>('cz.selectedProject', null)
export const selectedChatIdAtom = atom<string | null>(null)
export const selectedSubchatIdAtom = atom<string | null>(null)
export const mainTabAtom = atom<MainTab>('chat')
export const themeAtom = atomWithStorage<Theme>('cz.theme', 'dark')
export const settingsOpenAtom = atom(false)
export type SettingsTab =
  | 'appearance'
  | 'preferences'
  | 'keys'
  | 'models'
  | 'providers'
  | 'voice'
  | 'browser'
  | 'connectors'
  | 'mcp'
  | 'agents'
  | 'languages'
  | 'about'
export const settingsTabAtom = atom<SettingsTab>('appearance')
export const helpOpenAtom = atom(false)
/** New-chat dialog in the Sidebar (also opened by Cmd+N). */
export const newChatOpenAtom = atom(false)
/** Add-project dialog: false = closed, otherwise the initial mode to show. */
export const addProjectOpenAtom = atom<false | 'local' | 'clone'>(false)
/** Threads popover in the active ChatView (also opened by Cmd+P). */
export const threadsOpenAtom = atom(false)
/** One extra split chat pane's selection (ephemeral — cleared on project switch). */
export type SplitPaneSel = { key: string; chatId: string | null; subchatId: string | null }
/** Extra panes beyond the primary one — 6 side-by-side chats max. */
export const MAX_SPLIT_PANES = 5
/** Split view: extra, independent chat panes to the right of the primary Chat pane. */
export const splitPanesAtom = atom<SplitPaneSel[]>([])
export type ProjectSettingsTab =
  'general' | 'hooks' | 'commands' | 'instructions' | 'resource' | 'plugins' | 'workflows'
export const projectSettingsOpenAtom = atom(false)
export const projectSettingsTabAtom = atom<ProjectSettingsTab>('general')
export const debugEventsAtom = atomWithStorage<boolean>('cz.debugEvents', false)
/** Right-hand details panel on the Chat tab (changed files / tasks / plan). */
export const detailsOpenAtom = atomWithStorage<boolean>('cz.detailsOpen', false)
/** Details panel width in px (clamped 240–480 on use). */
export const detailsWidthAtom = atomWithStorage<number>('cz.detailsWidth', 320)
/** Changes tab file-list column width in px (clamped 220–480 on use). */
export const changesListWidthAtom = atomWithStorage<number>('cz.changesListWidth', 288)
/** Worktree-relative file the Files tab should open on next activation. */
export const fileOpenRequestAtom = atom<string | null>(null)
/** One-shot text inserted into the primary chat composer (e.g. "@path " from the Files tree). */
export const composerInsertAtom = atom<string | null>(null)
/** Pane the Changes tab should switch to on next render (deep links; cleared on use). */
export const changesPaneRequestAtom = atom<'changes' | 'history' | 'checkpoints' | null>(null)
/** Global Cmd+K command palette. */
export const commandPaletteOpenAtom = atom(false)
/** Cmd+O quick file open dialog (fuzzy search over the active worktree). */
export const quickOpenAtom = atom(false)
/** Re-open the first-run onboarding wizard (Settings → About → Run setup again). */
export const onboardingForceOpenAtom = atom(false)
/** Extra Terminal-tab sessions keyed by projectId (ptys live in the main process). */
export type ExtraTerminal = { id: string; cwd: string; label: string }
export const extraTerminalsAtom = atom<Record<string, ExtraTerminal[]>>({})
/** Active Terminal-tab session id (null = the default chat/project session). */
export const activeTerminalIdAtom = atom<string | null>(null)

/** Live per-subchat agent status keyed by subchatId (fed by useChatStatusTracker). */
export const subchatStatusesAtom = atom<Map<string, SubchatStatusInfo>>(new Map())
/** Chats whose last run finished while the chat wasn't selected (sidebar blue dot). */
export const unseenChatsAtom = atom<Set<string>>(new Set<string>())
/** Per-chat aggregate across its subchats: any running / any awaiting user input. */
export const chatStatusesAtom = atom((get) => {
  const agg = new Map<string, { running: boolean; awaiting: boolean }>()
  for (const s of get(subchatStatusesAtom).values()) {
    const cur = agg.get(s.chatId) ?? { running: false, awaiting: false }
    agg.set(s.chatId, {
      running: cur.running || s.running,
      awaiting: cur.awaiting || s.pendingCount > 0
    })
  }
  return agg
})
