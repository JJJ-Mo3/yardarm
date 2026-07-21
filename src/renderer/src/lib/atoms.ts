import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { SubchatStatusInfo } from '../../../shared/ui-message'

export type MainTab = 'chat' | 'changes' | 'terminal' | 'files' | 'cli'
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
  | 'mcp'
  | 'about'
export const settingsTabAtom = atom<SettingsTab>('appearance')
export const helpOpenAtom = atom(false)
/** New-chat dialog in the Sidebar (also opened by Cmd+N). */
export const newChatOpenAtom = atom(false)
/** Add-project dialog: false = closed, otherwise the initial mode to show. */
export const addProjectOpenAtom = atom<false | 'local' | 'clone'>(false)
/** Threads popover in the active ChatView (also opened by Cmd+P). */
export const threadsOpenAtom = atom(false)
export type ProjectSettingsTab =
  'general' | 'mcp' | 'hooks' | 'commands' | 'instructions' | 'resource' | 'plugins'
export const projectSettingsOpenAtom = atom(false)
export const projectSettingsTabAtom = atom<ProjectSettingsTab>('general')
export const debugEventsAtom = atomWithStorage<boolean>('cz.debugEvents', false)
/** Re-open the first-run onboarding wizard (Settings → About → Run setup again). */
export const onboardingForceOpenAtom = atom(false)

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
