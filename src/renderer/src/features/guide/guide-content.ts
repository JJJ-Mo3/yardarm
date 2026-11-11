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
**CLI**, **IDE**, **Changes**, **Terminal**, **Preview**, and **Factory**, plus icon
buttons for the **Wiki**, **Analytics**, and this **Guide**. Switch tabs with ⌘1–⌘8 (⌘ on
macOS; use Ctrl on Windows/Linux throughout this guide); Factory and the Wiki are unnumbered —
reach them from the tab bar or ⌘K.

Press **⌘K** anywhere for the **command palette**: run slash commands, jump to any tab or
settings section, or switch to another chat — all from the keyboard.
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
conversations with the agent. Drag chats in the sidebar to reorder them; chats you haven't
ordered sort by recency. **Pin** a chat (the pin button on its row) to keep it at the top of
the list regardless of order or recency — pinned rows show a persistent pin icon; hover it to
unpin.

**Hover a chat row** for a preview card: the chat's status (running, awaiting approval,
unread reply, or idle), its branch and last activity, a snippet of the latest agent reply,
and — when the branch has an open PR — a PR chip. On macOS the **dock icon badge** counts
chats that need you: pending approvals plus finished replies you haven't read yet.

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

**Worktree setup commands** (Project Settings → General) run in every newly created worktree
right after it's checked out — one per line, e.g. \`npm install\`, so new chats start with
dependencies ready. Each command gets 5 minutes and failures are logged but never block the
chat. They're saved to \`.yardarm/worktree.json\` in the repo, so the whole team shares them.

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
- **!-mention knowledge notes** — type \`!\` to search the project's knowledge notes and
  attach a note's text to your prompt (see Knowledge notes).
- **Slash commands** — type \`/\` for the command palette (\`/help\` lists everything:
  reviews, permissions, goals, threads, and more).
- **Attachments** — paste, drag in, or pick files with the attachment button: images and
  PDFs go to the model directly, and any text-like file (markdown, logs, CSV, source files,
  config files, … — detected by content, not just extension) is inlined into the prompt so
  any model can read it. Pasting a long block of text turns it into an attachment chip
  instead of flooding the composer.
- **Voice** — the microphone button dictates your prompt (needs a speech-to-text-capable API
  key, configured in Settings → Voice).
- **Queueing** — you can keep typing while the agent runs; queued prompts are sent in order
  when the current run finishes, and you can drag queued prompts to reorder them, edit them
  inline, copy their text, or remove them while they wait. Quitting the app while agents are
  still running asks for confirmation first.
- **Drafts** — whatever you've typed is saved automatically per chat, so switching chats or
  restarting the app never loses an unfinished prompt.

### The transcript

- **Copy a message** — hover any message and click the copy button to grab its text, or just
  select any text in the transcript — a floating Copy button appears next to the selection,
  along with a **Quote** button that drops the selection into the composer as an attachment
  so your next prompt can reference it.
- **Find in chat** — press ⌘F to search the transcript, with match count and next/previous
  navigation (Enter / Shift+Enter).
- **Diagrams** — \`mermaid\` code blocks in agent replies render as diagrams (flowcharts,
  sequence diagrams, …), following the app theme.
- **Git activity badges** — when the agent commits, pushes, merges, or switches branches
  during a turn, small badges under the reply summarize it at a glance (e.g. "2 commits",
  "pushed", "→ branch-name").
- **Follow-up suggestions** — after finishing a substantial task the agent proposes next
  steps as clickable chips under its reply. Clicking one prefills the composer (never
  auto-sends) so you can edit before sending; dismiss the row with the ×. On by default —
  turn off in Settings → Preferences.

### Header tools

- **Details panel** — the details button opens a resizable side panel with the chat's
  changed files (click to view), the live task checklist, the latest plan, a **session
  timeline** (everything the agent did, in order: your prompts, commands with pass/fail
  status, file changes — click one to open it in the IDE — subagent runs, model switches,
  and checkpoints), and — when the branch has an open PR — the PR's comments and reviews.
- **Checkpoints** — a quick view of the chat's rollback checkpoints (see Checkpoints below).
- **The ⋯ menu** — occasional tools live under the ⋯ button: **Code review** (review local
  changes or an open PR/MR), **Verify work** (per-chat Default / On / Off override for the
  self-verification pass — see Confidence & verification),
  **Auto-continue** (per-chat Default / On / Off override for resuming runs that stop with
  unfinished tasks — see Auto-continue below),
  **Observational memory** (\`/om\` status and tuning),
  **Scheduled runs** (\`/schedules\` — recurring agent runs, see Scheduled runs below),
  **Workflows** (\`/workflows\` — reusable workflow run-books, see Workflows below),
  **Session insights** (an agent-written summary of the chat — outcome, what changed, risks
  and follow-ups — plus the chat's total token usage; regenerate any time),
  **PR subscriptions** (\`/github\`), **MCP servers** (live status of this chat's MCP servers
  with a quick per-server enable/disable switch — no trip to Settings needed),
  **Open folder in…** (reveal the chat's folder in your
  file manager, or open it in a detected editor or terminal — e.g. VS Code, Cursor, Zed),
  **Export transcript** (download the thread as Markdown), and
  **Context audit** (\`/context\`).

### Auto-continue for long task lists

On long task lists, models sometimes end their turn early with tasks still unfinished —
normally you'd have to keep sending "continue". **Auto-continue** (opt-in) does that for you:
when a run ends normally but the agent's task list still has pending or in-progress items,
Yardarm sends a hidden continue prompt and the run resumes. A small "Auto-continued" line in
the transcript records each resume.

It never fires when you press Stop, when a run errors, or while the agent is waiting on you
(a question, plan, or tool approval), and it can't loop forever: it stops after 25 rounds per
prompt, or as soon as a round finishes without any task-list progress. Enable it globally in
Settings → Preferences ("Auto-continue unfinished tasks"), or per chat via **Auto-continue**
in the chat header's ⋯ menu (Default follows the global setting).

### Models

The model selector in the chat header switches the model per chat — it's searchable, so just
type to filter long model lists. Models come from the providers you configured in Settings;
local models (e.g. via Ollama) work too — models with at least a 64k context window are
required, 128k+ recommended.
`
  },
  {
    id: 'modes',
    title: 'Modes: plan, build, fast',
    body: `
The color-coded mode selector controls how the agent behaves:

- **Plan** — read-only research. The agent explores the codebase and ends with a plan card
  with two choices: **Approve plan & build** (the agent switches to Build and starts
  implementing) or **Request changes** (reject it and tell the agent what to revise).
- **Build** — the default working mode. The agent edits files and runs tools to do the work.
- **Fast** — quicker, lighter responses for small tasks.

A common flow for larger changes: start in Plan, review the plan card, then let the agent
switch to Build to implement it.

### Thinking level

The thinking selector next to the model (also \`/think\`) controls how much reasoning effort
the model spends before answering: **off**, **low**, **medium**, **high**, **xhigh**, or
**max**. Higher levels help on hard problems at the cost of speed and tokens; which levels
apply depends on the selected model.

You can also set a **default thinking level per mode** in Settings → Models — e.g. high for
Plan, off for Fast. Chats without an explicit thinking choice pick up the mode's default.
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
- **Session settings** — \`/sandbox\` opens the session's settings: extra writable paths for
  sandboxed commands, smart editing, completion notifications, and **skip global
  instructions** (leave your \`~/.mastracode\` global agent instructions out of this one
  session — project instructions still apply).
`
  },
  {
    id: 'confidence',
    title: 'Confidence & verification',
    body: `
### Confidence ratings

When the agent takes on a task it states how confident it is that it understood the request
and can deliver: a green / yellow / red **confidence chip** appears in the chat header and on
plan cards, with the agent's reasoning in the tooltip. On yellow or red the agent asks
clarifying questions before diving in rather than guessing.

Ratings are on by default and can be turned off in Settings → Preferences. They rely on the
model following instructions — if a model doesn't emit a rating, the chip simply doesn't
appear; nothing is blocked.

### Verify work before finishing

An opt-in self-verification pass: before declaring a task done, the agent discovers the
project's own checks (test/lint/build scripts, Makefile targets, CI config), runs them, fixes
failures, and re-runs — and reports honestly if something still fails instead of claiming
success. When the browser tool is configured it can also smoke-test the running app.

Off by default. Enable it globally in Settings → Preferences, or per chat via **Verify work**
in the chat header's ⋯ menu (Default follows the global setting). Expect longer, more
thorough runs when it's on.
`
  },
  {
    id: 'goals',
    title: 'Goals & evaluation history',
    body: `
A **goal** gives the agent an objective to iterate on until it passes. Set one from the
**goal button in the composer** (or \`/goal\`): describe the objective (e.g. "all tests
pass") and a maximum number of runs. The agent works, a judge model (selectable in the goal
panel) evaluates the result against the objective, and the agent keeps iterating until it
passes, pauses for your input, or hits the run limit.

The goal button is color-coded by state, and the goal panel keeps an **evaluation history**:
every past objective with its per-iteration pass/fail results and the evaluator's reasoning,
so you can see how a goal converged.
`
  },
  {
    id: 'schedules',
    title: 'Scheduled runs',
    body: `
**Scheduled runs** fire a prompt on a recurring cadence — a nightly dependency audit, a
weekly changelog draft, an hourly health check. Open them from the chat header's ⋯ menu (or
\`/schedules\`).

- **Cadence** — every N minutes (up to 7 days), daily at a time, or weekly on a day — local
  wall-clock time.
- **Prompt or workflow** — a schedule fires either a prompt or a **workflow** (a run-book —
  see Workflows); workflow schedules run the stored definition instead of sending text.
- **Where runs land** — each schedule gets its own dedicated chat ("Schedule: <name>"),
  created on first fire, so recurring output never clutters your working chats. Schedules
  can optionally run in an isolated worktree.
- **Controls** — each schedule shows its next-run countdown and last-run status, with
  enable/disable, **Run now**, edit, and delete.
- **Overlap** — if the schedule's chat is still busy when the next fire comes due, that fire
  is **skipped** (shown as "skipped"), never queued — a recurring prompt that stacked up
  behind a long run would replay itself.

Schedules fire only while Yardarm is open; an overdue schedule fires once at launch, then
re-anchors to its normal cadence.

Not the same as the agent's experimental **schedule tools** (Settings → Preferences): those
give the agent \`schedule_*\` tools to manage recurring prompts on its own thread, and they
live inside one agent process — they end when it exits. Scheduled runs are managed by the
app and survive restarts.
`
  },
  {
    id: 'threads',
    title: 'Threads, forking & split view',
    body: `
Each chat can hold multiple **threads** (conversation tabs). Open the thread switcher with ⌘P
to jump between them, create new ones, or open a thread in a new tab.

- **Fork from a message** — branch the conversation from any earlier message to explore an
  alternative approach without losing the original. Forked tabs carry a small fork icon, and
  their tooltip names the tab they were forked from.
- **Split view** — the split button in the tab bar adds extra chat panes of the same project
  side by side (up to six columns), so several agents can work — and be watched — at once.
  **⌘\\** adds a pane and **⌘⇧\\** closes the last one; each pane also has its own add/close
  buttons and chat picker. Drag a chat from the sidebar onto any pane to show it there.

Threads **name themselves** after your first message — the agent generates a short title
automatically, and you can rename it any time with \`/name\`.

Threads are shared with the \`mastracode\` CLI — the CLI tab sees the same conversations.
Avoid driving the same thread from the chat and the CLI at the same time.

### Following pull requests

With **GitHub signals** enabled (Settings → Connectors), **PR subscriptions** in the chat
header's ⋯ menu (or \`/github\`) subscribes the current thread to one or more pull requests: in **working**
mode the agent acts on new comments, reviews, and CI results; in **review** mode it only
gets notified. The repository defaults to the project's origin remote.
`
  },
  {
    id: 'changes',
    title: 'Reviewing changes & shipping',
    body: `
The Changes tab shows diffs of everything that changed in the chat's worktree (or project
root).

- **Stage, commit, push** — review per-file diffs, stage what you want, write a commit, and
  push. A commit-history panel shows what's landed. Drag the file list's right edge to
  resize it.
- **Branch switching** — the branch selector checks out another branch. If the working tree
  has uncommitted changes, Yardarm asks first: stash them (\`git stash\`) and switch, carry
  them over, or cancel.
- **Branch compare** — switch the comparison base to see the full branch diff, not just the
  working tree.
- **Merge & pull** — worktree chats can merge their branch back into the base branch from
  here, and pull the base to stay current.
- **Review** — the review action (in the chat header's ⋯ menu, also \`/review\`) has the
  agent review local changes or an open PR/MR and post findings back into the chat. Each
  finding carries a **severity tag** (critical / major / minor / nit) and a **confidence
  tag**. A **reviewer persona** selector steers the review — personas are named reviewer
  profiles (e.g. "security reviewer", "API-compatibility hawk") you define in Project
  Settings → General → Reviewers.
- **Quote diff lines** — select text in any diff and a floating **Quote** button appears:
  it drops the selection into the chat composer as an attachment named after the file and
  switches to the Chat tab, so you can ask about exactly those lines.
- **Pull / merge requests** — with the GitHub CLI (\`gh\`) or GitLab CLI (\`glab\`) installed
  and authenticated, you can open PRs/MRs from the app; the title is prefilled from your last
  commit. The host is auto-detected from the origin remote; for self-hosted instances, set it
  in Project Settings → General.
- **Draft with AI** — inside the Create PR/MR dialog, the Draft with AI button has the chat's
  agent read the branch's commits and diff and write the PR title and description for you.
  Both fields stay editable, so polish before creating. Needs the chat's agent to be idle.
`
  },
  {
    id: 'wiki',
    title: 'Repo wiki & codebase Q&A',
    body: `
### Repo wiki

The **Wiki** tab (book icon in the tab bar or the sidebar footer) holds agent-generated
architecture docs for the selected project: an overview page with a Mermaid diagram plus a
page per major module, with clickable \`path:line\` source references that open the IDE and
links between pages.

- **Generate** — click Generate (or run \`/wiki generate\`): generation runs behind the
  scenes in a dedicated **"Repo wiki"** chat the app creates for the project — no chat
  selection needed, and your own chats stay untouched. Tool calls in that chat are
  auto-approved so the run never stalls waiting for permission; it only writes into the
  git-excluded staging folder. The Wiki tab shows progress with a **View run** button to
  watch the run; pages are collected automatically when it finishes. If the agent asks a
  question, the banner turns amber ("waiting for your input") — open the run and answer to
  continue.
- **Storage** — pages live in Yardarm's app data folder, per project — never inside your
  repository, so diffs, reviews, and commits stay clean. (The temporary \`.yardarm-wiki/\`
  staging folder the agent writes to is git-excluded and removed on collection.)
- **Staleness** — when the repository has new commits since generation, a banner shows how
  many commits behind the wiki is, with a one-click Refresh.
- \`/wiki\` opens the tab; the trash button deletes all pages (regenerate any time).

### Codebase Q&A (/ask)

\`/ask <question>\` answers questions about the codebase **read-only** — the agent explores
but never edits files or runs state-changing commands. Answers cite their sources as
clickable \`path:line\` references that open the file in the IDE at that line. Great for
"where is X handled?" or "how does Y work?" before you start a task. The question-mark
button in the sidebar footer jumps to the composer with \`/ask\` prefilled.
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
- **Header popover** — the checkpoints button in the chat header shows the same list at a
  glance (auto and named, with ages and tags) and deep-links to the manager.

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
- **Add a file to the chat** — hover a file in the tree and click the **+** button to insert
  it into the composer as an \`@\`-mention.
- **Quick open** — press **⌘O** anywhere in the app to fuzzy-search every file in the chat's
  worktree and open it straight in the IDE.
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
  anything: running dev servers, git, tests. Each chat gets its own terminal, and the **+**
  button in the tab strip opens extra sessions in other locations — the project root or
  another chat's worktree — shown as tabs beside the default one (sessions keep running
  while you switch tabs; closing a tab ends its shell). Press ⌘F while
  the terminal is focused to search its scrollback (Enter / Shift+Enter to step through
  matches, Esc to close).
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
    id: 'factory',
    title: 'Mastra Factory',
    body: `
The Factory tab is a harness for **Mastra Factory** (mastra.ai/factory) — Mastra's open-source
agent-powered software factory. A Factory server connects to a GitHub repo, runs work items
through a kanban pipeline (intake → triage → planning → build → review) with human approval
gates, runs agent sessions per item, and opens PRs. The server lives in its **own checkout**,
separate from the repos its agents work on — keep it outside your Yardarm projects.

### Two setups

- **Mastra platform** — the installer signs into the Mastra platform in your browser and
  provisions hosted Postgres and cloud sandboxes for you; credentials are written to \`.env\`
  automatically. The easiest way to start.
- **Local self-hosted** — no hosted infrastructure: Postgres (with pgvector) and Redis run in
  Docker via the checkout's compose file, agents run in local sandboxes, and you manage
  \`.env\` yourself. Requires Docker. Note that you still **sign in with a Mastra account** to
  use the work board — see *Signing in* below.

Pick the mode when scaffolding; adopting an existing checkout auto-detects it (override in the
header any time).

### Setup → Server → Work

1. **Setup** — everything to get a Factory running, on one scrollable page:
   - The **guided checklist** sits at the top, covering every step from scaffold to a working
     board: checkout, dependencies, database, required \`.env\` keys, dashboard UI, server,
     dashboard-serving health, and sign-in. Each step shows live pass/fail state with a
     one-click fix or a scroll to the card below that owns it; the tab opens automatically
     while setup is incomplete.
   - The **setup cards**: scaffold a new checkout (\`npm create factory@latest\`, fully
     interactive in the embedded terminal — platform mode prints a browser sign-in link) or
     point Yardarm at an existing folder. Install dependencies from here if needed. Every step
     streams into its own log terminal, which notes when a command has already finished.
   - The **environment card** — a guided \`.env\` editor: generate the credential encryption
     key, seed the model-provider API keys Yardarm already knows, set the port and database
     URL, and (local mode) start/stop the Docker database. Required keys are flagged until
     set; comments and unknown keys in the file are preserved, including dotenv-style names
     with dots or dashes. The database card checks Docker health before letting you start: a
     missing CLI, a stopped daemon, or a missing \`docker compose\` plugin each show targeted
     guidance — and when Docker Desktop, OrbStack, or colima is installed but not running, a
     one-click button starts it.
2. **Server** — start/stop \`npm run dev\`; the dashboard URL is auto-detected from the logs
   (the URL chips clear when the server stops) and loads in an embedded view with back/forward,
   reload, DevTools, and open-in-browser. The dashboard session persists across app restarts.
   If the \`.env\` DATABASE_URL points at a localhost port nobody is listening on, a warning
   appears before you start — the server would otherwise crash with a bare ECONNREFUSED.
   Every start and restart first makes sure the server has a dashboard to serve: Yardarm
   points \`MASTRACODE_UI_DIST\` at the prebuilt dashboard bundled with the checkout's mastra
   CLI and installs a copy at \`src/mastra/public/factory\` (where the server and
   \`mastra build\` look by default) before booting it. If an externally started server still
   answers with only **"Welcome to the Mastra API"**, a banner offers
   **Fix dashboard & restart**, which applies the same fix and restarts. Stop and restart also
   verify the old server process actually released its port — leaked server processes are
   cleaned up, so a fix can never be defeated by a stale server still answering with its old
   environment.
3. **Work** — a native client for the running server's board APIs. Pick (or create) a Factory
   project, then work the sub-tabs:
   - **Board** — kanban over the server's phase pipeline. Drag cards along their legal
     transitions (illegal targets are inert; a gated edge points you to Decisions), add cards
     to the initial phase, and press ▶ on a card to start an agent run with that phase's role.
   - **Decisions** — the human approval gates: approve, dismiss, or retry automation proposals,
     with status filters and per-decision error details.
   - **Attention** — the notification inbox: mentions, automation failures/proposals, waiting
     agents, and supervisor findings. Mark items read or archive them; unread items show as a
     count badge on the Factory tab itself.
   - **Intake** — bind external sources (GitHub, Linear, Slack) to a Factory project so new
     issues land on its board, and pull individual incoming items onto the board by hand.

Once the checkout is scaffolded, Start/Stop controls also live in the Factory header next to
the status dot, so the server can be controlled from any tab.

The Factory tab is **immersive**: Yardarm's sidebar slides away while it's active so the
dashboard (which has its own left nav) gets the full window — the tab bar stays as the way
back. The panel button at the right end of the tab bar pins the sidebar back while you stay
on Factory, and it returns automatically on any other tab.

### Signing in — a Mastra login is required, even for a local server

Sign in **once** via the Server tab's embedded dashboard — the Work tab reuses that
session (signing out there signs it out too), and Yardarm never stores Factory tokens itself.
A **local server still asks for a sign-in, and that is by design**: the sign-in is
**identity-only** — the server and all of its data stay on your machine; the account (the same
Mastra account mastracode uses) only says *who* you are, because the board APIs are
organization-scoped. An account without an organization — or a purely local no-auth server —
can't serve them. Two auth paths exist: the default Mastra-platform sign-in inside the
dashboard, or self-managed auth via WorkOS (\`WORKOS_API_KEY\` + \`WORKOS_CLIENT_ID\` in
\`.env\`, which bootstraps a personal organization automatically). Setting
\`MASTRACODE_AUTH_DISABLED=1\` never enables the board — it only removes the sign-in screen
while the org-scoped APIs keep rejecting requests, so the dashboard becomes browsing-only.
Everything long-tail (settings, integrations, session transcripts) stays in the embedded
dashboard.

The server stops when Yardarm quits — for long-lived hosting, run \`npm run dev\` in a
standalone terminal instead. The Factory tab is unnumbered; reach it from the tab bar or ⌘K.
`
  },
  {
    id: 'workflows',
    title: 'Workflows',
    body: `
**Workflows** are named, reusable run-books over the multi-step automations the agent builds
for you in chat: a friendly name and description, a linked stored definition, and default
inputs — so a repeatable process is one click away instead of a raw definition id and a JSON
blob. Open the library from the chat header's ⋯ menu or \`/workflows\`.

- **Create** — pick one of the project's stored workflow definitions, name it, and optionally
  set default JSON input. No definition yet? **Draft with agent** sends your description to
  the chat's agent, which builds and saves a definition with its workflow tools — then link
  it. You can also just ask in chat, e.g. "build a workflow that runs the tests, updates the
  changelog, and drafts release notes".
- **Run** — when the definition declares a simple input schema, the Run view shows a real
  form (text/number/toggle fields) seeded from the defaults; otherwise you get a raw-JSON
  editor. Runs execute in the active chat's agent host, drop a "Workflow" marker into the
  transcript, and show per-step results; each workflow remembers its last run status.
- **Schedule** — a scheduled run can fire a workflow instead of a prompt: pick "workflow"
  mode in the schedule form. Deleting a workflow disables schedules linked to it rather than
  letting them fire nothing.
- **Raw definitions** — Project Settings → **Workflow definitions** lists the stored
  definitions themselves with their steps; open one to edit its JSON in place and Save — the
  definition is fully validated before anything changes.
- **Shared with the CLI** — definitions live in mastracode's shared storage, so the same
  automations are available from the \`mastracode\` CLI.

Naming things: **workflow definitions** are the step sequences stored by the agent runtime
(shared with the CLI); **workflows** are Yardarm's run-books over them — metadata, input
forms, and scheduling. Deleting a workflow entry never deletes its stored definition.
`
  },
  {
    id: 'knowledge',
    title: 'Knowledge notes & agent knowledge',
    body: `
Two distinct systems share the "knowledge" name — one you write, one the agent writes:

### Knowledge notes (you write them)

**Knowledge notes** (Project Settings → Knowledge) are durable, user-authored facts the agent
should always know about the project — "deploys go through \`make release\`", "never touch
\`legacy/\`". Each note can be:

- **Pinned** — its full text rides along in the agent's instructions on every run.
- **Unpinned** — only its title is listed; the agent fetches the body on demand with the
  auto-approved \`knowledge_note_lookup\` tool, keeping prompts lean.

Notes can be toggled off without deleting, and there's a pinned-size budget so instructions
stay bounded. Edits apply at the next run — running chats in the project restart.

**Triggers** — give a note trigger keywords (comma-separated) and its full text is injected
automatically whenever a prompt you send mentions one (whole-word, case-insensitive). A small
"Injected knowledge notes" marker in the transcript shows which notes matched. Pinned notes
skip triggers — they're always present anyway.

**! macros** — type \`!\` in the composer to search the project's notes by title and attach
the chosen note's body to your prompt as a text chip — handy for notes you want in one
specific prompt without pinning or triggers.

**Suggested notes** — when you correct the agent or it learns something durable, it may end
its reply with a suggestion; a card appears under the reply with **Save** (lands in the
Knowledge tab, unpinned, marked "suggested") and **Dismiss**. On by default — turn off via
**Suggest knowledge notes** in Settings → Preferences.

### Agent knowledge base (the agent writes it)

With **Knowledge** enabled, the agent builds up durable notes about your project — knowledge
it captures and reuses across conversations. It's experimental and **off by default**: turn
it on in Settings → Preferences → **Experimental** (shared with the CLI's "Experimental
Knowledge" setting), then restart running agents. Once on, agents get knowledge tools
(including \`knowledge_list\`) and \`/knowledge\` opens the **knowledge browser** to see what
they have learned:

- **Scopes** — browse knowledge attached to the whole organization, the current project
  (resource), or just this thread.
- **Nodes** — each entry shows its kind, age, and record count; open one to read its full
  markdown content, its individual records, where it's mentioned, and related nodes (click a
  related node to jump to it).

Knowledge is stored locally in mastracode's shared storage, so the CLI sees the same
knowledge base.
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
  reconnect actions and a per-server **enable/disable switch** — turn a server off without
  editing any config (persisted, shared with the CLI). Configuration lives in the same
  \`mcp.json\` files the CLI uses.
- **Server discovery** — the Global scope has opt-in switches to also load the MCP servers
  you've already configured for **Claude Code** or **Codex**, so you don't have to duplicate
  them; running agents pick the change up after a restart.

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
- **Context audit** — in the chat header's ⋯ menu (or \`/context\`) — breaks down
  what's occupying the context window right now: instructions, skills, tool definitions,
  conversation, and memory, split into startup vs accumulated shares.
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
- **Keyboard** — rebind the app shortcuts (command palette, find, split panes, …). ⌘1–8 tab
  switching is fixed.
- **Preferences** — agent behavior defaults (auto-approve, sandbox, **confidence ratings** —
  the colored chip, on by default — **verify work before finishing**, off by default,
  **follow-up suggestions** — the next-step chips under replies, on by default — and
  **suggest knowledge notes** — the save-a-note card, on by default),
  token compression and verbosity steering, the **web-search provider** the agent's search tool uses (Tavily or
  Parallel), **commit attribution** (the co-author trailer on agent-made commits — customize
  or disable it), experimental **cross-agent communication** (lets running agents discover
  and signal each other), experimental **schedule tools** (gives the agent
  \`schedule_create/list/update/resume/run\` to manage recurring prompts on its own thread —
  schedules live inside the agent process and end with it; distinct from the app-managed
  **Scheduled runs** in the chat ⋯ menu), experimental **Knowledge** (a
  persistent agent knowledge base + the \`/knowledge\` browser — see the Agent knowledge
  section), an experimental **agent runtime**
  selector (durable/evented — leave on default unless you know you need it; invalid setups
  fail at agent start), and per-tool toggles to disable built-in agent tools you never
  want used. A **Notifications** card controls desktop notifications (a system notification
  when a run finishes or the agent needs input while the app is in the background — clicking
  one opens the chat), and a **Storage** card shows how much space mastracode storage and the
  chat database use, with a **Prune now** button (\`/prune\`).
- **API Keys** — keys for model providers, stored locally. Instead of pasting a key you can
  reference an environment variable (e.g. \`ANTHROPIC_API_KEY\`) — the value is read from your
  login shell at launch and never saved by Yardarm. Standard variables are detected
  automatically; a stored key takes precedence, so saving one mode clears the other. Export
  new variables in your shell profile and relaunch the app to pick them up. Like with the
  CLI, referenced variables are visible to shell commands the agent runs.
- **Models** — pick default models per mode, subagent, goal judge, and memory role, set a
  **default thinking level per mode**, and — when a model pack is active — tune the pack:
  per-mode model overrides, a **fallback pack** used when the pack's provider is exhausted
  or down, and (with multiple logins for a provider) a preferred account per model.
- **Providers** — provider OAuth logins and local providers (e.g. Ollama), including
  installing and pulling local models.
- **Voice** — speech-to-text for the composer microphone.
- **Browser** — the agent's built-in browser tool: viewport size and, for the Stagehand
  provider, the model that drives page interactions.
- **Connectors** — one-click service sign-ins (see the Connectors section), plus
  **GitHub signals** (experimental PR awareness via the \`gh\` CLI — enables per-thread PR
  subscriptions, see Threads) and **Observability** (local tracing / Mastra Cloud).
  \`/observability\` jumps straight there.
- **MCP Servers** — MCP server lists and live status, global or per-project (scope toggle +
  project picker). Project scope adds per-server **Enabled / Disabled / Inherit** overrides
  on top of the global default, and a global kill switch state is surfaced when active.
  \`/mcp\` opens this tab.
- **Agents** — custom subagents the main agent can delegate tasks to, plus a toggle for the
  runtime's **built-in explore/plan/execute subagents**. Global by default
  (available in every project); switch the scope to Project and pick a project to manage
  project-specific subagents. A Templates section lists ready-made subagents — team roles
  (product manager, developer, QA, …) and domain specialists (SaaS, mobile, AI apps, …) —
  added with one click and editable like any other. \`/subagents\` opens this tab.
- **About** — versions, bundled runtime updates, installing/updating the global
  \`mastracode\` CLI, storage pruning (\`/prune\` — clear out old threads, traces, and
  logs), and "Run setup again" to redo onboarding.

**Project settings** (gear on the project row) cover per-project hooks, custom slash
commands, agent instructions, **knowledge notes** (see Knowledge notes), resources, plugins,
and workflows — plugins with configuration schemas get generated settings forms,
**Create plugin** scaffolds a new plugin for you, and the Workflows tab (\`/workflows\`) runs
and manages the agent's stored workflows. An **Environment** tab holds per-project
environment variables, added to every agent run and terminal in the project (changing them
restarts the project's active agents; values are stored in plaintext in the app database —
the secret toggle only masks display). The General tab also holds the repository host
override, the **reviewer personas** used by code review (see Reviewing changes), and the
**worktree setup commands** (see Projects, chats & worktrees).
`
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    body: `
⌘ on macOS, Ctrl on Windows/Linux. Everything except ⌘1–8 tab switching is customizable in
**Settings → Keyboard** (defaults shown below).

| Shortcut | Action |
| --- | --- |
| ⌘K | Command palette |
| ⌘N | New chat |
| ⌘O | Quick file open (into the IDE tab) |
| ⌘P | Thread switcher |
| ⌘F | Find in chat (Chat tab) / find in terminal (Terminal tab) |
| ⌘J | Toggle the Terminal tab |
| ⌘\\ | Add a split chat pane |
| ⌘⇧\\ | Close the last split pane |
| ⌘, | Settings |
| ⌘1 | Chat |
| ⌘2 | CLI |
| ⌘3 | IDE |
| ⌘4 | Changes |
| ⌘5 | Terminal |
| ⌘6 | Analytics |
| ⌘7 | Preview |
| ⌘8 | This guide |
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

Yes. Each chat (and each thread) runs independently — use split view or multiple chats to
parallelize.

### Why does the Factory Work tab ask me to sign in — or say I need an organization?

The Board, Decisions, Attention, and Intake sub-tabs talk to the Factory server's
**organization-scoped** APIs. Even a fully local server asks for a sign-in — it's
identity-only (the server and its data stay on your machine; it's the same Mastra account
mastracode uses). Sign in once via the Server tab's embedded dashboard with an account
that belongs to an organization; the Work tab reuses that session, and Yardarm never
stores Factory tokens itself. Self-managed alternative: WorkOS via \`WORKOS_API_KEY\` +
\`WORKOS_CLIENT_ID\` in \`.env\`. \`MASTRACODE_AUTH_DISABLED=1\` only removes the sign-in
screen — the org-scoped APIs keep rejecting anonymous requests, so the board can never load
that way.

### Why does the agent keep asking for approval?

That's the default safety posture. Add permission rules (\`/permissions\`) for routine
commands, or enable auto-approve for a trusted chat — optionally combined with the sandbox.

### How do I update the agent runtime?

Settings → About shows the bundled runtime version and an update indicator when a newer one
is available.

### How do I update the app itself?

On macOS, Settings → About checks GitHub Releases, downloads updates, and finishes with a
restart banner (automatic checks can be turned off; \`/update\` checks on demand). On the
beta Linux and Windows builds the same tab tells you when a new version is available, but
you install it manually from the releases page for now.

### Does Yardarm run on Linux or Windows?

Yes, in beta. macOS (Apple Silicon) is the primary platform; Linux and Windows builds are
new and lightly tested. Known limits: no OS-level sandbox mode on Windows (on Linux it
requires bubblewrap), the CLI tab does not live-sync with the chat screen on Windows, and
in-app self-update is macOS-only for now.
`
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    body: `
### The app shows a boot error / the agent won't start

Use the retry button on the error screen. If it persists, check Settings → About for runtime
details, or re-run onboarding ("Run setup again").

### The window went blank

A blank window means the UI process crashed — usually memory pressure after a very long
session. Yardarm reloads it automatically and re-seeds the open chat from its local database,
so you may only notice a brief flash; transcripts are also capped in memory to make this rare.
If a window ever stays blank (auto-reload gives up after repeated crashes in a row), quit and
reopen the app — nothing is lost, transcripts live in SQLite.

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
