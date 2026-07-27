/**
 * In-app guide/FAQ page: a table-of-contents rail on the left and the
 * purpose-written guide sections (from guide-content.ts) rendered as markdown
 * on the right. Opened via the sidebar help button or ⌘9; needs no project.
 */
import React from 'react'
import { Tip } from '../../components/ui/tooltip'
import { Markdown } from '../agents/Markdown'
import { GUIDE_SECTIONS } from './guide-content'

export function GuideView(): React.JSX.Element {
  const jump = (id: string): void => {
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div className="flex h-full">
      <div className="w-52 shrink-0 overflow-y-auto border-r border-border p-2">
        <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Guide
        </div>
        {GUIDE_SECTIONS.map((s) => (
          <Tip key={s.id} content={`Jump to "${s.title}"`} side="right">
            <button
              onClick={() => jump(s.id)}
              className="block w-full cursor-pointer rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {s.title}
            </button>
          </Tip>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          {GUIDE_SECTIONS.map((s) => (
            <section key={s.id} id={`guide-${s.id}`} className="mb-10 scroll-mt-4">
              <h2 className="mb-3 text-lg font-semibold">{s.title}</h2>
              <Markdown text={s.body} />
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
