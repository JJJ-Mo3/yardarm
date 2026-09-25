/**
 * Pure labeling helpers for subchat tabs: tabs created by fork-from-message
 * carry their parent tab's number so the fork hierarchy is visible in the
 * tab strip (App) and the split-pane tab select (SplitChatPane).
 */
export interface SubchatTabInfo {
  id: string
  forkedFromSubchatId?: string | null
}

/** Compact label: "Tab N", with a fork-origin suffix when the tab is a fork. */
export function subchatTabLabel(subchats: SubchatTabInfo[], index: number): string {
  const sc = subchats[index]
  const base = `Tab ${index + 1}`
  if (!sc?.forkedFromSubchatId) return base
  const parent = subchats.findIndex((s) => s.id === sc.forkedFromSubchatId)
  return parent >= 0 ? `${base} (fork of Tab ${parent + 1})` : `${base} (fork)`
}

/** Tooltip for a subchat tab button, noting fork parentage when present. */
export function subchatTabTip(subchats: SubchatTabInfo[], index: number): string {
  const sc = subchats[index]
  if (!sc?.forkedFromSubchatId) {
    return 'Switch to this conversation tab (each tab has its own transcript)'
  }
  const parent = subchats.findIndex((s) => s.id === sc.forkedFromSubchatId)
  const origin = parent >= 0 ? `forked from Tab ${parent + 1}` : 'forked from a removed tab'
  return `Switch to this conversation tab — ${origin}`
}
