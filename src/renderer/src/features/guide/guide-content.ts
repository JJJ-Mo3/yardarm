/**
 * Purpose-written content for the in-app guide/FAQ page (GuideView). Curated
 * for in-app reading — no install/build instructions, which live in the repo
 * README and docs/getting-started.md. Section bodies are markdown (rendered
 * with the shared Markdown component) and use ###-and-below headings so each
 * section's title stays the visual h2.
 */

export interface GuideSection {
  id: string
  title: string
  body: string
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'welcome',
    title: 'Welcome to Yardarm',
    body: `
Yardarm is a desktop UI for the **Mastra Code** coding agent. It runs agents against your
local git repositories — you chat, the agent reads and edits code, runs commands, and you
review and ship the result.

Everything runs locally. There is no Yardarm account or login: the app talks directly to the
model providers you configure, and it shares its configuration with the \`mastracode\` CLI, so
the two stay in sync.

The main window has a project sidebar on the left and a set of tabs across the top: **Chat**,
**CLI**, **IDE**, **Changes**, **Terminal**, **Kanban**, and **Preview**, plus icon buttons for
**Analytics** and this **Guide**. Switch tabs with ⌘1–⌘9.
`
  },
  {
    id: 'projects',
    title: 'Projects, chats & worktrees',
    body: `
A **project** is a local git repository (add a folder or clone a repository via the sidebar).
When you add one, Yardarm offers to write **agent instructions** (an \`AGENTS.md\`) so the
agent knows your project's conventions from the first prompt — you can skip it or edit the
file later in Project Settings. Inside a project you create **chats** — independent
conversations with the agent.

### Worktrees

When you create a chat you choose whether it runs in an **isolated git worktree** or directly
in the project folder:

- **Worktree** (recommended): the chat gets its own working copy on a dedicated branch
  (prefixed \`yardarm/\`). Multiple chats can edit the same project in parallel without
  stepping on each other, and your main checkout stays untouched until you merge.
- **In place**: the chat works directly in the project folder — useful for quick edits or
  repos where you want changes to land immediately.

The IDE, Terminal, Changes, and Preview tabs all follow the selected chat's worktree (or the
project root when no chat is selected). Repositories without any commits get a small bootstrap
"Initial commit" so worktrees and checkpoints work.

Projects can be archived from the sidebar; archived projects are hidden but nothing is
deleted unless you explicitly opt in.
`
  },
  {
    id: 'chat',
    title: 'Chat basics',
    body: `
The Chat tab is where you work with the agent. Type a prompt and send it; the agent streams
its reasoning, tool calls, and file edits into the transcript.

### Composer tips

- **@-mention files** — type \`@\` to search the repo and attach a file to your prompt.
- **Slash commands** — type \`/\` for the command palette (\`/help\` lists everything:
  reviews, permissions, goals, threads, and more).
- **Attachments** — paste, drag in, or pick files with the attachment button: images and
  PDFs go to the model directly, and text/code files (markdown, logs, CSV, source files, …)
  are inlined into the prompt so any model can read them.
- **Voice** — the microphone button dictates your prompt (needs a speech-to-text-capable API
  key, configured in Settings → Voice).
- **Queueing** — you can keep typing while the agent runs; queued prompts are sent in order
  when the current run finishes.

### Models

The model selector in the chat header switches the model per chat. Models come from the
providers you configured in Settings; local models (e.g. via Ollama) work too — models with
at least a 64k context window are required, 128k+ recommended.
`
  },
  {
    id: 'modes',
    title: 'Modes: plan, build, fast',
    body: `
The color-coded mode selector controls how the agent behaves:

- **Plan** — read-only research. The agent explores the codebase and proposes a plan; it asks
  for your approval before touching any files.
- **Build** — the default working mode. The agent edits files and runs tools to do the work.
- **Fast** — quicker, lighter responses for small tasks.

A common flow for larger changes: start in Plan, review and approve the plan, then let the
agent switch to Build to implement it.
`
  },
  {
    id: 'approvals',
    title: 'Approvals, permissions & sandbox',
    body: `
By default the agent asks before running consequential tools (shell commands, file writes
outside the obvious scope, and so on). Each request shows exactly what will run — approve or
deny inline.

- **Auto-approve** — the header toggle lets a trusted chat run without per-tool prompts.
  A global default for new chats lives in Settings → Preferences; each chat's own toggle
  still wins and is remembered.
- **Permissions** — \`/permissions\` opens the session permissions panel: per-category and
  per-tool allow / ask / deny rules, so routine commands stop prompting while risky ones
  still do.
- **Sandbox** — the header sandbox toggle runs the agent's commands under OS-level isolation
  (per chat, with a global default in Settings → Preferences). Useful when trying untrusted
  prompts or dependencies.
`
  },
  {
    id: 'goals',
    title: 'Goals & evaluation history',
    body: `
A **goal** gives the agent an objective to iterate on until it passes. Set one from the goal
chip in the chat header: describe the objective (e.g. "all tests pass") and a maximum number
of runs. The agent works, a judge model (selectable in the goal popover) evaluates the result
against the objective, and the agent keeps iterating until it passes, pauses for your input,
or hits the run limit.

The goal chip is color-coded by state, and the goal popover keeps an **evaluation history**:
every past objective with its per-iteration pass/fail results and the evaluator's reasoning,
so you can see how a goal converged.
`
  },
  {
    id: 'threads',
    title: 'Threads, forking & split view',
    body: `
Each chat can hold multiple **threads** (conversation tabs). Open the thread switcher with ⌘P
to jump between them, create new ones, or open a thread in a new tab.

- **Fork from a message** — branch the conversation from any earlier message to explore an
  alternative approach without losing the original.
- **Split view** — the split button in the tab bar shows a second chat of the same project
  side by side, so two agents can work (and be watched) at once. Drag the divider to resize.

Threads are shared with the \`mastracode\` CLI — the CLI tab sees the same conversations.
Avoid driving the same thread from the chat and the CLI at the same time.
`
  },
  {
    id: 'changes',
    title: 'Reviewing changes & shipping',
    body: `
The Changes tab shows diffs of everything that changed in the chat's worktree (or project
root).

- **Stage, commit, push** — review per-file diffs, stage what you want, write a commit, and
  push. A commit-history panel shows what's landed.
- **Branch compare** — switch the comparison base to see the full branch diff, not just the
  working tree.
- **Merge & pull** — worktree chats can merge their branch back into the base branch from
  here, and pull the base to stay current.
- **Review** — the review action (also \`/review\`) has the agent review local changes or an
  open PR/MR and post findings back into the chat.
- **Pull / merge requests** — with the GitHub CLI (\`gh\`) or GitLab CLI (\`glab\`) installed
  and authenticated, you can open PRs/MRs from the app. The host is auto-detected from the
  origin remote; for self-hosted instances, set it in Project Settings → General.
`
  },
  {
    id: 'checkpoints',
    title: 'Checkpoints & rollback',
    body: `
Yardarm snapshots the working tree **before every prompt you send**, so agent work is always
reversible.

- **Rollback** — each of your messages has a rollback control: restore the files to how they
  were before that message and rewind the conversation to match. The agent is told about the
  rollback so it doesn't repeat the undone work.
- **Checkpoint manager** — the checkpoints panel in the Changes tab lists every checkpoint
  (automatic and manual). You can create a named checkpoint now, rename or tag existing ones,
  **compare any two checkpoints** as a diff, and prune old automatic ones that are no longer
  referenced.

Checkpoints are stored as git refs inside the repository (\`refs/yardarm/checkpoints/*\`) —
they never leave your machine and don't touch your branches.
`
  },
  {
    id: 'ide',
    title: 'IDE & diagnostics',
    body: `
The IDE tab is a multi-tab code editor (Monaco) rooted at the chat's worktree.

- **Edit alongside the agent** — your saves are delivered to the agent as notes, so it knows
  what you changed mid-conversation and won't clobber your edits.
- **Problems panel** — language-server diagnostics (errors and warnings) for the active file,
  refreshed as you type (shortly after edits pause), on open and on save — no chat needs to
  be selected. Click a problem to jump to it; markers also appear inline in the editor.

Language servers come in three tiers:

- **Built in** — TypeScript/JavaScript (using your project's own TypeScript when it has one)
  ships with the app; no setup needed.
- **Downloadable packs** — Web (HTML/CSS/JSON, ~15 MB), YAML (~6 MB), Python (~7 MB) and
  ERB / Rails templates (~19 MB) are one-time downloads: grab them from
  **Settings → Languages**, or click the Download button the problems panel offers when you
  open a matching file. They work offline once installed and take effect on the next
  diagnostics refresh — no restart.
- **External binaries** — Go, Rust and Ruby use gopls / rust-analyzer / ruby-lsp from your
  PATH (well-known install dirs like \`~/go/bin\` and \`~/.cargo/bin\` are searched too);
  Rails smarts come from your project's ruby-lsp-rails gem.
`
  },
  {
    id: 'terminal',
    title: 'Terminal & the Mastra Code CLI',
    body: `
- **Terminal tab** (⌘J) — a real shell in the chat's worktree (or project root). Use it for
  anything: running dev servers, git, tests. Each chat gets its own terminal.
- **CLI tab** — an interactive \`mastracode\` CLI session in the same worktree. Because the
  app and the CLI share configuration and threads, this is the same agent with the same
  history — useful for CLI-only workflows or debugging. Avoid running the chat UI and the
  CLI on the same thread simultaneously.
`
  },
  {
    id: 'preview',
    title: 'Preview',
    body: `
The Preview tab shows localhost dev servers in-app.

- **Auto-detection** — URLs printed in any of the chat's terminals (including by the agent)
  are detected automatically and offered in the address bar.
- **One-click start** — if nothing is running, a start chip offers to launch the project's
  dev server (detected from the project; static sites get a fallback server) in a dedicated
  terminal. Each chat runs the server in its own worktree, so if another chat's server is
  still running, starting here stops that one first — two servers would fight over the same
  port. Preview tells you which chat it is before you click.
- **DevTools** — the wrench button opens a full Chrome DevTools pane docked beside the page:
  inspect elements, read the console, and watch network requests of the previewed app.
- **Open externally** — the browser button opens the current URL in your default browser.

The previewed page keeps running when you switch tabs.
`
  },
  {
    id: 'kanban',
    title: 'Kanban task board',
    body: `
The Kanban tab is a task board that can **dispatch agents**.

- **Author cards** — write cards (title + prompt) into **Backlog** and **To do**, and drag to
  reorder or move between them.
- **Dispatch** — drag a card to **In progress** (or press its play button) and Yardarm
  creates a chat — with a worktree if you choose — and sends the card's prompt to the agent.
- **Live status** — dispatched cards move through the board based on the agent's real state:
  working, awaiting your input, or finished. Click a card to open its chat.
- **Done** — finished, reviewed cards can be marked done.

This makes it easy to queue up a batch of independent tasks and let several agents run in
parallel, each in its own worktree.
`
  },
  {
    id: 'connectors',
    title: 'Connectors & MCP servers',
    body: `
Agents can use external tools via the **Model Context Protocol (MCP)**.

- **Connectors** (Settings → Connectors) — one-click sign-ins for common services: GitHub,
  GitLab, Supabase, Netlify, Vercel, and Sentry. Sign in once and every chat can use that
  service's tools; sign-ins are shared across all worktrees of a project.
- **MCP servers** (Settings → MCP Servers) — add any MCP server yourself: local commands or
  remote URLs, with OAuth handled in-app when a server requires it. Global by default
  (available in every project); switch the scope to Project and pick a project to manage its
  project-specific servers. The tab also shows each server's live status with authenticate /
  reconnect actions. Configuration lives in the same \`mcp.json\` files the CLI uses.

Tools exposed by connected servers appear to the agent automatically and go through the same
approval flow as built-in tools.
`
  },
  {
    id: 'analytics',
    title: 'Analytics & token compression',
    body: `
The chart icon in the tab bar opens **Analytics**: token usage for the current project.

- Usage by **day**, by **model**, and by **chat** (input and output tokens).
- **Compression savings** — with token compression enabled (Settings → Preferences), Yardarm
  shrinks bulky tool output (logs, diffs, HTML) before it reaches the model and lets the
  agent retrieve the original on demand; Analytics shows how many tokens that saved. The
  savings also appear in the chat's usage bar.
- **CSV export** for your own analysis.

Figures are token counts, not prices — pricing varies by provider and plan, so Yardarm
doesn't guess.
`
  },
  {
    id: 'settings',
    title: 'Settings overview',
    body: `
App settings (⌘,) — most of these are shared with the \`mastracode\` CLI:

- **Appearance** — light/dark/system theme.
- **Preferences** — agent behavior defaults (auto-approve, sandbox), token compression and
  verbosity steering, and per-tool toggles to disable built-in agent tools you never want
  used.
- **API Keys** — keys for model providers, stored locally. Instead of pasting a key you can
  reference an environment variable (e.g. \`ANTHROPIC_API_KEY\`) — the value is read from your
  login shell at launch and never saved by Yardarm. Standard variables are detected
  automatically; a stored key takes precedence, so saving one mode clears the other. Export
  new variables in your shell profile and relaunch the app to pick them up. Like with the
  CLI, referenced variables are visible to shell commands the agent runs.
- **Models** — pick default models and manage the model list.
- **Providers** — provider OAuth logins and local providers (e.g. Ollama), including
  installing and pulling local models.
- **Voice** — speech-to-text for the composer microphone.
- **Browser** — the agent's built-in browser tool, including viewport size.
- **Connectors** — one-click service sign-ins (see the Connectors section), plus
  **GitHub signals** (experimental PR-status awareness via the \`gh\` CLI) and
  **Observability** (local tracing / Mastra Cloud). \`/github\` and \`/observability\` jump
  straight there.
- **MCP Servers** — MCP server lists and live status, global or per-project (scope toggle +
  project picker). \`/mcp\` opens this tab.
- **Agents** — custom subagents the main agent can delegate tasks to. Global by default
  (available in every project); switch the scope to Project and pick a project to manage
  project-specific subagents. A Templates section lists ready-made subagents — team roles
  (product manager, developer, QA, …) and domain specialists (SaaS, mobile, AI apps, …) —
  added with one click and editable like any other. \`/subagents\` opens this tab.
- **About** — versions, bundled runtime updates, installing/updating the global
  \`mastracode\` CLI, storage pruning (\`/prune\` — clear out old threads, traces, and
  logs), and "Run setup again" to redo onboarding.

**Project settings** (gear on the project row) cover per-project hooks, custom slash
commands, agent instructions, resources, and plugins — plugins with configuration schemas
get generated settings forms, and **Create plugin** scaffolds a new plugin for you.
`
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    body: `
⌘ on macOS, Ctrl on Windows/Linux.

| Shortcut | Action |
| --- | --- |
| ⌘N | New chat |
| ⌘P | Thread switcher |
| ⌘J | Toggle the Terminal tab |
| ⌘, | Settings |
| ⌘1 | Chat |
| ⌘2 | CLI |
| ⌘3 | IDE |
| ⌘4 | Changes |
| ⌘5 | Terminal |
| ⌘6 | Kanban |
| ⌘7 | Analytics |
| ⌘8 | Preview |
| ⌘9 | This guide |
`
  },
  {
    id: 'faq',
    title: 'FAQ',
    body: `
### Do I need an account?

No. Yardarm has no accounts or login. You bring your own model access — API keys,
environment-variable references, or provider sign-ins — and everything is stored locally.

### Where is my data stored?

Chats and app state live in a local SQLite database in the app's data folder. Worktrees live
under the app's data folder too. Model keys, provider auth, and agent settings live in the
\`mastracode\` configuration in your home directory, shared with the CLI. Keys referenced by
environment variable are never stored anywhere by Yardarm.

### Can I avoid storing my API key on disk?

Yes. In Settings → API Keys → Environment variables, point a provider at an environment
variable (any name) instead of pasting the key. The value is read from your login shell when
the app starts and is never stored — only the variable name is saved. Standard variables like
\`ANTHROPIC_API_KEY\` are detected automatically. A stored key takes precedence, so saving a
reference removes the stored key (and vice versa). Export new variables in your shell profile
and relaunch the app to pick them up. Like any exported key, the variable is visible to shell
commands the agent runs.

### How does Yardarm relate to the mastracode CLI?

Yardarm bundles the Mastra Code runtime and shares its configuration files and threads with
the CLI. Anything you configure in one is visible to the other, and the CLI tab gives you the
real CLI inside the app.

### Should I use worktrees or work in place?

Use worktrees for anything nontrivial: chats stay isolated, you can run several in parallel,
and your checkout stays clean until you merge. Work in place for quick one-off edits.

### Are my prompts or keys sent anywhere besides the model provider?

No. Prompts go to the provider serving your selected model; keys are only used to
authenticate with that provider. There is no middleman service.

### Can I work offline?

Yes, with a local model provider such as Ollama (Settings → Providers). Cloud models need a
network connection.

### Can several agents run at once?

Yes. Each chat (and each thread) runs independently — use split view, multiple chats, or the
Kanban board to parallelize.

### Why does the agent keep asking for approval?

That's the default safety posture. Add permission rules (\`/permissions\`) for routine
commands, or enable auto-approve for a trusted chat — optionally combined with the sandbox.

### How do I update the agent runtime?

Settings → About shows the bundled runtime version and an update indicator when a newer one
is available.
`
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    body: `
### The app shows a boot error / the agent won't start

Use the retry button on the error screen. If it persists, check Settings → About for runtime
details, or re-run onboarding ("Run setup again").

### Model errors about context length

Yardarm needs models with at least a **64k** context window (128k+ recommended). Small local
models will fail on real codebases — pick a larger variant or raise the context length in
your local provider.

### A connector or MCP server stopped working

Auth tokens expire. Reconnect from Settings → Connectors (or re-authenticate the server in
Settings → MCP Servers). Connector sign-ins are shared across worktrees, so one reconnect
fixes all chats of a project.

### The Preview tab shows nothing

Make sure a dev server is running — use the start chip, or launch it in the Terminal tab (the
URL is auto-detected when it's printed). Some servers only bind localhost after a first
compile; give them a moment.

### A chat's worktree is in a bad state

Open the Terminal tab (it's already in the worktree) and fix it with git as usual — worktrees
are ordinary git checkouts. Deleting a chat cleans up its worktree and checkpoints.

### Something else?

Check the getting-started guide and README in the repository, or open an issue on GitHub —
Settings → About links to the project.
`
  }
]
