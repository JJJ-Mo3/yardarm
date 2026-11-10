/**
 * Repo-wiki prompt + transcript-marker helpers. Wiki generation is a visible
 * marked run in the selected chat (same pattern as /review): buildWikiPrompt
 * instructs the agent to write pages into the git-excluded .yardarm-wiki/
 * staging folder, and findCompletedWikiRun detects the finished run so the
 * renderer can ask main to collect staging into the per-project store.
 */
import type { StoredMessage } from '../../../../shared/ui-message'

/** Transcript marker for a wiki generation send. */
export const WIKI_MARKER = 'Wiki: generate'

export function buildWikiPrompt(): string {
  return `Generate a concise repository wiki for this codebase. Explore the repo first, then write the wiki as markdown files into the \`.yardarm-wiki/\` folder at the repository root (it already exists, is excluded from git, and contains a meta.json you must not modify or delete).

Write these files directly into \`.yardarm-wiki/\` (flat — no subfolders):

1. \`index.md\` — a one-paragraph description of the project, then an architecture overview with a Mermaid diagram (\`\`\`mermaid fence) of the main components and how they interact, then a table of contents linking to every other page with relative links, e.g. [Build system](build-system.md).
2. One page per major module or area of the codebase (aim for 4–10 pages, kebab-case filenames like \`agent-host.md\`): what it does, how it fits into the architecture, key files and entry points, and important invariants or gotchas.

Rules:
- Cite sources as inline code with repo-relative paths, like \`src/main/index.ts\` or \`src/main/index.ts:42\` — these become clickable links in the wiki.
- Link between pages with relative markdown links to the sibling .md files.
- Keep pages focused and skimmable: short sections and bullet points over long prose.
- Do not modify any files outside \`.yardarm-wiki/\`, and do not commit anything.
- When done, reply with a one-paragraph summary of the wiki structure you created.`
}

/**
 * The just-finished wiki run, iff the last user message is the wiki marker
 * and the agent produced something after it. The caller gates on the run
 * being idle before collecting the staged pages.
 */
export function findCompletedWikiRun(messages: StoredMessage[]): { markerId: string } | null {
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = i
      break
    }
  }
  if (lastUser < 0) return null
  const markerPart = messages[lastUser].parts.find((p) => p.type === 'text' && p.marker)
  if (!markerPart || markerPart.type !== 'text' || markerPart.text !== WIKI_MARKER) return null
  if (messages.length - 1 === lastUser) return null
  return { markerId: messages[lastUser].id }
}
