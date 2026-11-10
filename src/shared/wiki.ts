/**
 * Repo-wiki generation prompt + transcript marker, shared between the main
 * process (which dispatches generation into the project's dedicated wiki
 * chat) and the renderer (marker-aware transcript rendering). The prompt
 * instructs the agent to write pages into the git-excluded .yardarm-wiki/
 * staging folder; main collects them into the per-project store when the
 * run finishes.
 */

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
